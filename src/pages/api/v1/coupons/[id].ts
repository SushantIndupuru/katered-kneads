import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { updateCoupon, deleteCoupon, getCouponById } from '../../../../lib/db';

export const GET: APIRoute = async ({ params }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing coupon ID' }, 400);
        const coupon = await getCouponById(id);
        if (!coupon) return json({ error: 'Coupon not found' }, 404);
        return json({ coupon });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing coupon ID' }, 400);
        const body = await request.json();
        const updates: {
            active?: boolean;
            expiresAt?: string | null;
            maxRedemptions?: number | null;
            minSubtotalCents?: number | null;
        } = {};

        if (body?.active !== undefined) updates.active = Boolean(body.active);
        if (body?.expiresAt !== undefined) {
            updates.expiresAt = body.expiresAt == null || body.expiresAt === ''
                ? null
                : String(body.expiresAt);
        }
        if (body?.maxRedemptions !== undefined) {
            updates.maxRedemptions = body.maxRedemptions == null || body.maxRedemptions === ''
                ? null
                : Number(body.maxRedemptions);
            if (
                updates.maxRedemptions != null
                && (!Number.isInteger(updates.maxRedemptions) || updates.maxRedemptions <= 0)
            ) {
                return json({ error: 'Max redemptions must be a positive integer' }, 400);
            }
        }
        if (body?.minSubtotalCents !== undefined) {
            updates.minSubtotalCents = body.minSubtotalCents == null || body.minSubtotalCents === ''
                ? null
                : Number(body.minSubtotalCents);
            if (
                updates.minSubtotalCents != null
                && (!Number.isInteger(updates.minSubtotalCents) || updates.minSubtotalCents < 0)
            ) {
                return json({ error: 'Minimum subtotal must be a non-negative integer (cents)' }, 400);
            }
        }

        const coupon = await updateCoupon(id, updates);
        return json({ coupon });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing coupon ID' }, 400);
        await deleteCoupon(id);
        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
