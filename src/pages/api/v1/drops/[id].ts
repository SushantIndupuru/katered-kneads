import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import {
    getDrop,
    getDropItems,
    updateDrop,
    setDropItems,
    deleteDrop,
    parseDropItems,
} from '../../../../lib/db';
import type { Drop } from '../../../../types/db-types';

export const GET: APIRoute = async ({ params }) => {
    try {
        const id = params.id as string;
        const drop = await getDrop(id);
        if (!drop) return json({ error: 'Drop not found' }, 404);
        const items = await getDropItems(id);
        return json({ drop, items });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};

export const PATCH: APIRoute = async ({ params, request }) => {
    try {
        const id = params.id as string;
        const existing = await getDrop(id);
        if (!existing) return json({ error: 'Drop not found' }, 404);

        const body = await request.json();
        const { name, openTime, closeTime, pickupTime, locationName, locationAddress, items, announce, archive } = body;

        const updates: Partial<Omit<Drop, 'id'>> = {};

        // Lightweight lifecycle actions (announce / unannounce / archive) can be
        // sent on their own without a full schedule payload.
        if (announce !== undefined) {
            updates.announcedAt = announce ? new Date().toISOString() : null;
        }
        if (archive === true) {
            updates.archivedAt = new Date().toISOString();
        }

        // Full edit: name + schedule are validated together when provided.
        const editingSchedule = name !== undefined || openTime !== undefined || closeTime !== undefined;
        if (editingSchedule) {
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
            updates.name = name.trim();
            updates.openTime = open.toISOString();
            updates.closeTime = close.toISOString();
        }

        // Pickup time can be edited independently of the schedule. Empty/null
        // clears it; any provided value must be a valid date.
        if (pickupTime !== undefined) {
            if (pickupTime === null || pickupTime === '') {
                updates.pickupTime = null;
            } else {
                const pickup = new Date(pickupTime);
                if (Number.isNaN(pickup.getTime())) {
                    return json({ error: 'Invalid pickup time' }, 400);
                }
                updates.pickupTime = pickup.toISOString();
            }
        }

        // Location fields can be edited independently of the schedule.
        if (locationName !== undefined) {
            updates.locationName = typeof locationName === 'string' ? locationName.trim() : '';
        }
        if (locationAddress !== undefined) {
            updates.locationAddress = typeof locationAddress === 'string' ? locationAddress.trim() : '';
        }

        let parsedItems = null;
        if (items != null) {
            const parsed = parseDropItems(items);
            if (!Array.isArray(parsed)) return json({ error: parsed.error }, 400);
            parsedItems = parsed;
        }

        const drop = Object.keys(updates).length > 0
            ? await updateDrop(id, updates)
            : existing;

        if (parsedItems != null) {
            await setDropItems(id, parsedItems);
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

        await deleteDrop(id);

        return json({ success: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
