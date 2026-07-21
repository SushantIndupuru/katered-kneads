import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { deleteSmsSubscriber } from '../../../../lib/db';

// Admin-only (protected by middleware): permanently remove a subscriber.
export const DELETE: APIRoute = async ({ params }) => {
    try {
        const id = params.id;
        if (!id) {
            return json({ error: 'Subscriber id is required.' }, 400);
        }
        await deleteSmsSubscriber(id);
        return json({ ok: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
