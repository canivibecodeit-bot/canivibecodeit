// Build Games admin (token-gated). The launch funding path — Rob adds a
// sponsor + clears its payment by hand — plus moderation. Same admin-gate
// pattern as the sponsor board. Form posts bounce back to /admin/thebuildgames.
import {
  bgBlockHost,
  bgPaymentById,
  bgSponsorById,
  bgUnblockHost,
  insertBgPayment,
  updateBgSponsor,
} from '../../../lib/db.js';
import { json, readBody } from '../../../lib/request.js';
import { isAdmin } from '../../../lib/sponsors.js';
import {
  MAX_BID_CENTS,
  MIN_BID_CENTS,
  PAYMENT_ID_RE,
  SPONSOR_ID_RE,
  cleanTagline,
  newPaymentId,
  registrableHost,
} from '../../../lib/buildgames.js';
import { screenSubmission } from '../../../lib/buildgames-screen.js';
import { clearPayment, reversePayment, submitBid } from '../../../lib/buildgames-payments.js';

export async function POST({ request }) {
  const wantsJson = (request.headers.get('content-type') || '').includes('application/json');

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (!isAdmin(body.token)) return json({ error: 'not found' }, 404);

  const backTo = (message) => {
    const back = String(body.return_to || '');
    const target = /^\/(?![/\\])/.test(back) ? back : '/thebuildgames';
    const sep = target.includes('?') ? '&' : '?';
    return new Response(null, { status: 303, headers: { Location: `${target}${sep}msg=${encodeURIComponent(message)}` } });
  };
  const done = (m) => (wantsJson ? json({ ok: true, message: m }) : backTo(m));
  const fail = (e, s) => (wantsJson ? json({ error: e }, s) : backTo(e));

  // Admin forms post whole dollars; the interface works in cents.
  const centsFromBody = () => {
    if (body.amount_cents != null) return Math.round(Number(body.amount_cents));
    if (body.amount_dollars != null) return Math.round(Number(body.amount_dollars) * 100);
    return NaN;
  };

  const action = String(body.action ?? '');

  // Add a sponsor + a CLEARED payment in one step (manual funding). Screens the
  // link exactly like the public path, then clears immediately.
  if (action === 'add') {
    const amountCents = centsFromBody();
    if (!Number.isInteger(amountCents) || amountCents < MIN_BID_CENTS || amountCents > MAX_BID_CENTS) {
      return fail(`amount $${MIN_BID_CENTS / 100}–$${MAX_BID_CENTS / 100}`, 400);
    }
    const tagline = cleanTagline(body.tagline);
    const screen = await screenSubmission(body.link);
    if (!screen.ok) return fail(screen.reason || 'bad link', 400);
    const res = await submitBid({ screen, tagline, amountCents });
    if (res.error) return fail('that site is blocked', 403);
    await clearPayment(res.paymentId); // admin-entered = cleared now
    // Admin-added sponsors bypass the held gate (Rob vetted them).
    await updateBgSponsor(res.sponsorId, { status: 'active', held_reason: null });
    return done(`added · $${amountCents / 100}`);
  }

  // Top up an existing sponsor with a cleared payment.
  if (action === 'topup') {
    const id = String(body.id ?? '');
    if (!SPONSOR_ID_RE.test(id)) return fail('bad id', 400);
    const sponsor = await bgSponsorById(id);
    if (!sponsor) return fail('unknown sponsor', 404);
    const amountCents = centsFromBody();
    if (!Number.isInteger(amountCents) || amountCents < MIN_BID_CENTS || amountCents > MAX_BID_CENTS) {
      return fail('bad amount', 400);
    }
    const pid = newPaymentId();
    await insertBgPayment({ id: pid, sponsor_id: id, amount_cents: amountCents, status: 'pending', processor_ref: 'admin', created_at: Date.now() });
    await clearPayment(pid);
    return done(`topped up · $${amountCents / 100}`);
  }

  // Payment lifecycle (for a real processor / corrections).
  if (action === 'clear' || action === 'reverse') {
    const pid = String(body.payment_id ?? '');
    if (!PAYMENT_ID_RE.test(pid)) return fail('bad payment id', 400);
    const ok = action === 'clear' ? await clearPayment(pid) : await reversePayment(pid);
    return ok ? done(`${action} · done`) : fail('no change', 400);
  }

  // Sponsor moderation.
  const id = String(body.id ?? '');
  if (!SPONSOR_ID_RE.test(id)) return fail('bad id', 400);
  const sponsor = await bgSponsorById(id);
  if (!sponsor) return fail('unknown sponsor', 404);
  const host = () => registrableHost(new URL(sponsor.link).hostname);

  if (action === 'release') {
    await updateBgSponsor(id, { status: 'active', held_reason: null });
    return done('released');
  }
  if (action === 'remove') {
    // Removed for abuse: placement forfeited, cleared money STAYS in the pool.
    await updateBgSponsor(id, { status: 'removed' });
    try { await bgBlockHost(host(), 'admin remove', Date.now()); } catch { /* unparseable link */ }
    return done('removed · money stays in pool');
  }
  if (action === 'restore') {
    await updateBgSponsor(id, { status: 'active', held_reason: null });
    try { await bgUnblockHost(host()); } catch { /* noop */ }
    return done('restored');
  }
  if (action === 'edit-tagline') {
    const tagline = cleanTagline(body.tagline);
    if (body.tagline && !tagline) return fail('tagline: up to 80 chars, no links', 400);
    await updateBgSponsor(id, { tagline: tagline ?? null });
    return done('tagline updated');
  }

  return fail('unknown action', 400);
}
