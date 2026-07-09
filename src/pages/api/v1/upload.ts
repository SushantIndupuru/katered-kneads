import type {APIRoute} from 'astro';
import sharp from 'sharp';
import {createServerClient} from '../../../lib/supabase';
import {json} from '../../../lib/http';

export const POST: APIRoute = async ({request}) => {
    try {
        const formData = await request.formData();

        const file = formData.get('file');
        const idField = formData.get('id');

        if (!(file instanceof File)) {
            return json({error: 'No file provided'}, 400);
        }

        const id = typeof idField === 'string' && idField ? idField : crypto.randomUUID();

        const inputBuffer = Buffer.from(await file.arrayBuffer());
        const webpBuffer = await sharp(inputBuffer).webp().toBuffer();

        const supabase = createServerClient();

        const {error} = await supabase.storage
            .from('item_images')
            .upload(id, webpBuffer, {
                contentType: 'image/webp', upsert: true,
            });

        if (error) {
            return json({error: error.message}, 500);
        }

        return json({id});
    } catch (error) {
        return json({
            error: error instanceof Error ? error.message : 'Unknown error',
        }, 500,);
    }
};