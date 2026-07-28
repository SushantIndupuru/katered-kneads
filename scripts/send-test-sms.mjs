// One-off script to verify Twilio SMS sending works end to end.
//
// Usage (Node loads .env.local for you):
//   node --env-file=.env.local scripts/send-test-sms.mjs +15305551234
//   node --env-file=.env.local scripts/send-test-sms.mjs +15305551234 "custom message"
//
// The destination number must be E.164 (+1XXXXXXXXXX). While your Twilio
// account is in trial mode, it must also be a *verified* number in the console.

import twilio from 'twilio';

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

const to = process.argv[2];
const body = process.argv[3] ?? 'Katered Kneads test message. Reply STOP to opt out.';

function fail(msg) {
    console.error(`\n  ✗ ${msg}\n`);
    process.exit(1);
}

if (!accountSid || !authToken || !messagingServiceSid) {
    fail('Missing Twilio env vars. Run with: node --env-file=.env.local scripts/send-test-sms.mjs +1XXXXXXXXXX');
}
if (!to || !/^\+1\d{10}$/.test(to)) {
    fail('Pass a destination number in E.164 form, e.g. +15305551234');
}

const client = twilio(accountSid, authToken);

console.log(`\n  → Sending to ${to} via Messaging Service ${messagingServiceSid}...`);

try {
    const message = await client.messages.create({ to, body, messagingServiceSid });
    console.log(`  ✓ Queued. SID: ${message.sid}  status: ${message.status}\n`);
} catch (err) {
    fail(`Twilio error [${err.code ?? '?'}]: ${err.message}`);
}
