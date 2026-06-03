import { createServerClient } from '../supabase.ts';
import type { MenuItem, SpecialMenuItem } from '../../types/MenuItem.ts';

export async function listBestSellers(): Promise<{ id: string; tag: string; sort_order: number }[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('best_sellers')
        .select('id, tag, sort_order')
        .order('sort_order');
    if (error) throw error;
    return (data ?? []) as { id: string; tag: string; sort_order: number }[];
}

export async function getBestSellers(): Promise<SpecialMenuItem[]> {
    const supabase = createServerClient();
    const { data: bestSellerRows, error: bestSellerError } = await supabase
        .from('best_sellers')
        .select('id, tag, sort_order')
        .order('sort_order');
    if (bestSellerError) throw bestSellerError;

    const ids = bestSellerRows.map((row) => row.id).filter(Boolean);
    if (ids.length === 0) return [];

    const { data: items, error: itemsError } = await supabase
        .from('menu_items')
        .select('*')
        .in('id', ids);
    if (itemsError) throw itemsError;

    const itemMap = new Map(
        ((items as MenuItem[]) ?? []).map((item) => [item.id, item]),
    );

    return bestSellerRows.flatMap((row) => {
        const menuItem = itemMap.get(row.id);
        return menuItem ? [{ menuItem, tag: row.tag } satisfies SpecialMenuItem] : [];
    });
}

export async function createBestSeller(
    id: string,
    tag = '',
): Promise<{ id: string; tag: string; sort_order: number }> {
    const supabase = createServerClient();

    const { data: maxRow } = await supabase
        .from('best_sellers')
        .select('sort_order')
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();

    const sort_order = (maxRow?.sort_order ?? 0) + 1;

    const { data, error } = await supabase
        .from('best_sellers')
        .insert({ id, tag, sort_order })
        .select()
        .single();
    if (error) throw error;
    return data as { id: string; tag: string; sort_order: number };
}

export async function updateBestSeller(
    id: string,
    tag: string,
): Promise<{ id: string; tag: string }> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('best_sellers')
        .update({ tag })
        .eq('id', id)
        .select()
        .single();
    if (error) throw error;
    return data as { id: string; tag: string };
}


export async function reorderBestSellers(orderedIds: string[]): Promise<void> {
    const supabase = createServerClient();
    const TEMP_OFFSET = 10_000_000;

    // Phase 1 — move to a safe temp range to free up the target slots
    for (const [index, id] of orderedIds.entries()) {
        const { error } = await supabase
            .from('best_sellers')
            .update({ sort_order: TEMP_OFFSET + index + 1 })
            .eq('id', id);
        if (error) throw error;
    }

    // Phase 2 — assign final 1-based sort_order values
    for (const [index, id] of orderedIds.entries()) {
        const { error } = await supabase
            .from('best_sellers')
            .update({ sort_order: index + 1 })
            .eq('id', id);
        if (error) throw error;
    }
}

export async function deleteBestSeller(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.from('best_sellers').delete().eq('id', id);
    if (error) throw error;
}
