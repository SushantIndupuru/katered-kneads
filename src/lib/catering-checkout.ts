import type Stripe from 'stripe';
import type { CateringRequest } from '../types/db-types.ts';
import { getStripe } from './stripe.ts';

// Creates an Elements-mode Checkout Session so the customer pays on our site
// (same pattern as drop checkout). Charges the manually agreed total as one line.
export async function createCateringCheckoutSession(input: {
    request: Pick<CateringRequest, 'id' | 'customerEmail' | 'customerName'>;
    subtotalCents: number;
    origin: string;
}): Promise<Stripe.Checkout.Session> {
    if (!Number.isInteger(input.subtotalCents) || input.subtotalCents <= 0) {
        throw new Error('Agreed total must be greater than zero');
    }

    const stripe = getStripe();
    const metadata: Record<string, string> = {
        kind: 'catering',
        cateringRequestId: input.request.id,
    };

    const label = input.request.customerName
        ? `Catering order — ${input.request.customerName}`
        : 'Catering order';

    return stripe.checkout.sessions.create({
        ui_mode: 'elements',
        mode: 'payment',
        payment_method_types: ['card'],
        customer_email: input.request.customerEmail,
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: { name: label },
                    unit_amount: input.subtotalCents,
                },
                quantity: 1,
            },
        ],
        return_url: `${input.origin}/catering/success?session_id={CHECKOUT_SESSION_ID}`,
        metadata,
        payment_intent_data: { metadata },
    });
}
