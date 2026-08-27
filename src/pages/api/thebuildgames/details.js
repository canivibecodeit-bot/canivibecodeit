// Save the tagline for a Build Games placement, post-checkout. Authorisation
// is the details TOKEN alone — an unguessable per-payment secret revealed only
// in the payer's success redirect. No sponsor_id/payment_id is ever accepted
// from the request: the token resolves the payment, the payment resolves the
// sponsor, and the edit is allowed only when that payment CLEARED and WON the
// sponsor's identity claim (earliest cleared screened payment). Same
// sanitisation as every other tagline path: cleanTagline + TAGLINE_MAX.
// Writes go live immediately — no approval step, per Rob.
import { bgFirstClearedScreenedPayment, bgPaymentByDetailsToken, bgSponsorById, rateLimit, updateBgSponsor } from '../../../lib/db.js';
import { buildGamesLive } from '../../../lib/flags.js';
import { clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';
import { TAGLINE_MAX, cleanTagline } from '../../../lib/buildgames.js';

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // matches the details page

export async function POST({ request, clientAddress }) {
  if (!buildGamesLive()) return new Response(null, { status: 404 });
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`bgdetails:${ip}`, 15, 15 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const token = typeof body.t === 'string' ? body.t : '';
  // newToken() values are long; anything short is noise, not a lookup.
  if (token.length < 20 || token.length > 128) return json({ error: 'not found' }, 404);

  const payment = await bgPaymentByDetailsToken(token);
  if (!payment || Date.now() - Number(payment.created_at) > TOKEN_TTL_MS) {
    return json({ error: 'not found' }, 404);
  }
  if (payment.status !== 'cleared') return json({ error: 'payment not cleared yet' }, 409);

  const sponsor = await bgSponsorById(payment.sponsor_id);
  if (!sponsor || sponsor.status !== 'active' || sponsor.first_cleared_at == null) {
    return json({ error: 'this placement cannot be edited right now' }, 409);
  }

  // Only the payment that WON the identity claim may write the public row —
  // a top-up token must never be able to deface the first payer's placement.
  const winner = await bgFirstClearedScreenedPayment(sponsor.id);
  if (!winner || winner.id !== payment.id) {
    return json({ error: 'this payment tops up an existing placement' }, 403);
  }

  const tagline = cleanTagline(body.tagline);
  if (!tagline) {
    return json({ error: `tagline: 2 to ${TAGLINE_MAX} characters, no links` }, 400);
  }

  await updateBgSponsor(sponsor.id, { tagline });
  return json({ ok: true, message: 'saved · live on the board' });
}
