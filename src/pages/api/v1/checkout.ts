import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { json, getErrorMessage } from '../../../lib/http';
import { getCurrentDrop, getCurrentDropItems } from '../../../lib/db';
import { getStripe } from '../../../lib/stripe';

interface CartLine {
    menuItemId: string;
    quantity: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ request, url }) => {
    try {
        const body = await request.json();
        const { items, customer, tipCents: rawTipCents } = body ?? {};
        const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
        const email = typeof customer?.email === 'string' ? customer.email.trim() : '';
        const phone = typeof customer?.phone === 'string' ? customer.phone.trim() : '';

        if (!name) return json({ error: 'Name is required' }, 400);
        if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400);
        if (!Array.isArray(items) || items.length === 0) {
            return json({ error: 'Your cart is empty' }, 400);
        }

        // Optional gratuity. The client suggests an amount but the value is
        // re-validated here; it's never trusted for anything except itself.
        const tipCents = rawTipCents == null ? 0 : Number(rawTipCents);
        if (!Number.isInteger(tipCents) || tipCents < 0) {
            return json({ error: 'Invalid tip amount' }, 400);
        }

        // Verify ordering is currently open for the active drop.
        const drop = await getCurrentDrop();
        if (!drop) return json({ error: 'No active drop' }, 409);
        const now = Date.now();
        const open = new Date(drop.openTime).getTime();
        const close = new Date(drop.closeTime).getTime();
        if (!(now >= open && now < close)) {
            return json({ error: 'Ordering is currently closed' }, 409);
        }

        const dropItems = await getCurrentDropItems();
        const byId = new Map(dropItems.map(di => [di.menuItem.id, di]));

        // Validate lines and compute the total from server-side prices only.
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

            const unitPriceCents = Math.round(di.menuItem.price * 100);
            if (unitPriceCents <= 0) {
                return json({ error: `${di.menuItem.name} is not available for purchase` }, 409);
            }
            subtotalCents += unitPriceCents * quantity;
            orderLines.push({
                menuItemId,
                nameSnapshot: di.menuItem.name,
                unitPriceCents,
                quantity,
            });
        }

        if (subtotalCents <= 0) return json({ error: 'Order total must be greater than zero' }, 400);

        // Guard against an absurd tip (typo or tampering): cap at the greater of
        // the order subtotal or $50, so generous tips on small orders still work.
        const maxTipCents = Math.max(subtotalCents, 5000);
        if (tipCents > maxTipCents) return json({ error: 'Tip amount is too large' }, 400);

        // The order isn't persisted until Stripe confirms payment. Everything
        // needed to build it at finalize time is carried in session metadata:
        // the cart as `menuItemId:qty` pairs (kept in the same order as
        // line_items so they can be matched back) plus the customer details.
        const cart = orderLines.map(l => `${l.menuItemId}:${l.quantity}`).join(',');

        // The pickup location/address are NOT taken from the customer or carried
        // here; they're snapshotted from the drop at finalize time so the exact
        // address is only ever materialized onto a confirmed (paid) order.
        const stripe = getStripe();
        // The tip rides in metadata so it can be recovered at finalize time
        // without re-deriving it from the (item) line totals.
        const metadata = { dropId: drop.id, name, phone, cart, tip: String(tipCents) };

        // Build the charged line items: one per cart line, plus a trailing "Tip"
        // line when a gratuity was added. Keep the tip LAST so the cart lines stay
        // index-aligned with the `cart` metadata at finalize time.
        const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = orderLines.map(l => ({
            price_data: {
                currency: 'usd',
                product_data: { name: l.nameSnapshot },
                unit_amount: l.unitPriceCents,
            },
            quantity: l.quantity,
        }));
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
            // Card only (Apple Pay / Google Pay ride along automatically). This
            // also silences the test-mode warning about link/klarna/cashapp/etc.
            // that aren't activated. Add more types here to offer them.
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
            tipCents,
            totalCents: subtotalCents + tipCents,
        });
    } catch (err) {
        console.error('Checkout error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};
