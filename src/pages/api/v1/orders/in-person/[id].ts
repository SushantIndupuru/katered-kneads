import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../../lib/http';
import { deleteInPersonSale } from '../../../../../lib/db';

// Deletes a recorded in-person POS sale and returns its quantities to the
// drop's in-person pool. Note: this reverts stock only — it does NOT refund the
// customer's payment (that stays a manual Stripe action).
export const DELETE: APIRoute = async ({ params }) => {
    try {
        const id = params.id as string;
        const deleted = await deleteInPersonSale(id);
        if (!deleted) return json({ error: 'Sale not found' }, 404);
        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
