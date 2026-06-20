import { createServerClient } from '../supabase.ts';
import type { Drop, MenuItem, DropItemWithMenu } from '../../types/db-types.ts';
import { getCurrentDropId, setConfig, CURRENT_DROP_KEY } from './config.ts';

const DROP_COLUMNS = 'id, name, open_time, close_time, show_countdown';

interface DropRow {
    id: string;
    name: string;
    open_time: string;
    close_time: string;
    show_countdown: boolean;
}

function mapDrop(row: DropRow): Drop {
    return {
        id: row.id,
        name: row.name,
        openTime: row.open_time,
        closeTime: row.close_time,
        showCountdown: row.show_countdown ?? false,
    };
}

export async function getDrops(): Promise<Drop[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('drops')
        .select(DROP_COLUMNS)
        .order('open_time', { ascending: false });
    if (error) throw error;
    return ((data as DropRow[]) ?? []).map(mapDrop);
}

export interface DropItemInput {
    menuItemId: string;
    initialStock: number;
    preview?: boolean;
    tag?: string;
}

// Validates and normalizes a raw items payload from the admin API.
// Returns the parsed list, or an { error } object describing the first problem.
export function parseDropItems(items: unknown): DropItemInput[] | { error: string } {
    if (items == null) return [];
    if (!Array.isArray(items)) return { error: 'Items must be an array' };

    const result: DropItemInput[] = [];
    const seen = new Set<string>();
    for (const raw of items) {
        const item = raw as { menuItemId?: unknown; initialStock?: unknown; preview?: unknown; tag?: unknown };
        const menuItemId = item?.menuItemId;
        if (!menuItemId || typeof menuItemId !== 'string') {
            return { error: 'Each item needs a menuItemId' };
        }
        if (seen.has(menuItemId)) return { error: 'Duplicate item in drop' };
        seen.add(menuItemId);

        const stock = Number(item.initialStock);
        if (!Number.isInteger(stock) || stock < 0) {
            return { error: 'Initial stock must be a non-negative whole number' };
        }

        result.push({
            menuItemId,
            initialStock: stock,
            preview: Boolean(item.preview),
            tag: typeof item.tag === 'string' ? item.tag.trim() : '',
        });
    }
    return result;
}

export async function createDrop(
    data: Omit<Drop, 'id'>,
    items: DropItemInput[] = [],
): Promise<Drop> {
    const supabase = createServerClient();
    const { data: row, error } = await supabase
        .from('drops')
        .insert({
            name: data.name,
            open_time: data.openTime,
            close_time: data.closeTime,
            show_countdown: data.showCountdown,
        })
        .select(DROP_COLUMNS)
        .single();
    if (error) throw error;
    const drop = mapDrop(row as DropRow);

    if (items.length > 0) {
        const { error: itemsError } = await supabase.from('drop_items').insert(
            items.map(item => ({
                drop_id: drop.id,
                menu_item_id: item.menuItemId,
                initial_stock: item.initialStock,
                consumed_stock: 0,
                preview: item.preview ?? false,
                tag: item.tag ?? '',
            })),
        );
        if (itemsError) {
            // Roll back the drop so we don't leave an item-less orphan on partial failure
            await supabase.from('drops').delete().eq('id', drop.id);
            throw itemsError;
        }
    }

    return drop;
}

export async function getDropItemCounts(): Promise<Record<string, number>> {
    const supabase = createServerClient();
    const { data, error } = await supabase.from('drop_items').select('drop_id');
    if (error) throw error;
    const counts: Record<string, number> = {};
    for (const row of (data as { drop_id: string }[]) ?? []) {
        counts[row.drop_id] = (counts[row.drop_id] ?? 0) + 1;
    }
    return counts;
}

interface DropItemRow {
    menu_item_id: string;
    initial_stock: number;
    consumed_stock: number;
    preview: boolean;
    tag: string;
}

export async function getDropItems(dropId: string): Promise<DropItemWithMenu[]> {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
        .from('drop_items')
        .select('menu_item_id, initial_stock, consumed_stock, preview, tag')
        .eq('drop_id', dropId);
    if (error) throw error;

    const itemRows = (rows as DropItemRow[]) ?? [];
    if (itemRows.length === 0) return [];

    const ids = itemRows.map(r => r.menu_item_id);
    const { data: menuItems, error: miError } = await supabase
        .from('menu_items')
        .select('id, name, description')
        .in('id', ids);
    if (miError) throw miError;

    const map = new Map(
        ((menuItems as MenuItem[]) ?? []).map(m => [m.id, m]),
    );

    return itemRows
        .flatMap(r => {
            const menuItem = map.get(r.menu_item_id);
            if (!menuItem) return [];
            return [{
                menuItem,
                initialStock: r.initial_stock,
                consumedStock: r.consumed_stock,
                preview: r.preview ?? false,
                tag: r.tag ?? '',
            } satisfies DropItemWithMenu];
        })
        .sort((a, b) => a.menuItem.name.localeCompare(b.menuItem.name));
}

