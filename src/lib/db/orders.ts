import { createServerClient } from '../supabase.ts';
import type { Order, OrderItem, OrderStatus } from '../../types/db-types.ts';

const ORDER_COLUMNS =
    'id, drop_id, status, customer_name, customer_email, customer_phone, pickup_time, pickup_location, pickup_address, subtotal_cents, tip_cents, pickup_code, stripe_checkout_session_id, stripe_payment_intent_id, created_at';

interface OrderRow {
    id: string;
    drop_id: string | null;
    status: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    pickup_time: string | null;
    pickup_location: string;
    pickup_address: string;
    subtotal_cents: number;
    tip_cents: number;
    pickup_code: string | null;
    stripe_checkout_session_id: string | null;
    stripe_payment_intent_id: string | null;
    created_at: string;
}

interface OrderItemRow {
    order_id: string;
    menu_item_id: string | null;
    name_snapshot: string;
    unit_price_cents: number;
    quantity: number;
}

function mapItem(row: OrderItemRow): OrderItem {
    return {
        menuItemId: row.menu_item_id,
        nameSnapshot: row.name_snapshot,
        unitPriceCents: row.unit_price_cents,
        quantity: row.quantity,
    };
}

function mapOrder(row: OrderRow, items: OrderItemRow[]): Order {
    return {
        id: row.id,
        dropId: row.drop_id,
        status: row.status as OrderStatus,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone,
        pickupTime: row.pickup_time,
        pickupLocation: row.pickup_location ?? '',
        pickupAddress: row.pickup_address ?? '',
        subtotalCents: row.subtotal_cents,
        tipCents: row.tip_cents ?? 0,
        pickupCode: row.pickup_code,
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        createdAt: row.created_at,
        items: items.map(mapItem),
    };
}

// Unambiguous alphabet (no 0/O/1/I) for human-friendly pickup codes.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generatePickupCode(length = 6): string {
    let code = '';
    for (let i = 0; i < length; i++) {
        code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    return code;
}

export interface CreateOrderLine {
    menuItemId: string;
    nameSnapshot: string;
    unitPriceCents: number;
    quantity: number;
}

export interface CreateOrderInput {
    dropId: string | null;
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    pickupTime: string | null;
    pickupLocation: string;
    pickupAddress: string;
    subtotalCents: number;
    tipCents: number;
    stripeCheckoutSessionId: string;
    stripePaymentIntentId: string | null;
    items: CreateOrderLine[];
}

// Creates a fully-paid order in a single step (orders are only persisted once
// Stripe confirms payment — there is no pending state). The UNIQUE constraint
// on stripe_checkout_session_id makes this idempotent: if a concurrent caller
// (webhook vs. success page) already created the order, the insert hits a
// unique violation and we return null so the loser skips stock/email.
export async function createPaidOrder(input: CreateOrderInput): Promise<Order | null> {
    const supabase = createServerClient();

    const { data: orderRow, error } = await supabase
        .from('orders')
        .insert({
            drop_id: input.dropId,
            status: 'paid',
            customer_name: input.customerName,
            customer_email: input.customerEmail,
            customer_phone: input.customerPhone,
            pickup_time: input.pickupTime,
            pickup_location: input.pickupLocation,
            pickup_address: input.pickupAddress,
            subtotal_cents: input.subtotalCents,
            tip_cents: input.tipCents,
            pickup_code: generatePickupCode(),
            stripe_checkout_session_id: input.stripeCheckoutSessionId,
            stripe_payment_intent_id: input.stripePaymentIntentId,
        })
        .select(ORDER_COLUMNS)
        .single();
    if (error) {
        // 23505 = unique_violation: another caller already created this order.
        if ((error as { code?: string }).code === '23505') return null;
        throw error;
    }

    const order = orderRow as OrderRow;

    const itemRows = input.items.map(i => ({
        order_id: order.id,
        menu_item_id: i.menuItemId,
        name_snapshot: i.nameSnapshot,
        unit_price_cents: i.unitPriceCents,
        quantity: i.quantity,
    }));

    const { error: itemsError } = await supabase.from('order_items').insert(itemRows);
    if (itemsError) {
        await supabase.from('orders').delete().eq('id', order.id);
        throw itemsError;
    }

    return mapOrder(order, itemRows as OrderItemRow[]);
}

