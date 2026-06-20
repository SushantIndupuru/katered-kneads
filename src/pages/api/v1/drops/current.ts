import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getCurrentDropId, setCurrentDropId, getDrops, setConfig, CURRENT_DROP_KEY } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const currentDropId = await getCurrentDropId();
        return json({ currentDropId });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const PUT: APIRoute = async ({ request }) => {
    try {
        const { id } = await request.json();

        // A null/empty id clears the current drop (nothing shown on the site).
        if (id === null || id === '') {
            await setConfig(CURRENT_DROP_KEY, null);
            return json({ currentDropId: null });
        }

        if (!id || typeof id !== 'string') {
            return json({ error: 'Drop id is required' }, 400);
        }

        const drops = await getDrops();
        if (!drops.some(drop => drop.id === id)) {
            return json({ error: 'Drop not found' }, 404);
        }

        await setCurrentDropId(id);
        return json({ currentDropId: id });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
