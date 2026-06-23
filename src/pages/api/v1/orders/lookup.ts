import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getOrderByPickupCode } from '../../../../lib/db';

// Looks up a single order by pickup/confirmation code for the POS counter.
// Usage: GET /api/v1/orders/lookup?code=AB3K9P
export const GET: APIRoute = async ({ url }) => {
    try {
        const code = url.searchParams.get('code')?.trim() ?? '';
        if (!code) {
            return json({ error: 'A confirmation code is required' }, 400);
        }

        const order = await getOrderByPickupCode(code);
        if (!order) {
            return json({ error: 'No order found for that code' }, 404);
        }
        return json({ order });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
