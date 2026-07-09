import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getOrders } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const orders = await getOrders({ statuses: ['paid', 'fulfilled'] });
        return json({ orders });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
