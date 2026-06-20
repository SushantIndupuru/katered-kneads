import { createServerClient } from '../supabase.ts';

export const CURRENT_DROP_KEY = 'current_drop';

export async function getConfig(name: string): Promise<string | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('config')
        .select('value')
        .eq('name', name)
        .maybeSingle();
    if (error) throw error;
    return (data?.value as string | null) ?? null;
}

export async function setConfig(name: string, value: string | null): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase
        .from('config')
        .upsert({ name, value }, { onConflict: 'name' });
    if (error) throw error;
}

export async function getCurrentDropId(): Promise<string | null> {
    return getConfig(CURRENT_DROP_KEY);
}

export async function setCurrentDropId(id: string): Promise<void> {
    return setConfig(CURRENT_DROP_KEY, id);
}
