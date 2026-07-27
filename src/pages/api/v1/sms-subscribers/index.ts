import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { normalizeUsPhone } from '../../../../lib/phone';
import { subscribeSms } from '../../../../lib/db';

// Admin-only (protected by middleware): manually add a number to the SMS list.
export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json().catch(() => ({}));
        const rawPhone = typeof body?.phone === 'string' ? body.phone : '';

        const phone = normalizeUsPhone(rawPhone);
        if (!phone) {
            return json({ error: 'Enter a valid US phone number.' }, 400);
        }

        const subscriber = await subscribeSms(phone, 'admin');
        return json({ subscriber }, 201);
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
