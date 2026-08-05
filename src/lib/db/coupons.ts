import { createServerClient } from '../supabase.ts';
import type { Coupon, CouponType } from '../../types/db-types.ts';
import { applyCoupon, normalizeCouponCode } from '../pricing.ts';

const COUPON_COLUMNS =
    'id, code, type, value, active, expires_at, max_redemptions, redemption_count, min_subtotal_cents, created_at';

interface CouponRow {
    id: string;
    code: string;
    type: string;
    value: number;
    active: boolean;
    expires_at: string | null;
    max_redemptions: number | null;
    redemption_count: number;
    min_subtotal_cents: number | null;
    created_at: string;
}

function mapCoupon(row: CouponRow): Coupon {
    return {
        id: row.id,
        code: row.code,
        type: row.type as CouponType,
        value: row.value,
        active: row.active,
        expiresAt: row.expires_at,
        maxRedemptions: row.max_redemptions,
        redemptionCount: row.redemption_count ?? 0,
        minSubtotalCents: row.min_subtotal_cents,
        createdAt: row.created_at,
    };
}

export async function listCoupons(): Promise<Coupon[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('coupons')
        .select(COUPON_COLUMNS)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data as CouponRow[]) ?? []).map(mapCoupon);
}

export async function getCouponByCode(code: string): Promise<Coupon | null> {
    const normalized = normalizeCouponCode(code);
    if (!normalized) return null;
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('coupons')
        .select(COUPON_COLUMNS)
        .eq('code', normalized)
        .maybeSingle();
    if (error) throw error;
    return data ? mapCoupon(data as CouponRow) : null;
}

export async function getCouponById(id: string): Promise<Coupon | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('coupons')
        .select(COUPON_COLUMNS)
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data ? mapCoupon(data as CouponRow) : null;
}

export interface CreateCouponInput {
    code: string;
    type: CouponType;
    value: number;
    active?: boolean;
    expiresAt?: string | null;
    maxRedemptions?: number | null;
    minSubtotalCents?: number | null;
}

export async function createCoupon(input: CreateCouponInput): Promise<Coupon> {
    const code = normalizeCouponCode(input.code);
    if (!code) throw new Error('Coupon code is required');
    if (input.type !== 'percent' && input.type !== 'fixed') {
        throw new Error('Coupon type must be percent or fixed');
    }
    if (!Number.isInteger(input.value) || input.value <= 0) {
        throw new Error('Coupon value must be a positive integer');
    }
    if (input.type === 'percent' && input.value > 100) {
        throw new Error('Percent coupons cannot exceed 100');
    }

    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('coupons')
        .insert({
            code,
            type: input.type,
            value: input.value,
            active: input.active !== false,
            expires_at: input.expiresAt ?? null,
            max_redemptions: input.maxRedemptions ?? null,
            min_subtotal_cents: input.minSubtotalCents ?? null,
        })
        .select(COUPON_COLUMNS)
        .single();
    if (error) throw error;
    return mapCoupon(data as CouponRow);
}

export interface UpdateCouponInput {
    active?: boolean;
    expiresAt?: string | null;
    maxRedemptions?: number | null;
    minSubtotalCents?: number | null;
}

export async function updateCoupon(id: string, updates: UpdateCouponInput): Promise<Coupon> {
    const supabase = createServerClient();
    const patch: Record<string, unknown> = {};
    if (updates.active !== undefined) patch.active = updates.active;
    if (updates.expiresAt !== undefined) patch.expires_at = updates.expiresAt;
    if (updates.maxRedemptions !== undefined) patch.max_redemptions = updates.maxRedemptions;
    if (updates.minSubtotalCents !== undefined) patch.min_subtotal_cents = updates.minSubtotalCents;

    const { data, error } = await supabase
        .from('coupons')
        .update(patch)
        .eq('id', id)
        .select(COUPON_COLUMNS)
        .single();
    if (error) throw error;
    return mapCoupon(data as CouponRow);
}

export async function deleteCoupon(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.from('coupons').delete().eq('id', id);
    if (error) throw error;
}

export type CouponValidationError =
    | 'not_found'
    | 'inactive'
    | 'expired'
    | 'max_redemptions'
    | 'min_subtotal';

export type CouponValidationResult =
    | {
        ok: true;
        coupon: Coupon;
        discountCents: number;
    }
    | {
        ok: false;
        error: CouponValidationError;
        message: string;
    };

// Validates a promo code against the current post-sale subtotal. Does not
// increment redemption_count — that happens only at payment finalize.
export async function validateCouponForCheckout(
    code: string,
    subtotalCents: number,
): Promise<CouponValidationResult> {
    const coupon = await getCouponByCode(code);
    if (!coupon) {
        return { ok: false, error: 'not_found', message: 'That promo code is not valid' };
    }
    if (!coupon.active) {
        return { ok: false, error: 'inactive', message: 'That promo code is no longer active' };
    }
    if (coupon.expiresAt && new Date(coupon.expiresAt).getTime() <= Date.now()) {
        return { ok: false, error: 'expired', message: 'That promo code has expired' };
    }
    if (
        coupon.maxRedemptions != null
        && coupon.redemptionCount >= coupon.maxRedemptions
    ) {
        return { ok: false, error: 'max_redemptions', message: 'That promo code has reached its usage limit' };
    }
    if (
        coupon.minSubtotalCents != null
        && subtotalCents < coupon.minSubtotalCents
    ) {
        const min = (coupon.minSubtotalCents / 100).toFixed(2);
        return {
            ok: false,
            error: 'min_subtotal',
            message: `That promo code requires a subtotal of at least $${min}`,
        };
    }

    const discountCents = applyCoupon(subtotalCents, coupon);
    return { ok: true, coupon, discountCents };
}

// Atomic redemption bump via SQL RPC. Call only after payment is confirmed.
export async function incrementCouponRedemption(couponId: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.rpc('increment_coupon_redemption', {
        p_coupon_id: couponId,
    });
    if (error) throw error;
}
