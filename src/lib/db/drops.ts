import { createServerClient } from '../supabase.ts';
import type { Drop, MenuItem, DropItemWithMenu, InPersonSale } from '../../types/db-types.ts';

const DROP_COLUMNS = 'id, name, open_time, close_time, pickup_time, location_name, location_address, announced_at, archived_at, low_stock_threshold';

interface DropRow {
    id: string;
    name: string;
    open_time: string;
    close_time: string;
    pickup_time: string | null;
    location_name: string | null;
    location_address: string | null;
    announced_at: string | null;
    archived_at: string | null;
    low_stock_threshold: number | null;
}

function mapDrop(row: DropRow): Drop {
    return {
        id: row.id,
        name: row.name,
        openTime: row.open_time,
        closeTime: row.close_time,
        pickupTime: row.pickup_time,
        locationName: row.location_name ?? '',
        locationAddress: row.location_address ?? '',
        announcedAt: row.announced_at,
        archivedAt: row.archived_at,
        lowStockThreshold: row.low_stock_threshold ?? 0,
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

// The single active/focused drop (archived_at IS NULL). If more than one
// somehow exists, the most recently opening one wins.
export async function getActiveDrop(): Promise<Drop | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('drops')
        .select(DROP_COLUMNS)
        .is('archived_at', null)
        .order('open_time', { ascending: false })
        .limit(1)
        .maybeSingle();
    if (error) throw error;
    return data ? mapDrop(data as DropRow) : null;
}

// Archived drops, newest first — the "older drops" history list.
export async function getArchivedDrops(): Promise<Drop[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('drops')
        .select(DROP_COLUMNS)
        .not('archived_at', 'is', null)
        .order('open_time', { ascending: false });
    if (error) throw error;
    return ((data as DropRow[]) ?? []).map(mapDrop);
}

export interface DropItemInput {
    menuItemId: string;
    initialStock: number;
    inPersonStock?: number;
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
        const item = raw as { menuItemId?: unknown; initialStock?: unknown; inPersonStock?: unknown; preview?: unknown; tag?: unknown };
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

        const inPersonStock = item.inPersonStock == null ? 0 : Number(item.inPersonStock);
        if (!Number.isInteger(inPersonStock) || inPersonStock < 0) {
            return { error: 'In-person stock must be a non-negative whole number' };
        }

        result.push({
            menuItemId,
            initialStock: stock,
            inPersonStock,
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
            pickup_time: data.pickupTime ?? null,
            location_name: data.locationName ?? '',
            location_address: data.locationAddress ?? '',
            low_stock_threshold: data.lowStockThreshold ?? 0,
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
                in_person_stock: item.inPersonStock ?? 0,
                in_person_consumed: 0,
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
    in_person_stock: number;
    in_person_consumed: number;
    preview: boolean;
    tag: string;
}

export async function getDropItems(dropId: string): Promise<DropItemWithMenu[]> {
    const supabase = createServerClient();
    const { data: rows, error } = await supabase
        .from('drop_items')
        .select('menu_item_id, initial_stock, consumed_stock, in_person_stock, in_person_consumed, preview, tag')
        .eq('drop_id', dropId);
    if (error) throw error;

    const itemRows = (rows as DropItemRow[]) ?? [];
    if (itemRows.length === 0) return [];

    const ids = itemRows.map(r => r.menu_item_id);
    const { data: menuItems, error: miError } = await supabase
        .from('menu_items')
        .select('id, name, description, price')
        .in('id', ids);
    if (miError) throw miError;

    const map = new Map(
        ((menuItems as { id: string; name: string; description: string; price: number | string | null }[]) ?? [])
            .map(m => [m.id, { id: m.id, name: m.name, description: m.description, price: Number(m.price ?? 0) } satisfies MenuItem]),
    );

    return itemRows
        .flatMap(r => {
            const menuItem = map.get(r.menu_item_id);
            if (!menuItem) return [];
            return [{
                menuItem,
                initialStock: r.initial_stock,
                consumedStock: r.consumed_stock,
                inPersonStock: r.in_person_stock ?? 0,
                inPersonConsumed: r.in_person_consumed ?? 0,
                preview: r.preview ?? false,
                tag: r.tag ?? '',
            } satisfies DropItemWithMenu];
        })
        .sort((a, b) => a.menuItem.name.localeCompare(b.menuItem.name));
}

// The site's public drop: the active drop, but only once it has been announced.
// Drafts (announced_at IS NULL) stay private.
export async function getCurrentDrop(): Promise<Drop | null> {
    const active = await getActiveDrop();
    return active && active.announcedAt ? active : null;
}

// Items for the site's public drop (empty when there is no announced drop).
export async function getCurrentDropItems(): Promise<DropItemWithMenu[]> {
    const drop = await getCurrentDrop();
    if (!drop) return [];
    return getDropItems(drop.id);
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
    if (data.pickupTime !== undefined) updates.pickup_time = data.pickupTime;
    if (data.locationName !== undefined) updates.location_name = data.locationName;
    if (data.locationAddress !== undefined) updates.location_address = data.locationAddress;
    if (data.lowStockThreshold !== undefined) updates.low_stock_threshold = data.lowStockThreshold;
    if (data.announcedAt !== undefined) updates.announced_at = data.announcedAt;
    if (data.archivedAt !== undefined) updates.archived_at = data.archivedAt;

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
        .select('menu_item_id, consumed_stock, in_person_consumed')
        .eq('drop_id', dropId);
    if (exError) throw exError;

    const existingRows = (existing as { menu_item_id: string; consumed_stock: number; in_person_consumed: number }[]) ?? [];
    const consumedMap = new Map(existingRows.map(r => [r.menu_item_id, r.consumed_stock]));
    const inPersonConsumedMap = new Map(existingRows.map(r => [r.menu_item_id, r.in_person_consumed]));
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
        const rows = items.map(item => {
            const inPersonStock = item.inPersonStock ?? 0;
            return {
                drop_id: dropId,
                menu_item_id: item.menuItemId,
                initial_stock: item.initialStock,
                consumed_stock: Math.min(consumedMap.get(item.menuItemId) ?? 0, item.initialStock),
                in_person_stock: inPersonStock,
                in_person_consumed: Math.min(inPersonConsumedMap.get(item.menuItemId) ?? 0, inPersonStock),
                preview: item.preview ?? false,
                tag: item.tag ?? '',
            };
        });
        const { error } = await supabase
            .from('drop_items')
            .upsert(rows, { onConflict: 'drop_id,menu_item_id' });
        if (error) throw error;
    }
}

// Records in-person sales for a single drop item by setting the absolute
// in_person_consumed value, clamped to [0, in_person_stock]. Returns the
// stored value (and the item's in-person stock for convenience).
export async function setInPersonConsumed(
    dropId: string,
    menuItemId: string,
    value: number,
): Promise<{ inPersonConsumed: number; inPersonStock: number }> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('drop_items')
        .select('in_person_stock')
        .eq('drop_id', dropId)
        .eq('menu_item_id', menuItemId)
        .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Drop item not found');

    const inPersonStock = (data as { in_person_stock: number }).in_person_stock ?? 0;
    const clamped = Math.max(0, Math.min(Math.trunc(value), inPersonStock));

    const { error: upError } = await supabase
        .from('drop_items')
        .update({ in_person_consumed: clamped })
        .eq('drop_id', dropId)
        .eq('menu_item_id', menuItemId);
    if (upError) throw upError;

    return { inPersonConsumed: clamped, inPersonStock };
}

// Atomically increments in_person_consumed for each sold line via the SQL RPC.
// Raises (throws) if any line would exceed the in-person allocation.
export async function incrementInPersonConsumed(
    dropId: string,
    items: { menuItemId: string; quantity: number }[],
): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.rpc('increment_in_person_consumed', {
        p_drop_id: dropId,
        items,
    });
    if (error) throw error;
}

