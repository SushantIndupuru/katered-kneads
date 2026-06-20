import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getDrops, createDrop, getCurrentDropId, setCurrentDropId, parseDropItems } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const [drops, currentDropId] = await Promise.all([getDrops(), getCurrentDropId()]);
        return json({ drops, currentDropId });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
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

        const drop = await createDrop({
            name: name.trim(),
            openTime: open.toISOString(),
            closeTime: close.toISOString(),
            showCountdown: Boolean(showCountdown),
        }, parsed);

        if (setCurrent) {
            await setCurrentDropId(drop.id);
        }

        return json({ drop }, 201);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
