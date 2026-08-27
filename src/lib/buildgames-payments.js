/* Payment interface for The Build Games. Two impls behind one boundary:
   - ADMIN-ENTRY (launch): submitBid then clearPayment are both driven by the
     token-gated admin — Rob funds the pot / adds sponsors by hand.
   - PROCESSOR (later): the public checkout creates a pending payment via
     submitBid, and a webhook calls clearPayment on success / reversePayment on
     chargeback. Nothing here knows which; the caller wires the trigger.

   Identity = the canonical FINAL link (one sponsor row per link, cumulative
   top-ups). The tagline, icon AND status are frozen when a sponsor's FIRST
   payment CLEARS — from THAT payment's screening — and are immutable via later
   payments. So an unpaid submission owns nothing (no $5 defacement), and a
   squatter's 'held' verdict can't poison a paying sponsor's placement
   (audit H2 + A1). The freeze and the pending→cleared transition are both
   single atomic UPDATEs, so concurrent clears can't race the identity or
   double-fire (audit A1, H4.3). */
import {
  bgPaymentById,
  bgSponsorByLink,
  bgSponsorById,
  claimFirstClear,
  clearBgPaymentAtomic,
  insertBgPayment,
  insertBgSponsor,
  reverseBgPaymentAtomic,
  updateBgSponsor,
} from './db.js';
import { newPaymentId, newSponsorId, registrableHost, sponsorIdentity } from './buildgames.js';
import { selfHostSponsorIcon } from './challenge-image.js';

/* Create (or find) the sponsor for a screened submission and append a pending
   payment. The sponsor row starts 'held' with no tagline/icon; the FIRST
   payment to clear freezes identity + status from ITS screening. The screening
   outcome rides on the payment (proposed_status/proposed_reason) so the
   clearing payer's verdict wins, not the row creator's. `screen` is
   screenSubmission()'s result; `tagline` is already cleaned. Returns
   { sponsorId, paymentId } or { error }. */
export async function submitBid({ screen, tagline, amountCents }) {
  const link = sponsorIdentity(screen.finalUrl);
  const host = registrableHost(screen.finalUrl.hostname);

  let sponsor = await bgSponsorByLink(link);
  if (sponsor) {
    // A removed sponsor can't be topped back into visibility.
    if (sponsor.status === 'removed') return { error: 'blocked' };
  } else {
    // First submission for this link creates the identity row — 'held' and
    // blank until a payment clears. No screening result is trusted from an
    // unpaid submission.
    const id = newSponsorId();
    await insertBgSponsor({
      id,
      link,
      host,
      tagline: null,
      icon_url: null,
      status: 'held',
      held_reason: 'awaiting first cleared payment',
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
    // This payment's screening becomes the sponsor's status if it wins the
    // first-clear claim: clean → active, anything else → held.
    proposed_status: screen.verdict === 'ok' ? 'active' : 'held',
    proposed_reason: screen.verdict === 'ok' ? null : (screen.reason ?? 'held'),
    created_at: Date.now(),
  });
  return { sponsorId: sponsor.id, paymentId };
}

/* Clear a pending payment. Two atomic steps:
   1. pending→cleared, and only the FIRST concurrent caller proceeds (a retry
      storm / double webhook gets false) — so side effects fire once.
   2. If this is the sponsor's first clear, atomically claim the identity:
      freeze tagline + status (from THIS payment's screen) + first_cleared_at,
      but only if not already frozen. Exactly one concurrent clear wins the
      claim; the icon is self-hosted only after winning it. */
export async function clearPayment(paymentId) {
  if (!(await clearBgPaymentAtomic(paymentId))) return false; // already cleared / not pending
  const p = await bgPaymentById(paymentId);

  const won = await claimFirstClear(
    p.sponsor_id,
    p.proposed_tagline ?? null,
    p.proposed_status || 'held',
    p.proposed_reason ?? null,
    Date.now()
  );
  if (won && p.proposed_icon_src) {
    // Icon fetched/re-encoded ONLY after this payment won the identity — never
    // for bids that never clear, and never racing a competing clear's icon.
    const iconUrl = await selfHostSponsorIcon(p.proposed_icon_src, p.sponsor_id);
    if (iconUrl) await updateBgSponsor(p.sponsor_id, { icon_url: iconUrl });
  }
  return true;
}

/* Reverse a payment (chargeback / refund): atomic, idempotent. It drops out of
   the pot and the sponsor's rank sum automatically, since both are
   SUM(status='cleared'). */
export async function reversePayment(paymentId) {
  return (await reverseBgPaymentAtomic(paymentId)) > 0;
}
