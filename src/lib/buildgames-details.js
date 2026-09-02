/* Who may edit a Build Games placement. Authorisation is the details TOKEN
   alone (an unguessable per-payment secret revealed only in the payer's
   success redirect); no sponsor_id/payment_id is ever accepted from a
   request. The token resolves the payment, the payment resolves the sponsor,
   and editing is allowed only when THAT payment cleared and WON the
   sponsor's identity claim, so a top-up token can never deface the first
   payer's row. Shared by the details save and the icon upload. */
import { bgFirstClearedScreenedPayment, bgPaymentByDetailsToken, bgSponsorById } from './db.js';

export const DETAILS_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a month to fill in details

/* Returns { payment, sponsor } or { error, status }. */
export async function bgEditableByToken(token) {
  // newToken() values are long; anything short is noise, not a lookup.
  if (typeof token !== 'string' || token.length < 20 || token.length > 128) {
    return { error: 'not found', status: 404 };
  }
  const payment = await bgPaymentByDetailsToken(token);
  if (!payment || Date.now() - Number(payment.created_at) > DETAILS_TOKEN_TTL_MS) {
    return { error: 'not found', status: 404 };
  }
  if (payment.status !== 'cleared') return { error: 'payment not cleared yet', status: 409 };

  const sponsor = await bgSponsorById(payment.sponsor_id);
  if (!sponsor || sponsor.status !== 'active' || sponsor.first_cleared_at == null) {
    return { error: 'this placement cannot be edited right now', status: 409 };
  }
  // The winner is the one RECORDED at claim time (claimed_by); the
  // earliest-cleared proxy survives only for rows claimed before the column.
  const winnerId = sponsor.claimed_by ?? (await bgFirstClearedScreenedPayment(sponsor.id))?.id;
  if (winnerId !== payment.id) {
    return { error: 'this payment tops up an existing placement', status: 403 };
  }
  return { payment, sponsor };
}
