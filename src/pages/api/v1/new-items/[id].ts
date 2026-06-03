import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { updateNewItem, deleteNewItem } from '../../../../lib/db/new-items';

export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing id' }, 400);
        const { tag } = await request.json();
        const newItem = await updateNewItem(id, tag ?? '');
        return json({ newItem });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing id' }, 400);
        await deleteNewItem(id);
        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