export interface InPersonSaleLine {
    menuItemId: string;
    nameSnapshot: string;
    unitPriceCents: number;
    quantity: number;
}

// Records a paid in-person POS sale. The UNIQUE constraint on
// stripe_payment_intent_id makes this idempotent: if the row already exists
// (a concurrent webhook/poll won the race) the insert hits a unique violation
// and we return false so the loser skips the stock increment.
export async function recordInPersonSale(input: {
    dropId: string | null;
    subtotalCents: number;
    tipCents: number;
    stripePaymentIntentId: string;
    items: InPersonSaleLine[];
}): Promise<boolean> {
    const supabase = createServerClient();
    const { error } = await supabase.from('in_person_sales').insert({
        drop_id: input.dropId,
        subtotal_cents: input.subtotalCents,
        tip_cents: input.tipCents,
        stripe_payment_intent_id: input.stripePaymentIntentId,
        items: input.items,
    });
    if (error) {
        // 23505 = unique_violation: this sale was already recorded.
        if ((error as { code?: string }).code === '23505') return false;
        throw error;
    }
    return true;
}

interface InPersonSaleRow {
    id: string;
    drop_id: string | null;
    subtotal_cents: number;
    tip_cents: number;
    stripe_payment_intent_id: string;
    items: unknown;
    created_at: string;
}

