import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getActiveDrop, getArchivedDrops, createDrop, parseDropItems } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const [activeDrop, olderDrops] = await Promise.all([getActiveDrop(), getArchivedDrops()]);
        return json({ activeDrop, olderDrops });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const POST: APIRoute = async ({ request }) => {
    try {
        const { name, openTime, closeTime, pickupTime, locationName, locationAddress, lowStockThreshold, items } = await request.json();

        // Single-active model: only one non-archived drop at a time.
        const existingActive = await getActiveDrop();
        if (existingActive) {
            return json({ error: 'Archive the current active drop before creating a new one.' }, 409);
        }

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

        let pickupIso: string | null = null;
        if (pickupTime) {
            const pickup = new Date(pickupTime);
            if (Number.isNaN(pickup.getTime())) {
                return json({ error: 'Invalid pickup time' }, 400);
            }
            pickupIso = pickup.toISOString();
        }

        const parsed = parseDropItems(items);
        if (!Array.isArray(parsed)) return json({ error: parsed.error }, 400);

        let threshold = 0;
        if (lowStockThreshold != null && lowStockThreshold !== '') {
            threshold = Number(lowStockThreshold);
            if (!Number.isInteger(threshold) || threshold < 0) {
                return json({ error: 'Low stock threshold must be a non-negative whole number' }, 400);
            }
        }

        const drop = await createDrop({
            name: name.trim(),
            openTime: open.toISOString(),
            closeTime: close.toISOString(),
            pickupTime: pickupIso,
            locationName: typeof locationName === 'string' ? locationName.trim() : '',
            locationAddress: typeof locationAddress === 'string' ? locationAddress.trim() : '',
            announcedAt: null,
            archivedAt: null,
            lowStockThreshold: threshold,
        }, parsed);

        return json({ drop }, 201);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
