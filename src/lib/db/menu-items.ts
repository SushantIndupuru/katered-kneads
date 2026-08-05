import { createServerClient } from '../supabase.ts';
import type { MenuItem } from '../../types/db-types.ts';

const MENU_COLUMNS = 'id, name, description, price, sale_price';

interface MenuItemRow {
    id: string;
    name: string;
    description: string;
    price: number | string | null;
    sale_price: number | string | null;
}

function parseSalePrice(raw: number | string | null | undefined): number | null {
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
}

export function mapMenuItem(row: MenuItemRow): MenuItem {
    return {
        id: row.id,
        name: row.name,
        description: row.description,
        price: Number(row.price ?? 0),
        salePrice: parseSalePrice(row.sale_price),
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
        sale_price: data.salePrice == null || !Number.isFinite(data.salePrice) ? null : data.salePrice,
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
    if (updates.salePrice !== undefined) {
        patch.sale_price = updates.salePrice == null || !Number.isFinite(updates.salePrice)
            ? null
            : updates.salePrice;
    }

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

    // The item's image is stored in the `item_images` bucket keyed by the item id.
    const { error: storageError } = await supabase.storage
        .from('item_images')
        .remove([id]);
    if (storageError) {
        // Don't fail the delete if image cleanup fails; the row is already gone.
        console.error(`Failed to delete image for menu item ${id}:`, storageError.message);
    }
}
