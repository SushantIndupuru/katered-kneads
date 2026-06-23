import Stripe from 'stripe';

let client: Stripe | null = null;

// Read at call time from process.env so the secret resolves at runtime on the
// server (Vercel) instead of being inlined at build time by Vite.
function getSecretKey(): string {
    const key = process.env.STRIPE_SECRET_KEY ?? import.meta.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
    return key;
}

export function getStripe(): Stripe {
    if (!client) {
        client = new Stripe(getSecretKey());
    }
    return client;
}
