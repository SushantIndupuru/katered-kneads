import type {APIRoute} from 'astro';
import {json, getErrorMessage} from '../../../../lib/http';
import {updateMenuItem, deleteMenuItem} from '../../../../lib/db/menu-items';

export const PATCH: APIRoute = async ({params, request}) => {
    try {
        const {id} = params;
        if (!id) return json({error: 'Missing menu item ID'}, 400);
        const updates = await request.json();
        const item = await updateMenuItem(id, updates);
        return json({item});
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('Error updating menu item:', message);
        return json({error: message}, 500);
    }
};

export const DELETE: APIRoute = async ({params}) => {
    try {
        const {id} = params;
        if (!id) return json({error: 'Missing menu item ID'}, 400);
        await deleteMenuItem(id);
        return json({success: true});
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('Error deleting menu item:', message);

        return json({error: message}, 500);
    }
};