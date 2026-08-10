import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getMenuItems, createCateringRequest } from '../../../../lib/db';
import { sendCateringRequestNotify } from '../../../../lib/email';

interface QuoteLine {
    menuItemId: string;
    quantity: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_QTY = 500;
const MAX_NOTES = 2000;

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json();
        const {
            items,
            customer,
            eventDate: rawEventDate,
            notes: rawNotes,
        } = body ?? {};

        const name = typeof customer?.name === 'string' ? customer.name.trim() : '';
        const email = typeof customer?.email === 'string' ? customer.email.trim() : '';
        const phone = typeof customer?.phone === 'string' ? customer.phone.trim() : '';
        const eventDate = typeof rawEventDate === 'string' ? rawEventDate.trim().slice(0, 120) : '';
        const notes = typeof rawNotes === 'string' ? rawNotes.trim().slice(0, MAX_NOTES) : '';

        if (!name) return json({ error: 'Name is required' }, 400);
        if (!EMAIL_RE.test(email)) return json({ error: 'A valid email is required' }, 400);
        if (!Array.isArray(items) || items.length === 0) {
            return json({ error: 'Select at least one item' }, 400);
        }

        const menu = await getMenuItems();
        const byId = new Map(menu.map(m => [m.id, m]));

        const orderLines = [];
        const seen = new Set<string>();
        for (const raw of items as QuoteLine[]) {
            const menuItemId = raw?.menuItemId;
            const quantity = Number(raw?.quantity);
            if (!menuItemId || typeof menuItemId !== 'string') {
                return json({ error: 'Invalid item' }, 400);
            }
            if (seen.has(menuItemId)) return json({ error: 'Duplicate item' }, 400);
            seen.add(menuItemId);
            if (!Number.isInteger(quantity) || quantity <= 0 || quantity > MAX_QTY) {
                return json({ error: 'Invalid quantity' }, 400);
            }

            const item = byId.get(menuItemId);
            if (!item) return json({ error: 'An item is no longer available' }, 409);

            // Pricing is agreed manually later — store quantities only.
            orderLines.push({
                menuItemId,
                nameSnapshot: item.name,
                unitPriceCents: 0,
                quantity,
            });
        }

        const created = await createCateringRequest({
            customerName: name,
            customerEmail: email,
            customerPhone: phone,
            eventDate,
            notes,
            items: orderLines,
        });

        try {
            await sendCateringRequestNotify(created);
        } catch (emailErr) {
            console.error('Catering notify email failed:', getErrorMessage(emailErr));
        }

        return json({ request: { id: created.id, status: created.status } }, 201);
    } catch (err) {
        console.error('Catering quote error:', getErrorMessage(err));
        return json({ error: getErrorMessage(err) }, 500);
    }
};
