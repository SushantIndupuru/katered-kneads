import { createServerClient } from '../supabase.ts';
import type { MenuItem } from '../../types/db-types.ts';

export async function getMenuItems(): Promise<MenuItem[]> {
    const supabase = createServerClient();
    const { data: items, error } = await supabase.from('menu_items').select();
    if (error) throw error;
    return ((items as MenuItem[]) ?? []).sort((a, b) => {
        if (a.mystery !== b.mystery) return a.mystery ? -1 : 1;
        return a.name.localeCompare(b.name);
    });
}

export async function createMenuItem(
    data: Omit<MenuItem, 'id'>
): Promise<MenuItem> {
    const supabase = createServerClient();
    const { data: item, error } = await supabase
        .from('menu_items')
        .insert({
            ...(data.id ? { id: data.id } : {}),
            name: data.name,
            description: data.description,
            mystery: data.mystery ?? false,
        })
        .select()
        .single();
    if (error) throw error;
    return item as MenuItem;
}

export async function updateMenuItem(
    id: string,
    updates: Partial<Omit<MenuItem, 'id'>>,
): Promise<MenuItem> {
    const supabase = createServerClient();
    const { data: item, error } = await supabase
        .from('menu_items')
        .update(updates)
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return item as MenuItem;
}

export async function deleteMenuItem(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.from('menu_items').delete().eq('id', id);
    if (error) throw error;
}

