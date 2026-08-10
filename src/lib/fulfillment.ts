import type Stripe from 'stripe';
import type { CateringRequest, Order } from '../types/db-types.ts';
import { getStripe } from './stripe.ts';
import {
    getOrderByCheckoutSession,
    createPaidOrder,
    decrementDropStock,
    incrementInPersonConsumed,
    recordInPersonSale,
    getDrop,
    getDropItems,
    getPickupSpot,
    incrementCouponRedemption,
    getCateringRequestByCheckoutSession,
    markCateringPaid,
    type CreateOrderLine,
} from './db/index.ts';
import { unitPriceCents } from './pricing.ts';
import { sendOrderConfirmation, sendCateringPaidConfirmation } from './email.ts';

export interface FinalizeResult {
    order: Order | null;
    // True when this call actually created the paid order (and thus decremented
    // stock + sent the confirmation email).
    finalized: boolean;
}

// Parses the compact `menuItemId:qty` cart string stashed in session metadata.
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

function parseNonNegInt(raw: string | undefined | null): number {
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 0;
}

// Idempotently finalize an order from a paid Checkout Session: create the paid
// order (from session metadata + the actual charged line items), decrement
// stock, and email the pickup code. Orders are never persisted before payment,
// so this is the single point where an order row comes into existence.
//
// Safe to call from both the Stripe webhook and the success page — the UNIQUE
// constraint on the session id ensures only the first caller creates the order
// and does the stock/email work.
export async function finalizeOrderIfPaid(sessionId: string): Promise<FinalizeResult> {
    // Fast path: already created by a prior webhook/success-page call.
    const existing = await getOrderByCheckoutSession(sessionId);
    if (existing) return { order: existing, finalized: false };

    const stripe = getStripe();

    let session: Stripe.Checkout.Session;
    try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
        console.error(`finalizeOrderIfPaid: could not retrieve checkout session ${sessionId}:`, err);
        return { order: null, finalized: false };
    }

    // Only persist confirmed payments (covers delayed/async methods too).
    if (session.payment_status !== 'paid') {
        return { order: null, finalized: false };
    }

    const meta = session.metadata ?? {};
    const cartPairs = parseCart(meta.cart);
    if (cartPairs.length === 0) {
        console.error(`finalizeOrderIfPaid: session ${sessionId} has no cart metadata`);
        return { order: null, finalized: false };
    }

    // Use the real charged line items as the price/name snapshot. They are
    // returned in creation order, matching the cart pairs we encoded. Tip is a
    // trailing line (after cart items); Stripe coupons are session-level and do
    // not appear as line items.
    let lineItems: Stripe.LineItem[];
    try {
        const res = await stripe.checkout.sessions.listLineItems(sessionId, { limit: 100 });
        lineItems = res.data;
    } catch (err) {
        console.error(`finalizeOrderIfPaid: could not list line items for ${sessionId}:`, err);
        return { order: null, finalized: false };
    }

    // Prefer current drop prices (incl. sale prices) for the order snapshot so
    // coupon discounts stay separate in discount_cents rather than baked into
    // unit prices (Stripe line amounts may already be post-discount).
    let items: CreateOrderLine[] = [];
    if (meta.dropId) {
        try {
            const dropItems = await getDropItems(meta.dropId);
            const byId = new Map(dropItems.map(di => [di.menuItem.id, di.menuItem]));
            items = cartPairs.map((pair, idx) => {
                const mi = byId.get(pair.menuItemId);
                const li = lineItems[idx];
                return {
                    menuItemId: pair.menuItemId,
                    nameSnapshot: mi?.name ?? li?.description ?? '',
                    unitPriceCents: mi ? unitPriceCents(mi) : (li?.price?.unit_amount ?? 0),
                    quantity: pair.quantity,
                };
            });
        } catch (err) {
            console.error(`finalizeOrderIfPaid: could not load drop items for ${meta.dropId}:`, err);
        }
    }
    if (items.length === 0) {
        items = cartPairs.map((pair, idx) => {
            const li = lineItems[idx];
            const quantity = li?.quantity ?? pair.quantity;
            const unit = li?.price?.unit_amount
                ?? (li?.amount_total && quantity ? Math.round(li.amount_total / quantity) : 0);
            return {
                menuItemId: pair.menuItemId,
                nameSnapshot: li?.description ?? '',
                unitPriceCents: unit,
                quantity,
            };
        });
    }

    const paymentIntentId = typeof session.payment_intent === 'string'
        ? session.payment_intent
        : session.payment_intent?.id ?? null;
    // Subtotal is items at sale/list unit price (pre-coupon). Tip and discount
    // come from metadata.
    const subtotalCents = items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    const tipCents = parseNonNegInt(meta.tip);
    const discountCents = Math.min(parseNonNegInt(meta.discount), subtotalCents);
    const couponCode = typeof meta.coupon === 'string' && meta.coupon.trim()
        ? meta.coupon.trim().toUpperCase()
        : null;
    const email = session.customer_details?.email ?? session.customer_email ?? '';

    // Snapshot the pickup details now that payment is confirmed. The exact
    // address is only ever read into a paid order, so it never reaches a
    // customer who hasn't paid. Prefer the spot the customer chose at checkout;
    // fall back to the drop's legacy single-spot fields for older drops.
    let pickupTime: string | null = null;
    let pickupTimeEnd: string | null = null;
    let pickupLocation = '';
    let pickupAddress = '';
    if (meta.pickupSpotId) {
        try {
            const spot = await getPickupSpot(meta.pickupSpotId);
            if (spot) {
                pickupTime = spot.pickupStart;
                pickupTimeEnd = spot.pickupEnd;
                pickupLocation = spot.locationName;
                pickupAddress = spot.locationAddress;
            }
        } catch (err) {
            console.error(`finalizeOrderIfPaid: could not load pickup spot ${meta.pickupSpotId}:`, err);
        }
    }
    if (!pickupLocation && !pickupAddress && !pickupTime && meta.dropId) {
        try {
            const drop = await getDrop(meta.dropId);
            if (drop) {
                pickupTime = drop.pickupTime;
                pickupLocation = drop.locationName;
                pickupAddress = drop.locationAddress;
            }
        } catch (err) {
            console.error(`finalizeOrderIfPaid: could not load drop ${meta.dropId} for location:`, err);
        }
    }

    const order = await createPaidOrder({
        dropId: meta.dropId ?? null,
        customerName: meta.name ?? session.customer_details?.name ?? '',
        customerEmail: email,
        customerPhone: meta.phone ?? '',
        pickupTime,
        pickupTimeEnd,
        pickupLocation,
        pickupAddress,
        subtotalCents,
        discountCents,
        couponCode,
        tipCents,
        stripeCheckoutSessionId: sessionId,
        stripePaymentIntentId: paymentIntentId,
        items,
    });

    // Lost the race — another caller created the order first; don't double-work.
    if (!order) {
        const current = await getOrderByCheckoutSession(sessionId);
        return { order: current, finalized: false };
    }

    // Decrement stock; if it oversells we keep the order (payment already
    // captured) and surface the error in logs for the owner to reconcile.
    if (order.dropId) {
        const lines = order.items
            .filter(i => i.menuItemId)
            .map(i => ({ menuItemId: i.menuItemId as string, quantity: i.quantity }));
        if (lines.length > 0) {
            try {
                await decrementDropStock(order.dropId, lines);
            } catch (stockErr) {
                console.error(`finalizeOrderIfPaid: stock decrement failed for order ${order.id}:`, stockErr);
            }
        }
    }

    if (meta.couponId && discountCents > 0) {
        try {
            await incrementCouponRedemption(meta.couponId);
        } catch (couponErr) {
            console.error(`finalizeOrderIfPaid: coupon redemption failed for order ${order.id}:`, couponErr);
        }
    }

    try {
        await sendOrderConfirmation(order);
    } catch (emailErr) {
        console.error(`finalizeOrderIfPaid: failed to send email for order ${order.id}:`, emailErr);
    }

    return { order, finalized: true };
}

