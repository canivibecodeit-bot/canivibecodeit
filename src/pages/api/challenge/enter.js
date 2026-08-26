// Enter the challenge: a live https URL + an X handle, nothing else typed.
// Title and image are derived from the page itself, so the form stays under
// a minute. Entries go live INSTANTLY when checks pass; a Safe Browsing
// match lands in the held queue instead (and only an admin releases it).
// Optional email opt-in rides the existing waitlist + Resend audience.
import { createHash } from 'node:crypto';
import { captureServer } from '../../../lib/analytics.js';
import {
  addToWaitlist,
  challengeEntryByUrl,
  insertChallengeEntry,
  isHostBlocked,
  rateLimit,
} from '../../../lib/db.js';
import { challengeLive } from '../../../lib/flags.js';
import { alertRob, esc, mirrorToResend } from '../../../lib/mail.js';
import { clientIp, crossOrigin, json, readBody, validEmail } from '../../../lib/request.js';
import { parsePublicUrl } from '../../../lib/builds.js';
import {
  blockableHost,
  canonicalUrl,
  challengeState,
  currentChallenge,
  fetchPageMeta,
  newEntryId,
  normalizeHandle,
} from '../../../lib/challenge.js';
import { assertSafeBrowsingReady, checkUrl, safeBrowsingOn } from '../../../lib/safe-browsing.js';
import { selfHostOgImage } from '../../../lib/challenge-image.js';

export async function POST({ request, clientAddress }) {
  if (!challengeLive()) return new Response(null, { status: 404 });
  // The gate must be armed whenever the vertical is live: refuse to accept
  // entries we can't screen rather than list them unchecked.
  assertSafeBrowsingReady();
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);

  const challenge = currentChallenge();
  const state = challengeState(challenge);
  if (state !== 'open') {
    return json(
      { error: state === 'upcoming' ? 'not open yet · come back at kickoff' : 'this one is closed · next challenge soon' },
      409
    );
  }

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`chent:${ip}`, 5, 60 * 60 * 1000))) {
    return json({ error: 'five entries an hour is plenty. back soon.' }, 429);
  }
  if (!(await rateLimit('chent:all', 500, 24 * 60 * 60 * 1000))) {
    if (await rateLimit('chent:cap-alert', 1, 24 * 60 * 60 * 1000)) {
      alertRob(
        '[cvci] challenge entry cap tripped',
        '<p>The global challenge entry cap (500/day) tripped. Great day or a flood — check the gallery. Caps live in src/pages/api/challenge/enter.js.</p>'
      ).catch((err) => console.error(`challenge cap alert failed: ${err.message}`));
    }
    return json({ error: 'the gallery is flooded right now, try again in a bit' }, 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  // Honeypot: a real visitor never fills this hidden field.
  if (typeof body.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true, id: newEntryId(), url: '/challenge' }, 201);
  }

  // The URL: public https only — parsePublicUrl refuses javascript:/data:
  // by construction (URL parse + https-only), plus credentials, IP literals
  // and internal-looking hosts.
  const url = parsePublicUrl(body.url);
  if (!url) return json({ error: 'the entry needs a public https address' }, 400);

  const handle = normalizeHandle(body.x_handle);
  if (!handle) return json({ error: 'an X handle: 1-15 letters, numbers, underscores' }, 400);

  // Host blocklist first: a site an admin unlisted (or Safe Browsing flagged)
  // can't come back under a fresh query string. Neutral message — don't
  // confirm to the attacker that their host is specifically blocked.
  if (await isHostBlocked(blockableHost(url.hostname))) {
    return json({ error: "that site can't be entered" }, 403);
  }

  // Dedupe on the CANONICAL url (lowercased host, no fragment, sorted query),
  // so evil.com/?2 and evil.com/#x collapse into the stored row instead of
  // minting infinite distinct entries. Only a LIVE dupe hands back its
  // permalink; held/unlisted matches return neutrally (no moderation oracle).
  const canonical = canonicalUrl(url);
  const dupe = await challengeEntryByUrl(challenge.id, canonical);
  if (dupe) {
    if (dupe.status === 'live') {
      return json({ ok: true, id: dupe.id, url: `/challenge/e/${dupe.id}`, existing: true }, 200);
    }
    return json({ ok: true, existing: true, message: 'that entry is already in' }, 200);
  }

  // Optional opt-in: results + next challenge, via the one digest list.
  // Only new waitlist rows mirror to Resend (unsubscribes stay unsubscribed).
  let emailOpted = 0;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (email) {
    if (!validEmail(email)) return json({ error: 'that email does not look sendable' }, 400);
    if (await addToWaitlist(email, 'challenge')) mirrorToResend(email);
    emailOpted = 1;
  }

  // Derive title + og:image from the page. fetchPageMeta walks redirects
  // through the SSRF-safe fetcher and reports the URL it actually LANDED on —
  // that final URL is what the gate screens and what we store.
  const meta = await fetchPageMeta(url);
  const finalUrl = parsePublicUrl(meta.finalUrl) ?? url;

  // Re-check the blocklist against the final host too: a clean host that
  // redirects to a blocked one doesn't get a free pass.
  if (finalUrl.href !== url.href && (await isHostBlocked(blockableHost(finalUrl.hostname)))) {
    return json({ error: "that site can't be entered" }, 403);
  }

  // Safe Browsing on the FINAL url: a match holds, and — unlike before — an
  // API error/timeout ('unknown') ALSO holds, for human review, rather than
  // listing live. On the mirror (unchecked explicitly allowed, no key) the
  // gate is skipped and entries list; production always has the key.
  let status = 'live';
  let heldReason = null;
  if (safeBrowsingOn()) {
    const verdict = await checkUrl(finalUrl.href);
    if (verdict === 'unknown') {
      status = 'held';
      heldReason = 'safe-browsing: check unavailable, pending review';
    } else if (verdict) {
      status = 'held';
      heldReason = `safe-browsing: ${verdict.join(', ')}`;
    }
  }

  // Self-host the og:image so it can't be swapped after approval. Mirror has
  // R2 off, so this is null there and the fallback tile shows.
  const id = newEntryId();
  const ogImage = meta.ogImage && status === 'live' ? await selfHostOgImage(meta.ogImage, id) : null;

  await insertChallengeEntry({
    id,
    challenge_id: challenge.id,
    x_handle: handle,
    url: canonical,
    page_title: meta.title,
    og_image: ogImage,
    email_opted: emailOpted,
    kind: 'entry',
    status,
    held_reason: heldReason,
    country: request.headers.get('cf-ipcountry') || null,
    created_at: Date.now(),
  });

  if (status === 'held') {
    alertRob(
      '[cvci] challenge entry held',
      `<p>A challenge entry needs review:</p>
       <p><b>${esc(meta.title)}</b> by @${esc(handle)}</p>
       <p>${esc(heldReason)}</p>
       <p><a href="https://canivibecodeit.com/admin/challenge">open the queue and paste your token</a></p>`
    ).catch((err) => console.error(`challenge held alert failed: ${err.message}`));
  }

  // Hashed IP as distinct_id: stable dedupe, no address in PostHog.
  captureServer(
    'challenge_entry',
    { challenge: challenge.id, held: status === 'held', opted_in: emailOpted === 1 },
    createHash('sha256').update(ip).digest('hex').slice(0, 32)
  );

  return json(
    status === 'held'
      ? { ok: true, id, held: true, message: 'entry received · it needs a quick manual look before it lists' }
      : { ok: true, id, url: `/challenge/e/${id}` },
    201
  );
}
