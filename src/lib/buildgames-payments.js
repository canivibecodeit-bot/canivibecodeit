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
  updateBgSponsor,
} from './db.js';
import { newPaymentId, newSponsorId, registrableHost, sponsorIdentity } from './buildgames.js';
import { selfHostSponsorIcon } from './challenge-image.js';

/* Create (or find) the sponsor for a screened submission and append a pending
   payment. The tagline + screened favicon are recorded ON THE PAYMENT, not the
   sponsor — they only take effect if/when this payment is the FIRST to clear
   (first-cleared-payer sets identity). `screen` is screenSubmission()'s result;
   `tagline` is already cleaned. Returns { sponsorId, paymentId } or { error }. */
export async function submitBid({ screen, tagline, amountCents }) {
  const link = sponsorIdentity(screen.finalUrl);
  const host = registrableHost(screen.finalUrl.hostname);

  let sponsor = await bgSponsorByLink(link);
  if (sponsor) {
    // A removed sponsor can't be topped back into visibility.
    if (sponsor.status === 'removed') return { error: 'blocked' };
  } else {
    // First submission for this link creates the identity row — but WITHOUT a
    // tagline/icon; those are frozen at first clear. status comes from the
    // screening verdict (held submissions still get a row to track the money).
    const id = newSponsorId();
    await insertBgSponsor({
      id,
      link,
      host,
      tagline: null,
      icon_url: null,
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
    proposed_tagline: tagline ?? null,
    proposed_icon_src: screen.faviconUrl ?? null,
    created_at: Date.now(),
  });
  return { sponsorId: sponsor.id, paymentId };
}

/* Mark a pending payment cleared (money is now in the pool). If it is the
   FIRST payment to clear for its sponsor, that payment's proposed tagline +
   icon freeze onto the sponsor (self-hosting the icon then, so we never fetch
   media for bids that never clear) and first_cleared_at is stamped. Later
   clears add money only. */
export async function clearPayment(paymentId) {
  const p = await bgPaymentById(paymentId);
  if (!p || p.status !== 'pending') return false;
  await setBgPaymentStatus(paymentId, 'cleared');

  const sponsor = await bgSponsorById(p.sponsor_id);
  if (sponsor && sponsor.first_cleared_at == null) {
    const iconUrl = p.proposed_icon_src ? await selfHostSponsorIcon(p.proposed_icon_src, sponsor.id) : null;
    await updateBgSponsor(sponsor.id, {
      tagline: p.proposed_tagline ?? null,
      icon_url: iconUrl,
      first_cleared_at: Date.now(),
    });
  }
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
