import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../../lib/http';
import { getStripe } from '../../../../../lib/stripe';
import { getDropItems } from '../../../../../lib/db';

function parseCart(raw: string | undefined | null): { menuItemId: string; quantity: number }[] {
    if (!raw) return [];
    return raw
        .split(',')
        .map(pair => {
            const [menuItemId, qty] = pair.split(':');
            return { menuItemId, quantity: Number(qty) };
        })
        .filter(p => p.menuItemId && Number.isInteger(p.quantity) && p.quantity > 0);
}

export const GET: APIRoute = async ({ params }) => {
    try {
        const id = params.id as string;
        if (!id) return json({ error: 'Missing payment id' }, 400);

        const stripe = getStripe();
        const intent = await stripe.paymentIntents.retrieve(id);

        const meta = intent.metadata ?? {};
        if (meta.kind !== 'in_person') {
            return json({ error: 'Payment not found' }, 404);
        }

        const cartPairs = parseCart(meta.cart);
        let items: { name: string; quantity: number; unitPriceCents: number; lineTotalCents: number }[] = [];
        if (cartPairs.length > 0 && meta.dropId) {
            try {
                const dropItems = await getDropItems(meta.dropId);
                const byId = new Map(dropItems.map(di => [di.menuItem.id, di.menuItem]));
                items = cartPairs.map(pair => {
                    const mi = byId.get(pair.menuItemId);
                    const unitPriceCents = mi ? Math.round(mi.price * 100) : 0;
                    return {
                        name: mi?.name ?? 'Item',
                        quantity: pair.quantity,
                        unitPriceCents,
                        lineTotalCents: unitPriceCents * pair.quantity,
                    };
                });
            } catch {
            }
        }

        const subtotalCents = Number(meta.subtotal)
            || items.reduce((sum, i) => sum + i.lineTotalCents, 0);
        const tipParsed = Number(meta.tip);
        const tipCents = Number.isInteger(tipParsed) && tipParsed > 0 ? tipParsed : 0;

        return json({
            clientSecret: intent.client_secret,
            amountCents: intent.amount,
            subtotalCents,
            tipCents,
            status: intent.status,
            items,
        });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const POST: APIRoute = async ({ params, request }) => {
    try {
        const id = params.id as string;
        if (!id) return json({ error: 'Missing payment id' }, 400);

        const body = await request.json().catch(() => ({}));
        const tipCents = body?.tipCents == null ? 0 : Number(body.tipCents);
        if (!Number.isInteger(tipCents) || tipCents < 0) {
            return json({ error: 'Invalid tip amount' }, 400);
        }

        const stripe = getStripe();
        const intent = await stripe.paymentIntents.retrieve(id);
        const meta = intent.metadata ?? {};
        if (meta.kind !== 'in_person') return json({ error: 'Payment not found' }, 404);

        if (intent.status !== 'requires_payment_method' && intent.status !== 'requires_confirmation') {
            return json({ error: 'This payment can no longer be changed' }, 409);
        }

        let subtotalCents = Number(meta.subtotal) || 0;
        if (!subtotalCents) {
            const cartPairs = parseCart(meta.cart);
            if (cartPairs.length > 0 && meta.dropId) {
                const dropItems = await getDropItems(meta.dropId);
                const byId = new Map(dropItems.map(di => [di.menuItem.id, di.menuItem]));
                subtotalCents = cartPairs.reduce((sum, pair) => {
                    const mi = byId.get(pair.menuItemId);
                    return sum + (mi ? Math.round(mi.price * 100) * pair.quantity : 0);
                }, 0);
            }
        }
        if (subtotalCents <= 0) return json({ error: 'Could not determine the order total' }, 409);

        const maxTipCents = Math.max(subtotalCents, 5000);
        if (tipCents > maxTipCents) return json({ error: 'Tip amount is too large' }, 400);

        const updated = await stripe.paymentIntents.update(id, {
            amount: subtotalCents + tipCents,
            metadata: { ...meta, subtotal: String(subtotalCents), tip: String(tipCents) },
        });

        return json({
            subtotalCents,
            tipCents,
            amountCents: updated.amount,
        });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
