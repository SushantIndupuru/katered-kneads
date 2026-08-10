import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../../lib/http';
import {
    getCateringRequestById,
    markCateringApproved,
} from '../../../../../lib/db';
import { getStripe } from '../../../../../lib/stripe';
import { createCateringCheckoutSession } from '../../../../../lib/catering-checkout';

// Public: load client secret + quote summary for the on-site catering pay page.
export const GET: APIRoute = async ({ params, url }) => {
    try {
        const id = params.id;
        if (!id) return json({ error: 'Missing id' }, 400);

        const request = await getCateringRequestById(id);
        if (!request) return json({ error: 'Quote not found' }, 404);

        if (request.status === 'paid') {
            return json({
                status: 'paid',
                sessionId: request.stripeCheckoutSessionId,
            });
        }
        if (request.status === 'rejected') {
            return json({ error: 'This quote is no longer available' }, 410);
        }
        if (request.status !== 'approved') {
            return json({ error: 'This quote is not ready for payment yet' }, 409);
        }
        if (request.subtotalCents <= 0 || request.items.length === 0) {
            return json({ error: 'Quote total must be greater than zero' }, 409);
        }

        const stripe = getStripe();
        let sessionId = request.stripeCheckoutSessionId;
        let clientSecret: string | null = null;

        if (sessionId) {
            try {
                const existing = await stripe.checkout.sessions.retrieve(sessionId);
                if (existing.status === 'complete' || existing.payment_status === 'paid') {
                    return json({
                        status: 'paid',
                        sessionId: existing.id,
                    });
                }
                if (existing.status === 'open' && existing.client_secret) {
                    clientSecret = existing.client_secret;
                }
            } catch (err) {
                console.warn('Could not retrieve catering checkout session; creating a new one:', getErrorMessage(err));
            }
        }

        // Session missing, expired, or no longer open — mint a fresh Elements session.
        if (!clientSecret) {
            const session = await createCateringCheckoutSession({
                request: {
                    id: request.id,
                    customerEmail: request.customerEmail,
                    customerName: request.customerName,
                },
                subtotalCents: request.subtotalCents,
                origin: url.origin,
            });
            if (!session.client_secret) {
                return json({ error: 'Could not initialize payment' }, 500);
            }
            await markCateringApproved({
                id: request.id,
                stripeCheckoutSessionId: session.id,
                subtotalCents: request.subtotalCents,
                adminNote: request.adminNote,
            });
            sessionId = session.id;
            clientSecret = session.client_secret;
        }

        return json({
            status: 'approved',
            clientSecret,
            sessionId,
            quote: {
                id: request.id,
                customerName: request.customerName,
                eventDate: request.eventDate,
                adminNote: request.adminNote,
                subtotalCents: request.subtotalCents,
                items: request.items.map(i => ({
                    nameSnapshot: i.nameSnapshot,
                    unitPriceCents: i.unitPriceCents,
                    quantity: i.quantity,
                })),
            },
        });
    } catch (err) {
        console.error('Catering pay GET error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};
