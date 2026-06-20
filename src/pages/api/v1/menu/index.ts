import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { createMenuItem } from '../../../../lib/db/menu-items';
import type {MenuItem} from "../../../../types/db-types.ts";

export const POST: APIRoute = async ({ request }) => {
    try {
        const item:MenuItem = await request.json();
        if (!item.name || !item.description) {
            return json({ error: 'Name and description are required' }, 400);
        }
        const writtenItem = await createMenuItem(item);
        return json({ writtenItem }, 201);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};