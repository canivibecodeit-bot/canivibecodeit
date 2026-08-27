/* Payment interface for The Build Games. Two impls behind one boundary:
   - ADMIN-ENTRY (launch): submitBid then clearPayment are both driven by the
     token-gated admin — Rob funds the pot / adds sponsors by hand.
   - PROCESSOR (later): the public checkout creates a pending payment via
     submitBid, and a webhook calls clearPayment on success / reversePayment on
     chargeback. Nothing here knows which; the caller wires the trigger.

   Identity = the canonical FINAL link (one sponsor row per link, cumulative
   top-ups). The tagline + icon are set when the sponsor row is first created
   and are immutable via later payments — a top-up only ever adds money, never
   changes anyone's tagline (kills the $5 defacement vector). Admin can still
   correct a tagline. */
import {
  bgPaymentById,
  bgSponsorByLink,
  bgSponsorById,
  insertBgPayment,
  insertBgSponsor,
  setBgPaymentStatus,
  stampFirstCleared,
} from './db.js';
import { newPaymentId, newSponsorId, registrableHost, sponsorIdentity } from './buildgames.js';
import { selfHostSponsorIcon } from './challenge-image.js';

/* Create (or find) the sponsor for a screened submission and append a pending
   payment. `screen` is the result of screenSubmission(); `tagline` is already
   cleaned by the caller. Returns { sponsorId, paymentId } or { error }. */
export async function submitBid({ screen, tagline, amountCents }) {
  const link = sponsorIdentity(screen.finalUrl);
  const host = registrableHost(screen.finalUrl.hostname);

  let sponsor = await bgSponsorByLink(link);
  if (sponsor) {
    // A removed sponsor can't be topped back into visibility.
    if (sponsor.status === 'removed') return { error: 'blocked' };
    // Top-up: money only. tagline/icon stay as first set.
  } else {
    // First submission for this link creates the identity. Self-host the icon
    // now (R2 on prod; null → monogram on mirror). Held submissions still get
    // a row so the pending money is tracked; they just don't display.
    const id = newSponsorId();
    const iconUrl = screen.faviconUrl ? await selfHostSponsorIcon(screen.faviconUrl, id) : null;
    await insertBgSponsor({
      id,
      link,
      host,
      tagline: tagline ?? null,
      icon_url: iconUrl,
      status: screen.verdict === 'ok' ? 'active' : 'held',
      held_reason: screen.reason ?? null,
      created_at: Date.now(),
    });
    sponsor = await bgSponsorById(id);
  }

  const paymentId = newPaymentId();
  await insertBgPayment({
    id: paymentId,
    sponsor_id: sponsor.id,
    amount_cents: amountCents,
    status: 'pending',
    processor_ref: null,
    created_at: Date.now(),
  });
  return { sponsorId: sponsor.id, paymentId };
}

/* Mark a pending payment cleared (money is now in the pool). Stamps the
   sponsor's first_cleared_at once, for rank tie-breaking. Idempotent-ish: a
   non-pending payment is left alone. */
export async function clearPayment(paymentId) {
  const p = await bgPaymentById(paymentId);
  if (!p || p.status !== 'pending') return false;
  await setBgPaymentStatus(paymentId, 'cleared');
  await stampFirstCleared(p.sponsor_id, Date.now());
  return true;
}

/* Reverse a cleared payment (chargeback / refund): it drops out of the pot and
   the sponsor's rank sum automatically, since both are SUM(status='cleared'). */
export async function reversePayment(paymentId) {
  const p = await bgPaymentById(paymentId);
  if (!p || p.status === 'reversed') return false;
  await setBgPaymentStatus(paymentId, 'reversed');
  return true;
}
