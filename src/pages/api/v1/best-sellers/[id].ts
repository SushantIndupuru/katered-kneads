import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { updateBestSeller, deleteBestSeller } from '../../../../lib/db/best-sellers';

export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing id' }, 400);
        const { tag } = await request.json();
        const bestSeller = await updateBestSeller(id, tag ?? '');
        return json({ bestSeller });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const { id } = params;
        if (!id) return json({ error: 'Missing id' }, 400);
        await deleteBestSeller(id);
        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