export interface InPersonFinalizeResult {
    // True once Stripe confirms the QR payment succeeded.
    paid: boolean;
    // True when this call actually recorded the sale (won the idempotency race
    // and incremented the in-person pool). False on repeat calls.
    recorded: boolean;
    subtotalCents: number;
    discountCents: number;
    tipCents: number;
    totalCents: number;
}

// Idempotently finalize an in-person POS sale from a succeeded PaymentIntent:
// record the sale (UNIQUE payment-intent id guards against double-processing)
// and increment the drop's in-person consumed pool. Safe to call from both the
// Stripe webhook and the POS status poll. PaymentIntents created by the
// in-person POS carry `metadata.kind === 'in_person'`.
export async function finalizeInPersonSaleIfPaid(paymentIntentId: string): Promise<InPersonFinalizeResult> {
    const stripe = getStripe();

    let intent: Stripe.PaymentIntent;
    try {
        intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    } catch (err) {
        console.error(`finalizeInPersonSaleIfPaid: could not retrieve PaymentIntent ${paymentIntentId}:`, err);
        return { paid: false, recorded: false, subtotalCents: 0, discountCents: 0, tipCents: 0, totalCents: 0 };
    }

    const meta = intent.metadata ?? {};
    if (meta.kind !== 'in_person') {
        return { paid: false, recorded: false, subtotalCents: 0, discountCents: 0, tipCents: 0, totalCents: 0 };
    }

    // Prefer metadata amounts (pre-coupon subtotal + discount + tip) so totals
    // stay correct when a promo was applied. Fall back to intent.amount - tip.
    const tipCents = parseNonNegInt(meta.tip);
    const discountCents = parseNonNegInt(meta.discount);
    let subtotalCents = parseNonNegInt(meta.subtotal);
    if (!subtotalCents) {
        subtotalCents = Math.max((intent.amount ?? 0) - tipCents + discountCents, 0);
    }
    const totalCents = Math.max(subtotalCents - discountCents, 0) + tipCents;
    const couponCode = typeof meta.coupon === 'string' && meta.coupon.trim()
        ? meta.coupon.trim().toUpperCase()
        : null;

    if (intent.status !== 'succeeded') {
        return { paid: false, recorded: false, subtotalCents, discountCents, tipCents, totalCents };
    }

    const cartPairs = parseCart(meta.cart);
    if (cartPairs.length === 0) {
        console.error(`finalizeInPersonSaleIfPaid: PaymentIntent ${paymentIntentId} has no cart metadata`);
        return { paid: true, recorded: false, subtotalCents, discountCents, tipCents, totalCents };
    }

    const dropId = meta.dropId ?? null;

    // Rebuild the item name/price snapshot from the drop's current menu items
    // (including active sale prices).
    let priceById = new Map<string, { name: string; unitPriceCents: number }>();
    if (dropId) {
        try {
            const dropItems = await getDropItems(dropId);
            priceById = new Map(dropItems.map(di => [di.menuItem.id, {
                name: di.menuItem.name,
                unitPriceCents: unitPriceCents(di.menuItem),
            }]));
        } catch (err) {
            console.error(`finalizeInPersonSaleIfPaid: could not load drop items for ${dropId}:`, err);
        }
    }

    const items = cartPairs.map(pair => {
        const info = priceById.get(pair.menuItemId);
        return {
            menuItemId: pair.menuItemId,
            nameSnapshot: info?.name ?? '',
            unitPriceCents: info?.unitPriceCents ?? 0,
            quantity: pair.quantity,
        };
    });

    const recorded = await recordInPersonSale({
        dropId,
        subtotalCents,
        discountCents,
        couponCode,
        tipCents,
        stripePaymentIntentId: paymentIntentId,
        items,
    });

    // Lost the race — already recorded by another caller; don't double-count.
    if (!recorded) return { paid: true, recorded: false, subtotalCents, discountCents, tipCents, totalCents };

    if (dropId) {
        const lines = items.map(i => ({ menuItemId: i.menuItemId, quantity: i.quantity }));
        try {
            await incrementInPersonConsumed(dropId, lines);
        } catch (stockErr) {
            console.error(`finalizeInPersonSaleIfPaid: in-person increment failed for ${paymentIntentId}:`, stockErr);
        }
    }

    if (meta.couponId && discountCents > 0) {
        try {
            await incrementCouponRedemption(meta.couponId);
        } catch (couponErr) {
            console.error(`finalizeInPersonSaleIfPaid: coupon redemption failed for ${paymentIntentId}:`, couponErr);
        }
    }

    return { paid: true, recorded: true, subtotalCents, discountCents, tipCents, totalCents };
}

