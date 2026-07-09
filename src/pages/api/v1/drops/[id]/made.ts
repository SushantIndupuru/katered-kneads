import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../../lib/http';
import { setMadeStock } from '../../../../../lib/db';

export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const dropId = params.id as string;
        const { menuItemId, madeStock } = await request.json();

        if (!menuItemId || typeof menuItemId !== 'string') {
            return json({ error: 'menuItemId is required' }, 400);
        }
        const value = Number(madeStock);
        if (!Number.isInteger(value) || value < 0) {
            return json({ error: 'madeStock must be a non-negative whole number' }, 400);
        }

        const result = await setMadeStock(dropId, menuItemId, value);
        return json(result);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
