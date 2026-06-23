import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../../lib/http';
import { setInPersonConsumed } from '../../../../../lib/db';

// Records in-person sales for one item of a drop. Body: { menuItemId, inPersonConsumed }.
// The value is the absolute units-sold count and is clamped server-side to the
// item's in-person stock.
export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const dropId = params.id as string;
        const { menuItemId, inPersonConsumed } = await request.json();

        if (!menuItemId || typeof menuItemId !== 'string') {
            return json({ error: 'menuItemId is required' }, 400);
        }
        const value = Number(inPersonConsumed);
        if (!Number.isInteger(value) || value < 0) {
            return json({ error: 'inPersonConsumed must be a non-negative whole number' }, 400);
        }

        const result = await setInPersonConsumed(dropId, menuItemId, value);
        return json(result);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
