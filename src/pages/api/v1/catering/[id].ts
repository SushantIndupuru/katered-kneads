import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import {
    getCateringRequestById,
    updateCateringRequestItems,
    markCateringApproved,
    markCateringRejected,
    deleteCateringRequest,
} from '../../../../lib/db';
import { createCateringCheckoutSession } from '../../../../lib/catering-checkout';
import { sendCateringPaymentLink } from '../../../../lib/email';

interface QtyOverride {
    menuItemId: string | null;
    quantity: number;
}

function parseAgreedTotalCents(body: Record<string, unknown>): number | null {
    if (body.agreedTotalCents != null) {
        const n = Number(body.agreedTotalCents);
        return Number.isInteger(n) ? n : null;
    }
    if (body.agreedTotal != null) {
        const dollars = Number(body.agreedTotal);
        if (!Number.isFinite(dollars) || dollars <= 0) return null;
        return Math.round(dollars * 100);
    }
    return null;
}

export const PATCH: APIRoute = async ({ params, request, url }) => {
    try {
        const id = params.id;
        if (!id) return json({ error: 'Missing id' }, 400);

        const existing = await getCateringRequestById(id);
        if (!existing) return json({ error: 'Request not found' }, 404);

        const body = (await request.json()) as Record<string, unknown>;
        const action = typeof body?.action === 'string' ? body.action : '';
        const adminNote = typeof body?.adminNote === 'string' ? body.adminNote.trim().slice(0, 2000) : '';

        if (action === 'reject') {
            if (existing.status !== 'pending' && existing.status !== 'approved') {
                return json({ error: 'Only pending or approved requests can be rejected' }, 409);
            }
            const rejected = await markCateringRejected(id, adminNote);
            return json({ request: rejected });
        }

        if (action === 'approve') {
            if (existing.status !== 'pending') {
                return json({ error: 'Only pending requests can be approved' }, 409);
            }

            const agreedTotalCents = parseAgreedTotalCents(body);
            if (agreedTotalCents == null || agreedTotalCents <= 0) {
                return json({ error: 'Enter the agreed total before sending payment' }, 400);
            }
            if (agreedTotalCents > 500_000_00) {
                return json({ error: 'Agreed total is too large' }, 400);
            }

            // Optional qty tweaks; prices stay unset on lines — total is manual.
            const overrides = Array.isArray(body?.items) ? (body.items as QtyOverride[]) : null;
            if (overrides) {
                const byId = new Map(overrides.map(o => [o.menuItemId ?? '', o]));
                const next = [];
                for (const line of existing.items) {
                    const o = byId.get(line.menuItemId ?? '');
                    const quantity = o?.quantity != null ? Number(o.quantity) : line.quantity;
                    if (!Number.isInteger(quantity) || quantity <= 0 || quantity > 500) {
                        return json({ error: 'Invalid quantity' }, 400);
                    }
                    next.push({
                        menuItemId: line.menuItemId,
                        nameSnapshot: line.nameSnapshot,
                        unitPriceCents: 0,
                        quantity,
                    });
                }
                if (next.length === 0) return json({ error: 'Quote must have items' }, 400);
                await updateCateringRequestItems(id, next);
            }

            const session = await createCateringCheckoutSession({
                request: {
                    id,
                    customerEmail: existing.customerEmail,
                    customerName: existing.customerName,
                },
                subtotalCents: agreedTotalCents,
                origin: url.origin,
            });

            if (!session.client_secret) {
                return json({ error: 'Could not create payment session' }, 500);
            }

            const approved = await markCateringApproved({
                id,
                stripeCheckoutSessionId: session.id,
                adminNote: adminNote || undefined,
                subtotalCents: agreedTotalCents,
            });

            const paymentUrl = `${url.origin}/catering/pay/${id}`;

            try {
                await sendCateringPaymentLink(approved, paymentUrl);
            } catch (emailErr) {
                console.error('Catering payment email failed:', getErrorMessage(emailErr));
                return json({
                    error: 'Approved, but payment email failed to send. Payment link: ' + paymentUrl,
                    request: approved,
                    paymentUrl,
                }, 500);
            }

            return json({ request: approved, paymentUrl });
        }

        return json({ error: 'Unknown action' }, 400);
    } catch (err) {
        console.error('Catering PATCH error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const id = params.id;
        if (!id) return json({ error: 'Missing id' }, 400);
        const existing = await getCateringRequestById(id);
        if (!existing) return json({ error: 'Request not found' }, 404);
        await deleteCateringRequest(id);
        return json({ ok: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
