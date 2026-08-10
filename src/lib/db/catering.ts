import { createServerClient } from '../supabase.ts';
import type {
    CateringRequest,
    CateringRequestItem,
    CateringRequestStatus,
} from '../../types/db-types.ts';

const REQUEST_COLUMNS =
    'id, status, customer_name, customer_email, customer_phone, event_date, notes, subtotal_cents, admin_note, stripe_checkout_session_id, stripe_payment_intent_id, approved_at, paid_at, fulfilled_at, created_at';

interface RequestRow {
    id: string;
    status: string;
    customer_name: string;
    customer_email: string;
    customer_phone: string;
    event_date: string;
    notes: string;
    subtotal_cents: number;
    admin_note: string;
    stripe_checkout_session_id: string | null;
    stripe_payment_intent_id: string | null;
    approved_at: string | null;
    paid_at: string | null;
    fulfilled_at: string | null;
    created_at: string;
}

interface ItemRow {
    request_id: string;
    menu_item_id: string | null;
    name_snapshot: string;
    unit_price_cents: number;
    quantity: number;
}

function mapItem(row: ItemRow): CateringRequestItem {
    return {
        menuItemId: row.menu_item_id,
        nameSnapshot: row.name_snapshot,
        unitPriceCents: row.unit_price_cents,
        quantity: row.quantity,
    };
}

function mapRequest(row: RequestRow, items: ItemRow[]): CateringRequest {
    return {
        id: row.id,
        status: row.status as CateringRequestStatus,
        customerName: row.customer_name,
        customerEmail: row.customer_email,
        customerPhone: row.customer_phone ?? '',
        eventDate: row.event_date ?? '',
        notes: row.notes ?? '',
        subtotalCents: row.subtotal_cents ?? 0,
        adminNote: row.admin_note ?? '',
        stripeCheckoutSessionId: row.stripe_checkout_session_id,
        stripePaymentIntentId: row.stripe_payment_intent_id,
        approvedAt: row.approved_at,
        paidAt: row.paid_at,
        fulfilledAt: row.fulfilled_at ?? null,
        createdAt: row.created_at,
        items: items.map(mapItem),
    };
}

async function loadItemsForRequests(
    supabase: ReturnType<typeof createServerClient>,
    requestIds: string[],
): Promise<Map<string, ItemRow[]>> {
    const byRequest = new Map<string, ItemRow[]>();
    if (requestIds.length === 0) return byRequest;

    const { data, error } = await supabase
        .from('catering_request_items')
        .select('request_id, menu_item_id, name_snapshot, unit_price_cents, quantity')
        .in('request_id', requestIds);
    if (error) throw error;

    for (const row of (data as ItemRow[]) ?? []) {
        const list = byRequest.get(row.request_id) ?? [];
        list.push(row);
        byRequest.set(row.request_id, list);
    }
    return byRequest;
}

export interface CreateCateringLine {
    menuItemId: string | null;
    nameSnapshot: string;
    unitPriceCents: number;
    quantity: number;
}

export async function createCateringRequest(input: {
    customerName: string;
    customerEmail: string;
    customerPhone: string;
    eventDate: string;
    notes: string;
    items: CreateCateringLine[];
}): Promise<CateringRequest> {
    const supabase = createServerClient();
    const subtotalCents = input.items.reduce(
        (sum, i) => sum + i.unitPriceCents * i.quantity,
        0,
    );

    const { data: row, error } = await supabase
        .from('catering_requests')
        .insert({
            status: 'pending',
            customer_name: input.customerName,
            customer_email: input.customerEmail,
            customer_phone: input.customerPhone,
            event_date: input.eventDate,
            notes: input.notes,
            subtotal_cents: subtotalCents,
        })
        .select(REQUEST_COLUMNS)
        .single();
    if (error) throw error;

    const requestId = (row as RequestRow).id;
    const itemRows = input.items.map(i => ({
        request_id: requestId,
        menu_item_id: i.menuItemId,
        name_snapshot: i.nameSnapshot,
        unit_price_cents: i.unitPriceCents,
        quantity: i.quantity,
    }));

    const { data: items, error: itemsError } = await supabase
        .from('catering_request_items')
        .insert(itemRows)
        .select('request_id, menu_item_id, name_snapshot, unit_price_cents, quantity');
    if (itemsError) throw itemsError;

    return mapRequest(row as RequestRow, (items as ItemRow[]) ?? []);
}

