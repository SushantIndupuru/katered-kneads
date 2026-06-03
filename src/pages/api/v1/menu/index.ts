import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { createMenuItem } from '../../../../lib/db/menu-items';

export const POST: APIRoute = async ({ request }) => {
    try {
        const { id, name, description, tag, mystery } = await request.json();
        if (!name || !description) {
            return json({ error: 'Name and description are required' }, 400);
        }
        const item = await createMenuItem({ id, name, description, tag, mystery });
        return json({ item }, 201);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
