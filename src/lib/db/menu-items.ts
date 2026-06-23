import { createServerClient } from '../supabase.ts';
import type { MenuItem } from '../../types/db-types.ts';

const MENU_COLUMNS = 'id, name, description, price';

interface MenuItemRow {
    id: string;
    name: string;
    description: string;
    price: number | string | null;
}

export function mapMenuItem(row: MenuItemRow): MenuItem {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        price: Number(row.price ?? 0),
    };
}

export async function getMenuItems(): Promise<MenuItem[]> {
    const supabase = createServerClient();
    const { data: items, error } = await supabase.from('menu_items').select(MENU_COLUMNS);
    if (error) throw error;
    return ((items as MenuItemRow[]) ?? [])
        .map(mapMenuItem)
        .sort((a, b) => a.name.localeCompare(b.name));
}

export async function createMenuItem(
    data: Omit<MenuItem, 'id'> & { id?: string }
): Promise<MenuItem> {
    const supabase = createServerClient();
    const row: Record<string, unknown> = {
        name: data.name,
        description: data.description,
        price: Number.isFinite(data.price) ? data.price : 0,
    };
    // Use the provided id (matches the uploaded image's storage key) when present.
    if (data.id) row.id = data.id;

    const { data: item, error } = await supabase
        .from('menu_items')
        .insert(row)
        .select(MENU_COLUMNS)
        .single();
    if (error) throw error;
    return mapMenuItem(item as MenuItemRow);
}

export async function updateMenuItem(
    id: string,
    updates: Partial<Omit<MenuItem, 'id'>>,
): Promise<MenuItem> {
    const supabase = createServerClient();
    const patch: Record<string, unknown> = {};
    if (updates.name !== undefined) patch.name = updates.name;
    if (updates.description !== undefined) patch.description = updates.description;
    if (updates.price !== undefined) patch.price = Number(updates.price) || 0;

    const { data: item, error } = await supabase
        .from('menu_items')
        .update(patch)
        .eq('id', id)
        .select(MENU_COLUMNS)
        .single();
    if (error) throw error;
    return mapMenuItem(item as MenuItemRow);
}

export async function deleteMenuItem(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.from('menu_items').delete().eq('id', id);
    if (error) throw error;
}
