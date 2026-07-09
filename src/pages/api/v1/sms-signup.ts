import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../lib/http';
import { normalizeUsPhone } from '../../../lib/phone';
import { subscribeSms } from '../../../lib/db';

export const POST: APIRoute = async ({ request }) => {
    try {
        const body = await request.json().catch(() => ({}));
        const rawPhone = typeof body?.phone === 'string' ? body.phone : '';
        const consent = body?.consent !== false;
        const source = typeof body?.source === 'string' ? body.source.trim().slice(0, 40) : '';

        const phone = normalizeUsPhone(rawPhone);
        if (!phone) {
            return json({ error: 'Enter a valid US phone number.' }, 400);
        }
        if (!consent) {
            return json({ error: 'Please agree to receive text updates.' }, 400);
        }

        await subscribeSms(phone, source);
        return json({ ok: true });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