const IN_PERSON_SALE_COLUMNS = 'id, drop_id, subtotal_cents, tip_cents, stripe_payment_intent_id, items, created_at';

function mapInPersonSale(row: InPersonSaleRow): InPersonSale {
    const rawItems = Array.isArray(row.items) ? (row.items as Record<string, unknown>[]) : [];
    return {
        id: row.id,
        dropId: row.drop_id,
        subtotalCents: row.subtotal_cents,
        tipCents: row.tip_cents ?? 0,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        createdAt: row.created_at,
        items: rawItems.map(i => ({
            menuItemId: (i.menuItemId as string | null) ?? null,
            nameSnapshot: (i.nameSnapshot as string) ?? '',
            unitPriceCents: Number(i.unitPriceCents ?? 0),
            quantity: Number(i.quantity ?? 0),
        })),
    } satisfies InPersonSale;
}

// Lists recorded in-person POS sales, newest first, for the admin orders view.
export async function getInPersonSales({ limit = 100 }: { limit?: number } = {}): Promise<InPersonSale[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('in_person_sales')
        .select(IN_PERSON_SALE_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) throw error;
    return ((data as InPersonSaleRow[]) ?? []).map(mapInPersonSale);
}

export async function getInPersonSaleById(id: string): Promise<InPersonSale | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('in_person_sales')
        .select(IN_PERSON_SALE_COLUMNS)
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    return data ? mapInPersonSale(data as InPersonSaleRow) : null;
}

// Returns in-person stock to a drop (inverse of incrementInPersonConsumed) when
// a recorded POS sale is deleted. Clamped server-side so in_person_consumed
// can't go negative.
export async function decrementInPersonConsumed(
    dropId: string,
    items: { menuItemId: string; quantity: number }[],
): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.rpc('decrement_in_person_consumed', {
        p_drop_id: dropId,
        items,
    });
    if (error) throw error;
}

// Deletes a recorded in-person sale and returns its quantities to the drop's
// in-person pool. Mirrors deleteOrder: the stock is reverted first (and throws
// on failure) so a sale is never deleted with its stock silently unaccounted
// for. This does NOT refund the customer — the Stripe refund is a separate,
// manual step. Returns false if the sale didn't exist.
export async function deleteInPersonSale(id: string): Promise<boolean> {
    const supabase = createServerClient();
    const sale = await getInPersonSaleById(id);
    if (!sale) return false;

    if (sale.dropId) {
        const lines = sale.items
            .filter(i => i.menuItemId)
            .map(i => ({ menuItemId: i.menuItemId as string, quantity: i.quantity }));
        if (lines.length > 0) {
            await decrementInPersonConsumed(sale.dropId, lines);
        }
    }

    const { error } = await supabase.from('in_person_sales').delete().eq('id', id);
    if (error) throw error;
    return true;
}

export async function deleteDrop(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.from('drops').delete().eq('id', id);
    if (error) throw error;
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
