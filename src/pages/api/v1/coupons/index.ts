import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { listCoupons, createCoupon } from '../../../../lib/db';
import type { CouponType } from '../../../../types/db-types';

export const GET: APIRoute = async () => {
    try {
        const coupons = await listCoupons();
        return json({ coupons });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const code = typeof body?.code === 'string' ? body.code : '';
        const type = body?.type as CouponType;
        const value = Number(body?.value);
        const expiresAt = body?.expiresAt == null || body.expiresAt === ''
            ? null
            : String(body.expiresAt);
        const maxRedemptions = body?.maxRedemptions == null || body.maxRedemptions === ''
            ? null
            : Number(body.maxRedemptions);
        const minSubtotalCents = body?.minSubtotalCents == null || body.minSubtotalCents === ''
            ? null
            : Number(body.minSubtotalCents);

        // Frontend sends fixed discounts in dollars; convert to cents for storage.
        let storedValue = value;
        if (type === 'fixed') {
            if (!Number.isFinite(value) || value <= 0) {
                return json({ error: 'Fixed discount must be a positive dollar amount' }, 400);
            }
            storedValue = Math.round(value * 100);
        } else if (type === 'percent') {
            if (!Number.isInteger(value) || value <= 0 || value > 100) {
                return json({ error: 'Percent must be a whole number from 1 to 100' }, 400);
            }
        } else {
            return json({ error: 'Type must be percent or fixed' }, 400);
        }

        if (maxRedemptions != null && (!Number.isInteger(maxRedemptions) || maxRedemptions <= 0)) {
            return json({ error: 'Max redemptions must be a positive integer' }, 400);
        }
        if (minSubtotalCents != null && (!Number.isInteger(minSubtotalCents) || minSubtotalCents < 0)) {
            return json({ error: 'Minimum subtotal must be a non-negative integer (cents)' }, 400);
        }

        const coupon = await createCoupon({
            code,
            type,
            value: storedValue,
            expiresAt,
            maxRedemptions,
            minSubtotalCents,
        });
        return json({ coupon }, 201);
    } catch (err) {
        const message = getErrorMessage(err);
        if (message.includes('duplicate') || message.includes('unique')) {
            return json({ error: 'That promo code already exists' }, 409);
        }
        return json({ error: message }, 500);
    }
};
