import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { listNewItems, createNewItem, reorderNewItems } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const newItems = await listNewItems();
        return json({ newItems });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const { id, tag } = await request.json();
        if (!id) return json({ error: 'Missing item id' }, 400);
        const newItem = await createNewItem(id, tag ?? '');
        return json({ newItem }, 201);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const { ids } = await request.json();
        if (!Array.isArray(ids)) return json({ error: 'ids must be an array' }, 400);
        await reorderNewItems(ids);
        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

