import type { APIRoute } from 'astro';
import { json, getErrorMessage } from '../../../lib/http';
import { getMenuItems } from '../../../lib/db/menu-items';

export const prerender = false;

export const GET: APIRoute = async () => {
    return new Response(JSON.stringify({
        items: await getMenuItems(),
    }), {
        headers: {
            "Content-Type": "application/json",
        },
    });
};