// Items for the site's current drop (empty when no current drop is set).
export async function getCurrentDropItems(): Promise<DropItemWithMenu[]> {
    const currentDropId = await getCurrentDropId();
    if (!currentDropId) return [];
    return getDropItems(currentDropId);
}

export async function getCurrentDrop(): Promise<Drop | null> {
    const currentDropId = await getCurrentDropId();
    if (!currentDropId) return null;
    return getDrop(currentDropId);
}

export async function getDrop(id: string): Promise<Drop | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('drops')
        .select(DROP_COLUMNS)
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data ? mapDrop(data as DropRow) : null;
}

export async function updateDrop(
    id: string,
    data: Partial<Omit<Drop, 'id'>>,
): Promise<Drop> {
    const supabase = createServerClient();
    const updates: Record<string, unknown> = {};
    if (data.name !== undefined) updates.name = data.name;
    if (data.openTime !== undefined) updates.open_time = data.openTime;
    if (data.closeTime !== undefined) updates.close_time = data.closeTime;
    if (data.showCountdown !== undefined) updates.show_countdown = data.showCountdown;

    const { data: row, error } = await supabase
        .from('drops')
        .update(updates)
        .eq('id', id)
        .select(DROP_COLUMNS)
        .single();
    if (error) throw error;
    return mapDrop(row as DropRow);
}

// Replaces a drop's items, preserving (and clamping) consumed stock for items that remain.
export async function setDropItems(dropId: string, items: DropItemInput[]): Promise<void> {
    const supabase = createServerClient();

    const { data: existing, error: exError } = await supabase
        .from('drop_items')
        .select('menu_item_id, consumed_stock')
        .eq('drop_id', dropId);
    if (exError) throw exError;

    const consumedMap = new Map(
        ((existing as { menu_item_id: string; consumed_stock: number }[]) ?? [])
            .map(r => [r.menu_item_id, r.consumed_stock]),
    );
    const newIds = new Set(items.map(i => i.menuItemId));

    const toDelete = [...consumedMap.keys()].filter(id => !newIds.has(id));
    if (toDelete.length > 0) {
        const { error } = await supabase
            .from('drop_items')
            .delete()
            .eq('drop_id', dropId)
            .in('menu_item_id', toDelete);
        if (error) throw error;
    }

    if (items.length > 0) {
        const rows = items.map(item => ({
            drop_id: dropId,
            menu_item_id: item.menuItemId,
            initial_stock: item.initialStock,
            consumed_stock: Math.min(consumedMap.get(item.menuItemId) ?? 0, item.initialStock),
            preview: item.preview ?? false,
            tag: item.tag ?? '',
        }));
        const { error } = await supabase
            .from('drop_items')
            .upsert(rows, { onConflict: 'drop_id,menu_item_id' });
        if (error) throw error;
    }
}

export async function deleteDrop(id: string): Promise<void> {
    const supabase = createServerClient();
    const currentDropId = await getCurrentDropId();
    const { error } = await supabase.from('drops').delete().eq('id', id);
    if (error) throw error;
    // If the deleted drop was the active one, clear the current_drop config.
    if (currentDropId === id) {
        await setConfig(CURRENT_DROP_KEY, null);
    }
}

export async function getDropsForMenuItem(menuItemId: string): Promise<Drop[]> {
    const supabase = createServerClient();
    const { data: links, error } = await supabase
        .from('drop_items')
        .select('drop_id')
        .eq('menu_item_id', menuItemId);
    if (error) throw error;

    const ids = [...new Set(((links as { drop_id: string }[]) ?? []).map(l => l.drop_id))];
    if (ids.length === 0) return [];

    const { data, error: dropsError } = await supabase
        .from('drops')
        .select(DROP_COLUMNS)
        .in('id', ids)
        .order('open_time', { ascending: false });
    if (dropsError) throw dropsError;
    return ((data as DropRow[]) ?? []).map(mapDrop);
}
