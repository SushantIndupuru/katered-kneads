import type { Coupon, MenuItem } from '../types/db-types.ts';

// Unit price charged for a menu item: sale price when set and lower than list.
export function unitPriceCents(item: Pick<MenuItem, 'price' | 'salePrice'>): number {
    const list = Math.round(Number(item.price) * 100);
    if (item.salePrice == null) return list;
    const sale = Math.round(Number(item.salePrice) * 100);
    if (!Number.isFinite(sale) || sale <= 0 || sale >= list) return list;
    return sale;
}

// Computes coupon discount in cents against a post-sale subtotal. Clamps fixed
// discounts to the subtotal; rounds percent to the nearest cent.
export function applyCoupon(subtotalCents: number, coupon: Pick<Coupon, 'type' | 'value'>): number {
    if (subtotalCents <= 0) return 0;
    if (coupon.type === 'percent') {
        const pct = Math.min(Math.max(coupon.value, 0), 100);
        return Math.min(Math.round((subtotalCents * pct) / 100), subtotalCents);
    }
    // fixed: value is cents
    return Math.min(Math.max(coupon.value, 0), subtotalCents);
}

export function normalizeCouponCode(raw: string): string {
    return raw.trim().toUpperCase();
}
