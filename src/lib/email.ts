import { Resend } from 'resend';
import type { Order } from '../types/db-types.ts';

// Resolved at runtime (process.env) so these aren't frozen at build time.
const apiKey = process.env.RESEND_API_KEY ?? import.meta.env.RESEND_API_KEY;
const fromEmail = process.env.ORDER_FROM_EMAIL ?? import.meta.env.ORDER_FROM_EMAIL;
const notifyEmail = process.env.ORDER_NOTIFY_EMAIL ?? import.meta.env.ORDER_NOTIFY_EMAIL;

// Absolute base URL so the logo (and any other assets) resolve in email clients.
const siteUrl = (process.env.PUBLIC_SITE_URL ?? import.meta.env.PUBLIC_SITE_URL ?? 'https://kateredkneads.com').replace(/\/$/, '');
const logoUrl = `${siteUrl}/logo.png`;

function formatMoney(cents: number): string {
    return `$${(cents / 100).toFixed(2)}`;
}

function formatPickupTime(iso: string | null): string {
    if (!iso) return '';
    return new Date(iso).toLocaleString('en-US', {
        weekday: 'long', month: 'long', day: 'numeric',
        hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
    });
}

// The pickup window as a single label. With an end time it reads
// "Saturday, March 8, 2:00 – 3:00 PM"; without one it's just the start.
function formatPickupWindow(startIso: string | null, endIso: string | null): string {
    const start = formatPickupTime(startIso);
    if (!start || !endIso) return start;
    const end = new Date(endIso).toLocaleString('en-US', {
        hour: 'numeric', minute: '2-digit', timeZone: 'America/Los_Angeles',
    });
    return `${start} – ${end}`;
}

function renderOrderHtml(order: Order): string {
    const rows = order.items
        .map(
            i => `<tr>
                <td style="padding:6px 0;">${i.quantity}&times; ${i.nameSnapshot}</td>
                <td style="padding:6px 0;text-align:right;">${formatMoney(i.unitPriceCents * i.quantity)}</td>
            </tr>`,
        )
        .join('');

    const pickupTime = formatPickupWindow(order.pickupTime, order.pickupTimeEnd);

    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#2b2b2b;">
        <div style="text-align:center;margin:0 0 20px;">
            <img src="${logoUrl}" alt="Katered Kneads" width="64" height="64" style="display:inline-block;width:64px;height:64px;" />
        </div>
        <h1 style="font-size:22px;margin:0 0 4px;">Order confirmed</h1>
        <p style="margin:0 0 20px;color:#666;">Thanks, ${order.customerName}! Here's your pickup code.</p>

        <div style="background:#f6f2ec;border-radius:12px;padding:20px;text-align:center;margin-bottom:24px;">
            <p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Pickup Code</p>
            <p style="margin:0;font-size:34px;font-weight:700;letter-spacing:.18em;">${order.pickupCode ?? ''}</p>
        </div>

        <p style="margin:0 0 14px;">Bring this code with you${pickupTime ? ` on <strong>${pickupTime}</strong>` : ' on pickup day'}${order.pickupLocation ? ` in <strong>${order.pickupLocation}</strong>` : ''}.</p>

        ${(order.pickupAddress || pickupTime) ? `<div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            ${pickupTime ? `<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Pickup Time</p>
            <p style="margin:0 0 12px;font-size:16px;font-weight:600;">${pickupTime}</p>` : ''}
            ${order.pickupAddress ? `<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Pickup Address</p>
            <p style="margin:0;font-size:16px;font-weight:600;white-space:pre-line;">${order.pickupAddress}</p>` : ''}
        </div>` : ''}

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #e4ddd2;border-bottom:1px solid #e4ddd2;margin-bottom:16px;">
            ${rows}
        </table>

        ${order.tipCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">Subtotal: ${formatMoney(order.subtotalCents)}</p>
        <p style="margin:0 0 4px;text-align:right;color:#666;">Tip: ${formatMoney(order.tipCents)}</p>` : ''}
        <p style="margin:0;text-align:right;font-size:18px;font-weight:700;">Total: ${formatMoney(order.subtotalCents + order.tipCents)}</p>
    </div>`;
}

export async function sendOrderConfirmation(order: Order): Promise<void> {
    if (!apiKey || !fromEmail) {
        console.warn('Resend not configured (RESEND_API_KEY / ORDER_FROM_EMAIL missing); skipping email.');
        return;
    }
    const resend = new Resend(apiKey);
    const to = [order.customerEmail];
    if (notifyEmail) to.push(notifyEmail);

    const { error } = await resend.emails.send({
        from: fromEmail,
        to,
        subject: `Your Katered Kneads pickup code: ${order.pickupCode ?? ''}`,
        html: renderOrderHtml(order),
    });
    if (error) {
        throw new Error(typeof error === 'string' ? error : (error as { message?: string }).message ?? 'Failed to send email');
    }
}
