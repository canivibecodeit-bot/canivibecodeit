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
  rateLimit,
} from '../../../lib/db.js';
import { challengeLive } from '../../../lib/flags.js';
import { alertRob, esc, mirrorToResend } from '../../../lib/mail.js';
import { clientIp, crossOrigin, json, readBody, validEmail } from '../../../lib/request.js';
import { parsePublicUrl } from '../../../lib/builds.js';
import {
  challengeState,
  currentChallenge,
  fetchPageMeta,
  newEntryId,
  normalizeHandle,
} from '../../../lib/challenge.js';
import { checkUrl, safeBrowsingOn } from '../../../lib/safe-browsing.js';

export async function POST({ request, clientAddress }) {
  if (!challengeLive()) return new Response(null, { status: 404 });
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

  // Same URL twice = the same entry, silently. Public content, nothing to
  // enumerate; re-posting your own entry just hands the permalink back.
  const dupe = await challengeEntryByUrl(challenge.id, url.href);
  if (dupe) {
    return json({ ok: true, id: dupe.id, url: `/challenge/e/${dupe.id}`, existing: true }, 200);
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

  // Derived, never typed: page title + the page's own og:image.
  const meta = await fetchPageMeta(url);

  // Safe Browsing gate: a match holds, an API error does not (fail open,
  // the daily recheck re-covers). Key unset = check off (mirror).
  let status = 'live';
  let heldReason = null;
  if (safeBrowsingOn()) {
    const threats = await checkUrl(url.href);
    if (threats) {
      status = 'held';
      heldReason = `safe-browsing: ${threats.join(', ')}`;
    }
  }

  const id = newEntryId();
  await insertChallengeEntry({
    id,
    challenge_id: challenge.id,
    x_handle: handle,
    url: url.href,
    page_title: meta.title,
    og_image: meta.ogImage,
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
      `<p>Safe Browsing flagged a challenge entry:</p>
       <p><b>${esc(meta.title)}</b> by @${esc(handle)}</p>
       <p>${esc(heldReason)}</p>
       <p><a href="https://canivibecodeit.com/admin/challenge?token=${encodeURIComponent(process.env.ADMIN_TOKEN ?? '')}">open the queue</a></p>`
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
