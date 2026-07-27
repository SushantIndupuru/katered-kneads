import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../../lib/http';
import { deleteInPersonSale } from '../../../../../lib/db';

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