export interface FinalizeCateringResult {
    request: CateringRequest | null;
    finalized: boolean;
}

// Idempotently mark a catering quote as paid after Stripe Checkout completes.
// Safe from both webhook and the success page (status check prevents double-email).
export async function finalizeCateringIfPaid(sessionId: string): Promise<FinalizeCateringResult> {
    const existing = await getCateringRequestByCheckoutSession(sessionId);
    if (!existing) return { request: null, finalized: false };
    if (existing.status === 'paid') return { request: existing, finalized: false };

    const stripe = getStripe();
    let session: Stripe.Checkout.Session;
    try {
        session = await stripe.checkout.sessions.retrieve(sessionId);
    } catch (err) {
        console.error(`finalizeCateringIfPaid: could not retrieve session ${sessionId}:`, err);
        return { request: null, finalized: false };
    }

    if (session.payment_status !== 'paid') {
        return { request: existing, finalized: false };
    }

    const paymentIntentId =
        typeof session.payment_intent === 'string'
            ? session.payment_intent
            : session.payment_intent?.id ?? null;

    const paid = await markCateringPaid({
        id: existing.id,
        stripePaymentIntentId: paymentIntentId,
    });
    if (!paid) {
        // Lost the race or already paid — re-fetch current row.
        const again = await getCateringRequestByCheckoutSession(sessionId);
        return { request: again, finalized: false };
    }

    try {
        await sendCateringPaidConfirmation(paid);
    } catch (emailErr) {
        console.error(`finalizeCateringIfPaid: email failed for ${existing.id}:`, emailErr);
    }

    return { request: paid, finalized: true };
}
