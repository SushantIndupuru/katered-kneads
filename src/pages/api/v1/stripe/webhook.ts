import type { APIRoute } from 'astro';
import type Stripe from 'stripe';
import { getStripe } from '../../../../lib/stripe';
import { finalizeOrderIfPaid, finalizeInPersonSaleIfPaid } from '../../../../lib/fulfillment';

const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET ?? import.meta.env.STRIPE_WEBHOOK_SECRET;

export const POST: APIRoute = async ({ request }) => {
    const signature = request.headers.get('stripe-signature');
    if (!signature || !webhookSecret) {
        return new Response('Missing signature or webhook secret', { status: 400 });
    }

    const payload = await request.text();
    const stripe = getStripe();

    let event: Stripe.Event;
    try {
        event = await stripe.webhooks.constructEventAsync(payload, signature, webhookSecret);
    } catch (err) {
        console.error('Webhook signature verification failed:', err);
        return new Response('Invalid signature', { status: 400 });
    }

    try {
        if (
            event.type === 'checkout.session.completed' ||
            event.type === 'checkout.session.async_payment_succeeded'
        ) {
            const session = event.data.object as Stripe.Checkout.Session;
            await finalizeOrderIfPaid(session.id);
        } else if (event.type === 'payment_intent.succeeded') {
            const intent = event.data.object as Stripe.PaymentIntent;
            if (intent.metadata?.kind === 'in_person') {
                await finalizeInPersonSaleIfPaid(intent.id);
            }
        }

        return new Response('ok', { status: 200 });
    } catch (err) {
        console.error('Webhook handler error:', err);
        return new Response('Webhook handler error', { status: 500 });
    }
};
