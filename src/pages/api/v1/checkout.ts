import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { json, getErrorMessage } from '../../../lib/http';
import { getCurrentDrop, getCurrentDropItems, getPickupSpots, validateCouponForCheckout } from '../../../lib/db';
import { unitPriceCents } from '../../../lib/pricing';
import { getStripe } from '../../../lib/stripe';

interface CartLine {
    menuItemId: string;
    quantity: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, url }) => {
    try {
        const body = await request.json();
        const {
            items,
            customer,
            tipCents: rawTipCents,
            pickupSpotId: rawPickupSpotId,
            couponCode: rawCouponCode,
        } = body ?? {};
        const pickupSpotId = typeof rawPickupSpotId === 'string' ? rawPickupSpotId : '';
        const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
        const email = typeof customer?.email === 'string' ? customer.email.trim() : '';
        const phone = typeof customer?.phone === 'string' ? customer.phone.trim() : '';
        const couponCodeRaw = typeof rawCouponCode === 'string' ? rawCouponCode : '';

        if (!name) return json({ error: 'Name is required' }, 400);
        if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400);
        if (!Array.isArray(items) || items.length === 0) {
            return json({ error: 'Your cart is empty' }, 400);
        }

        const tipCents = rawTipCents == null ? 0 : Number(rawTipCents);
        if (!Number.isInteger(tipCents) || tipCents < 0) {
            return json({ error: 'Invalid tip amount' }, 400);
        }

        const drop = await getCurrentDrop();
        if (!drop) return json({ error: 'No active drop' }, 409);
        const now = Date.now();
        const open = new Date(drop.openTime).getTime();
        const close = new Date(drop.closeTime).getTime();
        if (!(now >= open && now < close)) {
            return json({ error: 'Ordering is currently closed' }, 409);
        }

        // When the drop offers pickup spots, the customer must choose exactly one.
        // The chosen spot is validated here and carried into the order snapshot at
        // fulfillment time (its address is never sent to an unpaid customer).
        const spots = await getPickupSpots(drop.id);
        if (spots.length > 0) {
            if (!pickupSpotId) return json({ error: 'Please choose a pickup spot' }, 400);
            if (!spots.some(s => s.id === pickupSpotId)) {
                return json({ error: 'That pickup spot is no longer available' }, 409);
            }
        }

        const dropItems = await getCurrentDropItems();
        const byId = new Map(dropItems.map(di => [di.menuItem.id, di]));

        let subtotalCents = 0;
        const orderLines = [];
        const seen = new Set<string>();
        for (const raw of items as CartLine[]) {
            const menuItemId = raw?.menuItemId;
            const quantity = Number(raw?.quantity);
            if (!menuItemId || typeof menuItemId !== 'string') {
                return json({ error: 'Invalid item in cart' }, 400);
            }
            if (seen.has(menuItemId)) return json({ error: 'Duplicate item in cart' }, 400);
            seen.add(menuItemId);
            if (!Number.isInteger(quantity) || quantity <= 0) {
                return json({ error: 'Invalid quantity' }, 400);
            }

            const di = byId.get(menuItemId);
            if (!di) return json({ error: 'An item is no longer available' }, 409);

            const remaining = di.initialStock - di.consumedStock;
            if (quantity > remaining) {
                return json({ error: `Only ${remaining} of ${di.menuItem.name} left` }, 409);
            }

            const unit = unitPriceCents(di.menuItem);
            if (unit <= 0) {
                return json({ error: `${di.menuItem.name} is not available for purchase` }, 409);
            }
            subtotalCents += unit * quantity;
            orderLines.push({
                menuItemId,
                nameSnapshot: di.menuItem.name,
                unitPriceCents: unit,
                quantity,
            });
        }

        if (subtotalCents <= 0) return json({ error: 'Order total must be greater than zero' }, 400);

        let discountCents = 0;
        let couponCode: string | null = null;
        let couponId: string | null = null;
        let couponType: string | null = null;
        let couponValue: number | null = null;
        if (couponCodeRaw.trim()) {
            const result = await validateCouponForCheckout(couponCodeRaw, subtotalCents);
            if (!result.ok) return json({ error: result.message }, 400);
            discountCents = result.discountCents;
            couponCode = result.coupon.code;
            couponId = result.coupon.id;
            couponType = result.coupon.type;
            couponValue = result.coupon.value;
        }

        const itemsAfterDiscount = Math.max(subtotalCents - discountCents, 0);
        const maxTipCents = Math.max(itemsAfterDiscount, 5000);
        if (tipCents > maxTipCents) return json({ error: 'Tip amount is too large' }, 400);

        const totalCents = itemsAfterDiscount + tipCents;
        if (totalCents <= 0) {
            return json({ error: 'Order total must be greater than zero' }, 400);
        }

        const cart = orderLines.map(l => `${l.menuItemId}:${l.quantity}`).join(',');

        const stripe = getStripe();
        const metadata: Record<string, string> = {
            dropId: drop.id,
            name,
            phone,
            cart,
            tip: String(tipCents),
            discount: String(discountCents),
            subtotal: String(subtotalCents),
        };
        if (pickupSpotId) metadata.pickupSpotId = pickupSpotId;
        if (couponCode) metadata.coupon = couponCode;
        if (couponId) metadata.couponId = couponId;

        // Stripe Checkout coupons would also discount a tip line item. Bake the
        // promo into the charged product total instead: either per-item lines
        // (no discount) or one consolidated line for the post-discount amount.
        const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
        if (discountCents > 0) {
            const label = couponCode
                ? `Order (${couponCode} applied)`
                : 'Order';
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: { name: label },
                    unit_amount: itemsAfterDiscount,
                },
                quantity: 1,
            });
        } else {
            for (const l of orderLines) {
                lineItems.push({
                    price_data: {
                        currency: 'usd',
                        product_data: { name: l.nameSnapshot },
                        unit_amount: l.unitPriceCents,
                    },
                    quantity: l.quantity,
                });
            }
        }
        if (tipCents > 0) {
            lineItems.push({
                price_data: {
                    currency: 'usd',
                    product_data: { name: 'Tip' },
                    unit_amount: tipCents,
                },
                quantity: 1,
            });
        }

        const session = await stripe.checkout.sessions.create({
            ui_mode: 'elements',
            mode: 'payment',
            payment_method_types: ['card'],
            customer_email: email,
            line_items: lineItems,
            return_url: `${url.origin}/order/success?session_id={CHECKOUT_SESSION_ID}`,
            metadata,
            payment_intent_data: { metadata },
        });

        if (!session.client_secret) {
            return json({ error: 'Could not initialize checkout' }, 500);
        }

        return json({
            clientSecret: session.client_secret,
            subtotalCents,
            discountCents,
            couponCode,
            couponType,
            couponValue,
            tipCents,
            totalCents,
        });
    } catch (err) {
        console.error('Checkout error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};