export async function getCateringRequests(): Promise<CateringRequest[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('catering_requests')
        .select(REQUEST_COLUMNS)
        .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = (data as RequestRow[]) ?? [];
    const itemsByRequest = await loadItemsForRequests(
        supabase,
        rows.map(r => r.id),
    );
    return rows.map(r => mapRequest(r, itemsByRequest.get(r.id) ?? []));
}

export async function getCateringRequestById(id: string): Promise<CateringRequest | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('catering_requests')
        .select(REQUEST_COLUMNS)
        .eq('id', id)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const itemsByRequest = await loadItemsForRequests(supabase, [id]);
    return mapRequest(data as RequestRow, itemsByRequest.get(id) ?? []);
}

export async function getCateringRequestByCheckoutSession(
    sessionId: string,
): Promise<CateringRequest | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('catering_requests')
        .select(REQUEST_COLUMNS)
        .eq('stripe_checkout_session_id', sessionId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const id = (data as RequestRow).id;
    const itemsByRequest = await loadItemsForRequests(supabase, [id]);
    return mapRequest(data as RequestRow, itemsByRequest.get(id) ?? []);
}

export async function updateCateringRequestItems(
    requestId: string,
    items: CreateCateringLine[],
): Promise<void> {
    const supabase = createServerClient();
    const subtotalCents = items.reduce(
        (sum, i) => sum + i.unitPriceCents * i.quantity,
        0,
    );

    const { error: delError } = await supabase
        .from('catering_request_items')
        .delete()
        .eq('request_id', requestId);
    if (delError) throw delError;

    const itemRows = items.map(i => ({
        request_id: requestId,
        menu_item_id: i.menuItemId,
        name_snapshot: i.nameSnapshot,
        unit_price_cents: i.unitPriceCents,
        quantity: i.quantity,
    }));

    const { error: insertError } = await supabase
        .from('catering_request_items')
        .insert(itemRows);
    if (insertError) throw insertError;

    const { error: updateError } = await supabase
        .from('catering_requests')
        .update({ subtotal_cents: subtotalCents })
        .eq('id', requestId);
    if (updateError) throw updateError;
}

export async function markCateringApproved(input: {
    id: string;
    stripeCheckoutSessionId: string;
    adminNote?: string;
    subtotalCents: number;
}): Promise<CateringRequest> {
    const supabase = createServerClient();
    const patch: Record<string, unknown> = {
        status: 'approved',
        stripe_checkout_session_id: input.stripeCheckoutSessionId,
        approved_at: new Date().toISOString(),
        subtotal_cents: input.subtotalCents,
    };
    if (input.adminNote !== undefined) patch.admin_note = input.adminNote;

    const { data, error } = await supabase
        .from('catering_requests')
        .update(patch)
        .eq('id', input.id)
        .select(REQUEST_COLUMNS)
        .single();
    if (error) throw error;

    const itemsByRequest = await loadItemsForRequests(supabase, [input.id]);
    return mapRequest(data as RequestRow, itemsByRequest.get(input.id) ?? []);
}

export async function markCateringRejected(
    id: string,
    adminNote = '',
): Promise<CateringRequest> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('catering_requests')
        .update({
            status: 'rejected',
            admin_note: adminNote,
        })
        .eq('id', id)
        .select(REQUEST_COLUMNS)
        .single();
    if (error) throw error;

    const itemsByRequest = await loadItemsForRequests(supabase, [id]);
    return mapRequest(data as RequestRow, itemsByRequest.get(id) ?? []);
}

export async function markCateringPaid(input: {
    id: string;
    stripePaymentIntentId: string | null;
}): Promise<CateringRequest | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('catering_requests')
        .update({
            status: 'paid',
            stripe_payment_intent_id: input.stripePaymentIntentId,
            paid_at: new Date().toISOString(),
        })
        .eq('id', input.id)
        .eq('status', 'approved')
        .select(REQUEST_COLUMNS)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const itemsByRequest = await loadItemsForRequests(supabase, [input.id]);
    return mapRequest(data as RequestRow, itemsByRequest.get(input.id) ?? []);
}

export async function markCateringFulfilled(id: string): Promise<CateringRequest | null> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('catering_requests')
        .update({
            status: 'fulfilled',
            fulfilled_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('status', 'paid')
        .select(REQUEST_COLUMNS)
        .maybeSingle();
    if (error) throw error;
    if (!data) return null;

    const itemsByRequest = await loadItemsForRequests(supabase, [id]);
    return mapRequest(data as RequestRow, itemsByRequest.get(id) ?? []);
}

export async function deleteCateringRequest(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase.from('catering_requests').delete().eq('id', id);
    if (error) throw error;
}
