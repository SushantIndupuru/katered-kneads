import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { deleteOrder, updateOrderStatus } from '../../../../lib/db';
import type { OrderStatus } from '../../../../types/db-types';

const VALID_STATUSES: OrderStatus[] = ['paid', 'fulfilled'];

// Updates an order's status from the POS — e.g. marking it 'fulfilled' once it
// has been handed to the customer, or back to 'paid' to undo a mistake.
export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const id = params.id as string;
        const { status } = await request.json();

        if (!VALID_STATUSES.includes(status)) {
            return json({ error: 'status must be one of: paid, fulfilled' }, 400);
        }

        const order = await updateOrderStatus(id, status as OrderStatus);
        if (!order) return json({ error: 'Order not found' }, 404);
        return json({ order });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const id = params.id as string;
        const deleted = await deleteOrder(id);
        if (!deleted) return json({ error: 'Order not found' }, 404);
        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
