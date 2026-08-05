import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { validateCouponForCheckout } from '../../../../lib/db';

// Public preview: returns the discount for a code + subtotal without redeeming.
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json().catch(() => ({}));
        const code = typeof body?.code === 'string' ? body.code : '';
        const subtotalCents = Number(body?.subtotalCents);

        if (!code.trim()) {
            return json({ error: 'Enter a promo code' }, 400);
        }
        if (!Number.isInteger(subtotalCents) || subtotalCents < 0) {
            return json({ error: 'Invalid subtotal' }, 400);
        }
        if (subtotalCents <= 0) {
            return json({ error: 'Add items to your cart before applying a code' }, 400);
        }

        const result = await validateCouponForCheckout(code, subtotalCents);
        if (!result.ok) {
            return json({ error: result.message }, 400);
        }

        return json({
            couponCode: result.coupon.code,
            discountCents: result.discountCents,
            type: result.coupon.type,
            value: result.coupon.value,
        });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
