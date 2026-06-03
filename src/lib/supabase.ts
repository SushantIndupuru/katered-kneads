import { createClient } from "@supabase/supabase-js";

const supabaseUrl = import.meta.env.PUBLIC_SUPABASE_URL
const supabasePublishableKey = import.meta.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY
const supabaseSecretKey = import.meta.env.SUPABASE_SECRET_KEY;

export function createServerClient() {
    return createClient(
        supabaseUrl,
        supabaseSecretKey
    );
}

/** Use the anon/publishable key — required for signInWithPassword */
export function createAnonClient() {
    return createClient(
        supabaseUrl,
        supabasePublishableKey
    );
}
