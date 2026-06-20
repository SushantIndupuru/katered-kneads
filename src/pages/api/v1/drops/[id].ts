import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import {
    getDrop,
    getDropItems,
    updateDrop,
    setDropItems,
    deleteDrop,
    getCurrentDropId,
    setCurrentDropId,
    setConfig,
    parseDropItems,
    CURRENT_DROP_KEY,
} from '../../../../lib/db';

export const GET: APIRoute = async ({ params }) => {
    try {
        const id = params.id as string;
        const drop = await getDrop(id);
        if (!drop) return json({ error: 'Drop not found' }, 404);
        const items = await getDropItems(id);
        const currentDropId = await getCurrentDropId();
        return json({ drop, items, isCurrent: currentDropId === id });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const id = params.id as string;
        const existing = await getDrop(id);
        if (!existing) return json({ error: 'Drop not found' }, 404);

        const { name, openTime, closeTime, setCurrent, showCountdown, items } = await request.json();

        if (!name || typeof name !== 'string' || !name.trim()) {
            return json({ error: 'Name is required' }, 400);
        }
        if (!openTime || !closeTime) {
            return json({ error: 'Open and close times are required' }, 400);
        }
        const open = new Date(openTime);
        const close = new Date(closeTime);
        if (Number.isNaN(open.getTime()) || Number.isNaN(close.getTime())) {
            return json({ error: 'Invalid open or close time' }, 400);
        }
        if (close <= open) {
            return json({ error: 'Close time must be after open time' }, 400);
        }

        const parsed = parseDropItems(items);
        if (!Array.isArray(parsed)) return json({ error: parsed.error }, 400);

        const drop = await updateDrop(id, {
            name: name.trim(),
            openTime: open.toISOString(),
            closeTime: close.toISOString(),
            showCountdown: Boolean(showCountdown),
        });

        if (items != null) {
            await setDropItems(id, parsed);
        }

        const currentDropId = await getCurrentDropId();
        if (setCurrent) {
            await setCurrentDropId(id);
        } else if (currentDropId === id) {
            await setConfig(CURRENT_DROP_KEY, null);
        }

        return json({ drop });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const DELETE: APIRoute = async ({ params }) => {
    try {
        const id = params.id as string;
        const existing = await getDrop(id);
        if (!existing) return json({ error: 'Drop not found' }, 404);

        // deleteDrop clears the current_drop config if this was the active drop.
        await deleteDrop(id);

        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