async function getItemsForOrders(orderIds: string[]): Promise<Map<string, OrderItemRow[]>> {
    const map = new Map<string, OrderItemRow[]>();
    if (orderIds.length === 0) return map;
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('order_items')
        .select('order_id, menu_item_id, name_snapshot, unit_price_cents, quantity')
        .in('order_id', orderIds);
    if (error) throw error;
    for (const row of (data as OrderItemRow[]) ?? []) {
        const list = map.get(row.order_id) ?? [];
        list.push(row);
        map.set(row.order_id, list);
    }
    return map;
}

export async function getOrderByCheckoutSession(sessionId: string): Promise<Order | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('stripe_checkout_session_id', sessionId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as OrderRow;
    const items = (await getItemsForOrders([row.id])).get(row.id) ?? [];
    return mapOrder(row, items);
}

// Looks up an order by its human-friendly pickup code (case-insensitive). Used
// by the POS to find a customer's order from the code they present at pickup.
export async function getOrderByPickupCode(code: string): Promise<Order | null> {
    const supabase = createServerClient();
    const normalized = code.trim().toUpperCase();
    if (!normalized) return null;
    const { data, error } = await supabase
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('pickup_code', normalized)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as OrderRow;
    const items = (await getItemsForOrders([row.id])).get(row.id) ?? [];
    return mapOrder(row, items);
}

// Sets an order's fulfillment status (e.g. 'paid' -> 'fulfilled' once handed to
// the customer at the counter). Returns the updated order, or null if missing.
export async function updateOrderStatus(id: string, status: OrderStatus): Promise<Order | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('orders')
        .update({ status })
        .eq('id', id)
        .select(ORDER_COLUMNS)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as OrderRow;
    const items = (await getItemsForOrders([row.id])).get(row.id) ?? [];
    return mapOrder(row, items);
}

export async function getOrderById(id: string): Promise<Order | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('orders')
        .select(ORDER_COLUMNS)
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    const row = data as OrderRow;
    const items = (await getItemsForOrders([row.id])).get(row.id) ?? [];
    return mapOrder(row, items);
}

// Deletes an order and returns its stock to the drop. order_items rows cascade
// on delete; the stock is reverted first (best-effort, like the decrement path)
// so a paid order's quantities go back into the drop. Returns false if the
// order didn't exist.
export async function deleteOrder(id: string): Promise<boolean> {
    const supabase = createServerClient();
    const order = await getOrderById(id);
    if (!order) return false;

    // Revert stock BEFORE deleting; if it fails we throw so the order is left
    // intact rather than deleted with its stock silently unaccounted for. (Lines
    // whose drop or menu item no longer exist simply have nothing to credit.)
    if (order.dropId) {
        const lines = order.items
            .filter(i => i.menuItemId)
            .map(i => ({ menuItemId: i.menuItemId as string, quantity: i.quantity }));
        if (lines.length > 0) {
            await restockDropItems(order.dropId, lines);
        }
    }

    const { error } = await supabase.from('orders').delete().eq('id', id);
    if (error) throw error;
    return true;
}

export async function getOrders(
    { statuses, limit = 100 }: { statuses?: OrderStatus[]; limit?: number } = {},
): Promise<Order[]> {
    const supabase = createServerClient();
    let query = supabase
        .from('orders')
        .select(ORDER_COLUMNS)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (statuses && statuses.length > 0) {
        query = query.in('status', statuses);
    }
    const { data, error } = await query;
    if (error) throw error;
    const rows = (data as OrderRow[]) ?? [];
    const itemsMap = await getItemsForOrders(rows.map(r => r.id));
    return rows.map(r => mapOrder(r, itemsMap.get(r.id) ?? []));
}

// Atomic stock decrement for a confirmed order via the SQL RPC.
export async function decrementDropStock(
    dropId: string,
    items: { menuItemId: string; quantity: number }[],
): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.rpc('decrement_drop_stock', {
        p_drop_id: dropId,
        items,
    });
    if (error) throw error;
}

// Returns stock to a drop (inverse of decrementDropStock) when an order is
// deleted. Clamped server-side so consumed_stock can't go negative.
export async function restockDropItems(
    dropId: string,
    items: { menuItemId: string; quantity: number }[],
): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.rpc('restock_drop_items', {
        p_drop_id: dropId,
        items,
    });
    if (error) throw error;
}
