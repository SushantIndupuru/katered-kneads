import { createServerClient } from '../supabase.ts';
import type { SmsSubscriber } from '../../types/db-types.ts';

const SMS_COLUMNS = 'id, phone, consent, source, unsubscribed_at, created_at';

interface SmsSubscriberRow {
    id: string;
    phone: string;
    consent: boolean;
    source: string | null;
    unsubscribed_at: string | null;
    created_at: string;
}

function mapSubscriber(row: SmsSubscriberRow): SmsSubscriber {
    return {
        id: row.id,
        phone: row.phone,
        consent: row.consent,
        source: row.source ?? '',
        unsubscribedAt: row.unsubscribed_at,
        createdAt: row.created_at,
    };
}

// Opts a phone number in to SMS drop updates. Idempotent on the unique phone:
// a repeat signup re-activates a previously unsubscribed number (clears the
// opt-out) rather than erroring or duplicating. `phone` must already be in
// E.164 form. Returns the stored subscriber.
export async function subscribeSms(phone: string, source = ''): Promise<SmsSubscriber> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('sms_subscribers')
        .upsert(
            { phone, consent: true, source, unsubscribed_at: null },
            { onConflict: 'phone' },
        )
        .select(SMS_COLUMNS)
        .single();
    if (error) throw error;
    return mapSubscriber(data as SmsSubscriberRow);
}

// Marks a number as opted out. Kept as a suppression record so a future STOP
// handler / sender never texts them again. No-op if the number isn't found.
export async function unsubscribeSms(phone: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase
        .from('sms_subscribers')
        .update({ unsubscribed_at: new Date().toISOString() })
        .eq('phone', phone);
    if (error) throw error;
}

// All actively subscribed numbers — the audience a future sender would text.
export async function getActiveSmsSubscribers(): Promise<SmsSubscriber[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('sms_subscribers')
        .select(SMS_COLUMNS)
        .is('unsubscribed_at', null)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data as SmsSubscriberRow[]) ?? []).map(mapSubscriber);
}

// Every subscriber, active and opted-out alike — for the admin management view.
export async function getAllSmsSubscribers(): Promise<SmsSubscriber[]> {
    const supabase = createServerClient();
    const { data, error } = await supabase
        .from('sms_subscribers')
        .select(SMS_COLUMNS)
        .order('created_at', { ascending: false });
    if (error) throw error;
    return ((data as SmsSubscriberRow[]) ?? []).map(mapSubscriber);
}

// Permanently removes a subscriber row. Used by the admin to scrub a number
// entirely (as opposed to unsubscribeSms, which keeps a suppression record).
export async function deleteSmsSubscriber(id: string): Promise<void> {
    const supabase = createServerClient();
    const { error } = await supabase
        .from('sms_subscribers')
        .delete()
        .eq('id', id);
    if (error) throw error;
}
