// Place a bid on The Build Games: a public link + tagline + amount. Screens
// the link (SSRF-safe fetch, Safe Browsing, favicon pull) and appends a
// PENDING payment; clearing is the payment interface's job (admin now, webhook
// later). Same open-submission protections as the challenge entry form.
//
// In admin-entry mode the public checkout is dark, so this endpoint is the
// pipeline the admin drives; when a processor lands, the public checkout calls
// it and the webhook clears. It stays gated behind BUILDGAMES_BIDDING_OPEN.
import { createHash } from 'node:crypto';
import { addToWaitlist, bgIsHostBlocked, bgSponsorByLink, rateLimit } from '../../../lib/db.js';
import { buildGamesLive } from '../../../lib/flags.js';
import { alertRob, mirrorToResend } from '../../../lib/mail.js';
import { clientIp, crossOrigin, json, readBody, validEmail } from '../../../lib/request.js';
import {
  MAX_BID_CENTS,
  MIN_ENTRY_CENTS,
  MIN_TOPUP_CENTS,
  biddingOpen,
  cleanTagline,
  registrableHost,
  sponsorIdentity,
} from '../../../lib/buildgames.js';
import { assertSafeBrowsingReady } from '../../../lib/safe-browsing.js';
import { screenSubmission } from '../../../lib/buildgames-screen.js';
import { submitBid } from '../../../lib/buildgames-payments.js';

export async function POST({ request, clientAddress }) {
  if (!buildGamesLive()) return new Response(null, { status: 404 });
  assertSafeBrowsingReady();
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);
  if (!biddingOpen()) return json({ error: 'bidding opens soon' }, 409);

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`bgbid:${ip}`, 5, 60 * 60 * 1000))) {
    return json({ error: 'a few bids an hour is plenty · back soon' }, 429);
  }
  if (!(await rateLimit('bgbid:all', 2000, 24 * 60 * 60 * 1000))) {
    return json({ error: 'the board is flooded right now, try again shortly' }, 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true }, 202); // honeypot
  }

  // Amount: integer cents. Cheap pre-screen check against the LOWER of the two
  // floors (the exact entry-vs-topup floor needs the screened identity, below).
  const floorCents = Math.min(MIN_ENTRY_CENTS, MIN_TOPUP_CENTS);
  const amountCents = Math.round(Number(body.amount_cents ?? body.amount));
  if (!Number.isInteger(amountCents) || amountCents < floorCents || amountCents > MAX_BID_CENTS) {
    return json({ error: `amount must be between $${floorCents / 100} and $${MAX_BID_CENTS / 100}` }, 400);
  }

  const tagline = cleanTagline(body.tagline);
  if (body.tagline && !tagline) {
    return json({ error: 'tagline: up to 80 characters, no links' }, 400);
  }

  // Optional contact email: reachable for held/outbid alerts, and (opt-in) it
  // joins the Build Games list — every bidder is an email on THE metric. Stored
  // on the payment, frozen to the sponsor at first clear, never shown publicly.
  const contactEmail = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (contactEmail && !validEmail(contactEmail)) {
    return json({ error: 'that email does not look sendable' }, 400);
  }

  // Screen the link (parse + SSRF-safe fetch + Safe Browsing + favicon).
  const screen = await screenSubmission(body.link);
  if (!screen.ok) return json({ error: screen.reason || 'that link cannot be entered' }, 400);

  // Host blocklist on the FINAL host (a removed/abusive host stays out).
  if (await bgIsHostBlocked(registrableHost(screen.finalUrl.hostname))) {
    return json({ error: "that site can't be entered" }, 403);
  }

  // Exact floor, now that screening resolved the identity: a bid on a sponsor
  // that has already CLEARED is a top-up; everything else (new link, or a link
  // whose bids never cleared) is an entry and pays the entry floor.
  const existing = await bgSponsorByLink(sponsorIdentity(screen.finalUrl));
  const isTopup = existing?.first_cleared_at != null;
  const minCents = isTopup ? MIN_TOPUP_CENTS : MIN_ENTRY_CENTS;
  if (amountCents < minCents) {
    return json({ error: `minimum ${isTopup ? 'top-up' : 'entry'} is $${minCents / 100}` }, 400);
  }

  const result = await submitBid({ screen, tagline, amountCents, contactEmail: contactEmail || null });
  if (result.error === 'blocked') return json({ error: "that site can't be entered" }, 403);

  // List capture (opt-in): a new waitlist row mirrors to Resend; existing
  // unsubscribes stay unsubscribed. Only when the bidder ticked the box.
  if (contactEmail && ['1', 'true', 'on', 'yes'].includes(String(body.email_optin ?? '').toLowerCase())) {
    if (await addToWaitlist(contactEmail, 'buildgames')) mirrorToResend(contactEmail);
  }

  if (screen.verdict === 'held') {
    if (await rateLimit('bg:held-alert', 6, 60 * 60 * 1000)) {
      alertRob(
        '[cvci] build games bid held',
        `<p>A Build Games bid needs review: ${screen.reason}</p>
         <p><a href="https://canivibecodeit.com/admin/thebuildgames">open the queue and paste your token</a></p>`
      ).catch((err) => console.error(`bg held alert failed: ${err.message}`));
    }
  }

  // Hashed IP distinct_id only — no address stored.
  const _did = createHash('sha256').update(ip).digest('hex').slice(0, 32);

  return json(
    screen.verdict === 'held'
      ? { ok: true, held: true, message: 'bid received · it needs a quick look before it lists' }
      : { ok: true, id: result.sponsorId, message: 'bid placed · it lists once payment clears' },
    201
  );
}
