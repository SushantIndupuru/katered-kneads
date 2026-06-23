import type {APIRoute} from 'astro';
import {json, getErrorMessage} from '../../../../lib/http';
import {updateMenuItem, deleteMenuItem} from '../../../../lib/db/menu-items';
import {
    getDropsForMenuItem,
    deleteDrop,
    getActiveDrop,
} from '../../../../lib/db';

export const GET: APIRoute = async ({params}) => {
    try {
        const {id} = params;
        if (!id) return json({error: 'Missing menu item ID'}, 400);
        const [drops, activeDrop] = await Promise.all([
            getDropsForMenuItem(id),
            getActiveDrop(),
        ]);
        return json({
            drops: drops.map(d => ({id: d.id, name: d.name, isCurrent: d.id === activeDrop?.id})),
        });
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('Error loading drops for menu item:', message);
        return json({error: message}, 500);
    }
};

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

export const DELETE: APIRoute = async ({params, url}) => {
    try {
        const {id} = params;
        if (!id) return json({error: 'Missing menu item ID'}, 400);

        const force = url.searchParams.get('force') === 'true';
        const drops = await getDropsForMenuItem(id);

        if (drops.length > 0 && !force) {
            // Block: caller must explicitly confirm cascading deletion of the drops.
            return json({
                error: 'Menu item is used in one or more drops',
                drops: drops.map(d => ({id: d.id, name: d.name})),
            }, 409);
        }

        if (force && drops.length > 0) {
            for (const drop of drops) {
                await deleteDrop(drop.id);
            }
        }

        await deleteMenuItem(id);
        return json({success: true});
    } catch (err) {
        const message = getErrorMessage(err);
        console.error('Error deleting menu item:', message);
        return json({error: message}, 500);
    }
};
