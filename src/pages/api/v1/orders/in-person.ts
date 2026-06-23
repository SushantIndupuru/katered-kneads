import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../../lib/http';
import { getInPersonSales } from '../../../../lib/db';

export const GET: APIRoute = async () => {
    try {
        const sales = await getInPersonSales();
        return json({ sales });
    } catch (err) {
        return json({ error: getErrorMessage(err) }, 500);
    }
};
