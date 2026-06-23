import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import { json, getErrorMessage } from '../../../../../../lib/http';
import { getDropItems } from '../../../../../../lib/db';
import { getStripe } from '../../../../../../lib/stripe';
import { finalizeInPersonSaleIfPaid } from '../../../../../../lib/fulfillment';

interface CartLine {
    menuItemId: string;
    quantity: number;
}

// Creates a Stripe PaymentIntent for an in-person POS cart and returns a QR code
// (data URL) pointing at our own /pay/in-person page. The customer scans it and
// pays on their own phone with a card-only Payment Element (no email/phone
// collected); the sale is recorded when payment confirms (via the webhook
// and/or the GET poll below). Draws from the in-person stock pool.
export const POST: APIRoute = async ({ params, request, url }) => {
    try {
        const dropId = params.id as string;
        const body = await request.json();
        const items = body?.items;
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

        if (subtotalCents <= 0) return json({ error: 'Total must be greater than zero' }, 400);

        // Carry the cart in metadata as `menuItemId:qty` pairs so the sale can be
        // rebuilt at finalize time. The subtotal is stashed too so the pay page
        // can validate a customer-added tip against it (the PI amount itself grows
        // to include the tip, so it can't be used as the subtotal afterwards).
        const cart = orderLines.map(l => `${l.menuItemId}:${l.quantity}`).join(',');
        const metadata = { kind: 'in_person', dropId, cart, subtotal: String(subtotalCents) };

        const stripe = getStripe();
        // Card only (incl. Apple/Google Pay wallets) so Stripe Link — which asks
        // for a phone number — never appears, and no email is collected.
        const intent = await stripe.paymentIntents.create({
            amount: subtotalCents,
            currency: 'usd',
            payment_method_types: ['card'],
            metadata,
        });

        // The QR points at our own pay page, which mounts the Payment Element
        // using this PaymentIntent. We never put the client secret in the QR; the
        // page fetches it server-side from the PaymentIntent id.
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
        });
    } catch (err) {
        console.error('In-person checkout error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};

// Polled by the POS while the QR is on screen. Confirms with Stripe and records
// the sale once paid (idempotent). Returns the current payment status.
export const GET: APIRoute = async ({ url }) => {
    try {
        const paymentIntentId = url.searchParams.get('payment_intent');
        if (!paymentIntentId) return json({ error: 'payment_intent is required' }, 400);

        const result = await finalizeInPersonSaleIfPaid(paymentIntentId);
        return json({
            status: result.paid ? 'paid' : 'pending',
            recorded: result.recorded,
            subtotalCents: result.subtotalCents,
            tipCents: result.tipCents,
            totalCents: result.totalCents,
        });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
