import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { json, getErrorMessage } from '../../../../../../lib/http';
import { getDropItems, validateCouponForCheckout } from '../../../../../../lib/db';
import { unitPriceCents } from '../../../../../../lib/pricing';
import { getStripe } from '../../../../../../lib/stripe';
import { finalizeInPersonSaleIfPaid } from '../../../../../../lib/fulfillment';

interface CartLine {
    menuItemId: string;
    quantity: number;
}

export const POST: APIRoute = async ({ params, request, url }) => {
    try {
        const dropId = params.id as string;
        const body = await request.json();
        const items = body?.items;
        const couponCodeRaw = typeof body?.couponCode === 'string' ? body.couponCode : '';
        if (!Array.isArray(items) || items.length === 0) {
            return json({ error: 'Cart is empty' }, 400);
        }

        const dropItems = await getDropItems(dropId);
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

            const remaining = di.inPersonStock - di.inPersonConsumed;
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

        if (subtotalCents <= 0) return json({ error: 'Total must be greater than zero' }, 400);

        let discountCents = 0;
        let couponCode: string | null = null;
        let couponId: string | null = null;
        if (couponCodeRaw.trim()) {
            const result = await validateCouponForCheckout(couponCodeRaw, subtotalCents);
            if (!result.ok) return json({ error: result.message }, 400);
            discountCents = result.discountCents;
            couponCode = result.coupon.code;
            couponId = result.coupon.id;
        }

        const chargeCents = Math.max(subtotalCents - discountCents, 0);
        if (chargeCents <= 0) {
            return json({ error: 'Total must be greater than zero after discount' }, 400);
        }

        const cart = orderLines.map(l => `${l.menuItemId}:${l.quantity}`).join(',');
        const metadata: Record<string, string> = {
            kind: 'in_person',
            dropId,
            cart,
            subtotal: String(subtotalCents),
            discount: String(discountCents),
        };
        if (couponCode) metadata.coupon = couponCode;
        if (couponId) metadata.couponId = couponId;

        const stripe = getStripe();
        const intent = await stripe.paymentIntents.create({
            amount: chargeCents,
            currency: 'usd',
            payment_method_types: ['card'],
            metadata,
        });

        const payUrl = `${url.origin}/pay/in-person?pi=${encodeURIComponent(intent.id)}`;
        const qrDataUrl = await QRCode.toDataURL(payUrl, {
            width: 320,
            margin: 1,
            errorCorrectionLevel: 'M',
        });

        return json({
            paymentIntentId: intent.id,
            url: payUrl,
            qrDataUrl,
            subtotalCents,
            discountCents,
            couponCode,
            totalCents: chargeCents,
        });
    } catch (err) {
        console.error('In-person checkout error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const GET: APIRoute = async ({ url }) => {
    try {
        const paymentIntentId = url.searchParams.get('payment_intent');
        if (!paymentIntentId) return json({ error: 'payment_intent is required' }, 400);

        const result = await finalizeInPersonSaleIfPaid(paymentIntentId);
        return json({
            status: result.paid ? 'paid' : 'pending',
            recorded: result.recorded,
            subtotalCents: result.subtotalCents,
            discountCents: result.discountCents,
            tipCents: result.tipCents,
            totalCents: result.totalCents,
        });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
