import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getCateringRequests } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const requests = await getCateringRequests();
        return json({ requests });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
