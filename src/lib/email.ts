import { Resend } from 'resend';
import type { CateringRequest, Order } from '../types/db-types.ts';

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

        ${order.tipCents > 0 || order.discountCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">Subtotal: ${formatMoney(order.subtotalCents)}</p>
        ${order.discountCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">${order.couponCode ? `Discount (${order.couponCode})` : 'Discount'}: −${formatMoney(order.discountCents)}</p>` : ''}
        ${order.tipCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">Tip: ${formatMoney(order.tipCents)}</p>` : ''}` : ''}
        <p style="margin:0;text-align:right;font-size:18px;font-weight:700;">Total: ${formatMoney(order.subtotalCents - order.discountCents + order.tipCents)}</p>
    </div>`;
}

function renderMerchantOrderHtml(order: Order): string {
    const rows = order.items
        .map(
            i => `<tr>
                <td style="padding:6px 0;">${i.quantity}&times; ${i.nameSnapshot}</td>
                <td style="padding:6px 0;text-align:right;">${formatMoney(i.unitPriceCents * i.quantity)}</td>
            </tr>`,
        )
        .join('');

    const pickupTime = formatPickupWindow(order.pickupTime, order.pickupTimeEnd);
    const total = formatMoney(order.subtotalCents - order.discountCents + order.tipCents);

    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#2b2b2b;">
        <h1 style="font-size:22px;margin:0 0 4px;">New online order</h1>
        <p style="margin:0 0 20px;color:#666;">Pickup code <strong>${order.pickupCode ?? ''}</strong> · ${total}</p>

        <div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Customer</p>
            <p style="margin:0 0 8px;font-size:16px;font-weight:600;">${order.customerName}</p>
            <p style="margin:0 0 4px;">${order.customerEmail}</p>
            ${order.customerPhone ? `<p style="margin:0;">${order.customerPhone}</p>` : ''}
        </div>

        ${(order.pickupAddress || pickupTime) ? `<div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            ${pickupTime ? `<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Pickup Time</p>
            <p style="margin:0 0 12px;font-size:16px;font-weight:600;">${pickupTime}</p>` : ''}
            ${order.pickupLocation ? `<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Pickup Spot</p>
            <p style="margin:0 0 12px;font-size:16px;font-weight:600;">${order.pickupLocation}</p>` : ''}
            ${order.pickupAddress ? `<p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Pickup Address</p>
            <p style="margin:0;font-size:16px;font-weight:600;white-space:pre-line;">${order.pickupAddress}</p>` : ''}
        </div>` : ''}

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #e4ddd2;border-bottom:1px solid #e4ddd2;margin-bottom:16px;">
            ${rows}
        </table>

        ${order.tipCents > 0 || order.discountCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">Subtotal: ${formatMoney(order.subtotalCents)}</p>
        ${order.discountCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">${order.couponCode ? `Discount (${order.couponCode})` : 'Discount'}: −${formatMoney(order.discountCents)}</p>` : ''}
        ${order.tipCents > 0 ? `<p style="margin:0 0 4px;text-align:right;color:#666;">Tip: ${formatMoney(order.tipCents)}</p>` : ''}` : ''}
        <p style="margin:0;text-align:right;font-size:18px;font-weight:700;">Total: ${total}</p>
    </div>`;
}

export async function sendOrderConfirmation(order: Order): Promise<void> {
    if (!apiKey || !fromEmail) {
        console.warn('Resend not configured (RESEND_API_KEY / ORDER_FROM_EMAIL missing); skipping email.');
        return;
    }
    const resend = new Resend(apiKey);

    const { error: customerError } = await resend.emails.send({
        from: fromEmail,
        to: [order.customerEmail],
        subject: `Your Katered Kneads pickup code: ${order.pickupCode ?? ''}`,
        html: renderOrderHtml(order),
    });
    if (customerError) {
        throw new Error(
            typeof customerError === 'string'
                ? customerError
                : (customerError as { message?: string }).message ?? 'Failed to send customer email',
        );
    }

    if (!notifyEmail) return;

    const { error: merchantError } = await resend.emails.send({
        from: fromEmail,
        to: [notifyEmail],
        subject: `New online order — ${order.pickupCode ?? 'pickup'} · ${order.customerName}`,
        html: renderMerchantOrderHtml(order),
    });
    if (merchantError) {
        throw new Error(
            typeof merchantError === 'string'
                ? merchantError
                : (merchantError as { message?: string }).message ?? 'Failed to send merchant email',
        );
    }
}

function cateringItemRows(request: CateringRequest, withLinePrices = false): string {
    return request.items
        .map(i => {
            const line = withLinePrices && i.unitPriceCents > 0
                ? `<td style="padding:6px 0;text-align:right;">${formatMoney(i.unitPriceCents * i.quantity)}</td>`
                : '';
            return `<tr>
                <td style="padding:6px 0;">${i.quantity}&times; ${i.nameSnapshot}</td>
                ${line}
            </tr>`;
        })
        .join('');
}

function renderCateringMerchantHtml(request: CateringRequest): string {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#2b2b2b;">
        <h1 style="font-size:22px;margin:0 0 4px;">New catering quote request</h1>
        <p style="margin:0 0 20px;color:#666;">Reach out to agree on pricing, then approve from admin to email a payment link.</p>

        <div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Customer</p>
            <p style="margin:0 0 8px;font-size:16px;font-weight:600;">${request.customerName}</p>
            <p style="margin:0 0 4px;">${request.customerEmail}</p>
            ${request.customerPhone ? `<p style="margin:0;">${request.customerPhone}</p>` : ''}
        </div>

        ${request.eventDate ? `<div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Event date</p>
            <p style="margin:0;font-size:16px;font-weight:600;">${request.eventDate}</p>
        </div>` : ''}

        ${request.notes ? `<p style="margin:0 0 16px;white-space:pre-line;">${request.notes}</p>` : ''}

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #e4ddd2;border-bottom:1px solid #e4ddd2;margin-bottom:16px;">
            ${cateringItemRows(request)}
        </table>
    </div>`;
}

function renderCateringPaymentHtml(request: CateringRequest, paymentUrl: string): string {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#2b2b2b;">
        <div style="text-align:center;margin:0 0 20px;">
            <img src="${logoUrl}" alt="Katered Kneads" width="64" height="64" style="display:inline-block;width:64px;height:64px;" />
        </div>
        <h1 style="font-size:22px;margin:0 0 4px;">Your catering payment is ready</h1>
        <p style="margin:0 0 20px;color:#666;">Hi ${request.customerName} — thanks for confirming. Pay securely below to lock in your order.</p>

        ${request.eventDate ? `<div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Event date</p>
            <p style="margin:0;font-size:16px;font-weight:600;">${request.eventDate}</p>
        </div>` : ''}

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #e4ddd2;border-bottom:1px solid #e4ddd2;margin-bottom:16px;">
            ${cateringItemRows(request)}
        </table>
        <p style="margin:0 0 24px;text-align:right;font-size:18px;font-weight:700;">Total due: ${formatMoney(request.subtotalCents)}</p>

        ${request.adminNote ? `<p style="margin:0 0 20px;color:#666;white-space:pre-line;">${request.adminNote}</p>` : ''}

        <div style="text-align:center;margin:24px 0;">
            <a href="${paymentUrl}" style="display:inline-block;background:#2b2b2b;color:#fff;text-decoration:none;padding:14px 28px;border-radius:999px;font-weight:600;">Pay on our website →</a>
        </div>
        <p style="margin:0;font-size:13px;color:#888;text-align:center;">Or open this link: <a href="${paymentUrl}" style="color:#666;">${paymentUrl}</a></p>
    </div>`;
}

function renderCateringPaidHtml(request: CateringRequest): string {
    return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;color:#2b2b2b;">
        <div style="text-align:center;margin:0 0 20px;">
            <img src="${logoUrl}" alt="Katered Kneads" width="64" height="64" style="display:inline-block;width:64px;height:64px;" />
        </div>
        <h1 style="font-size:22px;margin:0 0 4px;">Catering payment received</h1>
        <p style="margin:0 0 20px;color:#666;">Thanks, ${request.customerName}! Your catering order is confirmed.</p>

        ${request.eventDate ? `<div style="background:#f6f2ec;border-radius:12px;padding:16px;margin-bottom:20px;">
            <p style="margin:0 0 4px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#8a7a66;">Event date</p>
            <p style="margin:0;font-size:16px;font-weight:600;">${request.eventDate}</p>
        </div>` : ''}

        <table style="width:100%;border-collapse:collapse;border-top:1px solid #e4ddd2;border-bottom:1px solid #e4ddd2;margin-bottom:16px;">
            ${cateringItemRows(request)}
        </table>
        <p style="margin:0;text-align:right;font-size:18px;font-weight:700;">Paid: ${formatMoney(request.subtotalCents)}</p>
        <p style="margin:20px 0 0;color:#666;">We'll be in touch about pickup or delivery details.</p>
    </div>`;
}

export async function sendCateringRequestNotify(request: CateringRequest): Promise<void> {
    if (!apiKey || !fromEmail || !notifyEmail) {
        console.warn('Resend not configured; skipping catering notify email.');
        return;
    }
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
        from: fromEmail,
        to: [notifyEmail],
        subject: `New catering quote — ${request.customerName}`,
        html: renderCateringMerchantHtml(request),
    });
    if (error) {
        throw new Error(
            typeof error === 'string'
                ? error
                : (error as { message?: string }).message ?? 'Failed to send catering notify email',
        );
    }
}

export async function sendCateringPaymentLink(
    request: CateringRequest,
    paymentUrl: string,
): Promise<void> {
    if (!apiKey || !fromEmail) {
        console.warn('Resend not configured; skipping catering payment email.');
        return;
    }
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
        from: fromEmail,
        to: [request.customerEmail],
        subject: `Your Katered Kneads catering quote — ${formatMoney(request.subtotalCents)}`,
        html: renderCateringPaymentHtml(request, paymentUrl),
    });
    if (error) {
        throw new Error(
            typeof error === 'string'
                ? error
                : (error as { message?: string }).message ?? 'Failed to send catering payment email',
        );
    }
}

export async function sendCateringPaidConfirmation(request: CateringRequest): Promise<void> {
    if (!apiKey || !fromEmail) {
        console.warn('Resend not configured; skipping catering paid email.');
        return;
    }
    const resend = new Resend(apiKey);

    const { error: customerError } = await resend.emails.send({
        from: fromEmail,
        to: [request.customerEmail],
        subject: 'Catering payment confirmed — Katered Kneads',
        html: renderCateringPaidHtml(request),
    });
    if (customerError) {
        throw new Error(
            typeof customerError === 'string'
                ? customerError
                : (customerError as { message?: string }).message ?? 'Failed to send catering paid email',
        );
    }

    if (!notifyEmail) return;

    const { error: merchantError } = await resend.emails.send({
        from: fromEmail,
        to: [notifyEmail],
        subject: `Catering paid — ${request.customerName} · ${formatMoney(request.subtotalCents)}`,
        html: renderCateringMerchantHtml(request),
    });
    if (merchantError) {
        throw new Error(
            typeof merchantError === 'string'
                ? merchantError
                : (merchantError as { message?: string }).message ?? 'Failed to send catering paid notify',
        );
    }
}
