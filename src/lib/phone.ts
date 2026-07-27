// Phone helpers. The storefront serves US campuses (UC Berkeley / UC Davis), so
// numbers are normalized to US E.164 (+1XXXXXXXXXX) for clean SMS delivery.

// Returns the E.164 form of a US phone number, or null if it isn't a valid
// 10-digit US number. Accepts common input shapes: "(530) 555-1234",
// "530-555-1234", "5305551234", "+1 530 555 1234", "1-530-555-1234".
export function normalizeUsPhone(raw: string): string | null {
    const digits = (raw ?? '').replace(/\D/g, '');
    let ten = digits;
    // Drop a leading country code "1" if present (11 digits total).
    if (ten.length === 11 && ten.startsWith('1')) ten = ten.slice(1);
    if (ten.length !== 10) return null;
    // NANP rule: area code and exchange code can't start with 0 or 1.
    if (ten[0] === '0' || ten[0] === '1') return null;
    if (ten[3] === '0' || ten[3] === '1') return null;
    return `+1${ten}`;
}

// Formats an E.164 US number for display, e.g. "+15305551234" -> "(530) 555-1234".
export function formatUsPhone(e164: string): string {
    const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e164 ?? '');
    return m ? `(${m[1]}) ${m[2]}-${m[3]}` : e164;
}
