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
  bgLeaderboard,
  bgPaymentById,
  bgSponsorByLink,
  claimFirstClear,
  clearBgPaymentAtomic,
  clearBgPaymentCaptured,
  insertBgPayment,
  insertBgSponsor,
  reverseBgPaymentAtomic,
  updateBgSponsor,
} from './db.js';
import { alertRob, sendMail, esc } from './mail.js';
import { displayName, newPaymentId, newSponsorId, rankSponsors, registrableHost, sponsorIdentity, usd } from './buildgames.js';
import { selfHostSponsorIcon } from './challenge-image.js';

/* Create (or find) the sponsor for a screened submission and append a pending
   payment. The sponsor row starts 'held' with no tagline/icon; the FIRST
   payment to clear freezes identity + status from ITS screening. The screening
   outcome rides on the payment (proposed_status/proposed_reason) so the
   clearing payer's verdict wins, not the row creator's. `screen` is
   screenSubmission()'s result; `tagline` is already cleaned. Returns
   { sponsorId, paymentId } or { error }. */
export async function submitBid({ screen, tagline, amountCents, contactEmail, iconSrc }) {
  const link = sponsorIdentity(screen.finalUrl);
  const host = registrableHost(screen.finalUrl.hostname);

  let sponsor = await bgSponsorByLink(link);
  if (sponsor) {
    // A removed sponsor can't be topped back into visibility.
    if (sponsor.status === 'removed') return { error: 'blocked' };
  } else {
    // First submission for this link creates the identity row — 'held' and
    // blank until a payment clears. No screening result is trusted from an
    // unpaid submission. The insert is ON CONFLICT/OR IGNORE and the re-read
    // is BY LINK: concurrent first submits for one link all land on whichever
    // row won, instead of one 500ing on the UNIQUE constraint (audit H4.4).
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
    sponsor = await bgSponsorByLink(link);
    if (!sponsor) return { error: 'blocked' }; // vanished between insert and read — bail safe
    if (sponsor.status === 'removed') return { error: 'blocked' };
  }

  const paymentId = newPaymentId();
  await insertBgPayment({
    id: paymentId,
    sponsor_id: sponsor.id,
    amount_cents: amountCents,
    status: 'pending',
    processor_ref: null,
    proposed_tagline: tagline ?? null,
    // An uploaded icon (already re-encoded + parked on our R2) beats the
    // screened favicon; either way the final icon is re-hosted at clear.
    proposed_icon_src: iconSrc ?? screen.faviconUrl ?? null,
    // This payment's screening becomes the sponsor's status if it wins the
    // first-clear claim: clean → active, anything else → held.
    proposed_status: screen.verdict === 'ok' ? 'active' : 'held',
    proposed_reason: screen.verdict === 'ok' ? null : (screen.reason ?? 'held'),
    contact_email: contactEmail ?? null,
    created_at: Date.now(),
  });
  return { sponsorId: sponsor.id, paymentId };
}

/* Clear a pending payment. Two atomic steps:
   1. pending→cleared, and only the FIRST concurrent caller proceeds (a retry
      storm / double webhook gets false) — so side effects fire once. When the
      caller is a PROCESSOR webhook it passes { capturedCents, processorRef }:
      the same statement then also stamps the amount the processor actually
      CAPTURED (H4.1 — the recorded amount is never trusted for money) and the
      capture's unique ref (H4.2 — a reused ref throws on the unique index and
      clears nothing, so a replayed/cross-wired delivery can't double-credit).
   2. If this is the sponsor's first clear, atomically claim the identity:
      freeze tagline + status (from THIS payment's screen) + first_cleared_at,
      but only if not already frozen. Exactly one concurrent clear wins the
      claim; the icon is self-hosted only after winning it. */
export async function clearPayment(paymentId, capture = null) {
  // Who leads before this clear counts — for the outbid nudge below.
  let prevLeader = null;
  try { prevLeader = rankSponsors(await bgLeaderboard())[0] ?? null; } catch { /* best-effort */ }

  let cleared;
  if (capture) {
    try {
      cleared = await clearBgPaymentCaptured(paymentId, capture.capturedCents, capture.processorRef);
    } catch (err) {
      // Almost certainly the unique processor_ref index: this capture already
      // cleared some payment. Money moved somewhere — a human must look.
      alertRob(
        '[cvci] build games: processor ref REUSED — payment not cleared',
        `<p>Clearing payment <code>${esc(paymentId)}</code> with ref <code>${esc(String(capture.processorRef))}</code> failed: ${esc(err.message)}.</p>
         <p>That ref has already cleared a payment. Nothing was credited; reconcile by hand in Stripe + the admin queue.</p>`
      ).catch(() => {});
      return false;
    }
  } else {
    cleared = await clearBgPaymentAtomic(paymentId);
  }
  if (!cleared) return false; // already cleared / not pending
  const p = await bgPaymentById(paymentId);

  const won = await claimFirstClear(
    p.sponsor_id,
    p.proposed_tagline ?? null,
    p.proposed_status || 'held',
    p.proposed_reason ?? null,
    p.contact_email ?? null, // the owner email for held/outbid notifications
    Date.now()
  );
  if (won && p.proposed_icon_src) {
    // Icon fetched/re-encoded ONLY after this payment won the identity — never
    // for bids that never clear, and never racing a competing clear's icon.
    const iconUrl = await selfHostSponsorIcon(p.proposed_icon_src, p.sponsor_id);
    if (iconUrl) await updateBgSponsor(p.sponsor_id, { icon_url: iconUrl });
  }

  // Outbid nudge (best-effort, never blocks the clear): if this clear changed
  // the #1 spot, email the displaced leader "you've been outbid, top up to
  // reclaim it" — a revenue prompt. Only when they left a contact email.
  try {
    const newLeader = rankSponsors(await bgLeaderboard())[0] ?? null;
    if (
      prevLeader && newLeader &&
      prevLeader.id !== newLeader.id &&
      prevLeader.id !== p.sponsor_id &&
      prevLeader.contact_email
    ) {
      sendMail({
        to: prevLeader.contact_email,
        subject: 'You’ve been outbid — The Build Games',
        html: `<p>Someone just took the #1 spot on The Build Games with ${esc(usd(newLeader.cleared_total))}.</p>
               <p>Your placement (<b>${esc(displayName(prevLeader))}</b>, ${esc(usd(prevLeader.cleared_total))}) is now #2.</p>
               <p>Top up to reclaim the top spot — you keep it until someone bids more.</p>
               <p><a href="https://canivibecodeit.com/thebuildgames">the board →</a></p>`,
      }).catch((err) => console.error(`outbid mail failed: ${err.message}`));
    }
  } catch (err) {
    console.error(`outbid check failed: ${err.message}`);
  }
  return true;
}

/* Reverse a payment (chargeback / refund): atomic, idempotent. It drops out of
   the pot and the sponsor's rank sum automatically, since both are
   SUM(status='cleared'). */
export async function reversePayment(paymentId) {
  return (await reverseBgPaymentAtomic(paymentId)) > 0;
}
