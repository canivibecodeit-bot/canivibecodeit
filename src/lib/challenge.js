/* Build-challenge vertical: shared vocabulary + helpers. Challenge CONTENT
   lives here in the repo (the repo is the admin panel, same deal as apps);
   the database holds runtime state only — entries. Dates are code with env
   overrides so the mirror can run a test window without a copy change.

   The twist: one requirement stays sealed until kickoff. It exists so the
   gallery can only contain builds made during the window — a build that
   handles the twist provably wasn't made in advance. The twist TEXT lands in
   a copy PR shortly before opening; it renders only once the clock passes
   twistRevealAt, so merging early leaks nothing. */
import { randomBytes } from 'node:crypto';
import { parsePublicUrl } from './builds.js';
import { safeFetch } from './safe-fetch.js';

/* ---------- the challenges (append-only; last = current) ---------- */

// PLACEHOLDER copy throughout — final wording lands in a copy PR before the
// flag flips. Structure is final, words are not.
export const CHALLENGES = [
  {
    id: 1,
    slug: 'one',
    title: 'Challenge #1',
    // placeholder — final headline from the Lead. NOTE: parallel-triple
    // constructions ("one X. one Y. one Z.") are banned by the humanizer
    // rules; whatever lands here must not have that shape.
    headline: 'Prompt a working build into existence before the window closes.',
    // The spec card: what the build must DO. 5-6 required behaviors.
    behaviors: [
      'placeholder · required behavior one',
      'placeholder · required behavior two',
      'placeholder · required behavior three',
      'placeholder · required behavior four',
      'placeholder · required behavior five',
    ],
    // The method line: the one-sentence contract of the whole exercise.
    // Final copy (operator-approved) — do not paraphrase.
    method:
      'Build it by prompting an AI agent, not by writing the code yourself. We cannot verify that, so we are taking your word for it.',
    // Final copy (operator-approved) — do not paraphrase.
    rules: [
      'Enter by posting a live URL along with your X handle. That is how we credit you if you win.',
      'Build during the challenge window. Work that started before the opening date does not count.',
      'Your build has to include the twist. Entries without it will not be judged.',
      'Already sell a product that does this? Submit it to the directory instead. The challenge is for new builds.',
      'Say plainly that an AI built it. That is the point of the exercise, not a disclaimer.',
    ],
    // ⛔ The twist content NEVER lives in this file. The repo is public and
    // its watchers are exactly the people most likely to enter — twist text
    // in merged source leaks days early and defeats the built-during-the-
    // window mechanism entirely. Content arrives via the CHALLENGE_TWIST env
    // var (set on Railway at the launch-morning flip, same lifecycle as
    // CHALLENGE_LIVE); render still waits for opensAt. Keep this null.
    twist: null,
    // Why the twist exists — always visible, so the mechanic reads as fair.
    twistExplainer:
      'one requirement stays sealed until kickoff. if your build handles it, it was built during the window. that is the whole point.',
    opensAt: Date.UTC(2026, 8, 1, 16, 0, 0), // placeholder — final date in the copy PR
    closesAt: Date.UTC(2026, 8, 8, 16, 0, 0),
    // Partner credit block: null renders nothing. kind: 'sponsor' | 'wave'.
    // { kind, name, url, logo } — logo is a /public path or https URL.
    partner: null,
  },
];

/* Mirror/testing overrides: ms-since-epoch or anything Date.parse reads.
   Unset in production once real dates are in the code. */
const envTime = (name) => {
  const v = process.env[name];
  if (!v) return null;
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

export function currentChallenge() {
  const c = CHALLENGES[CHALLENGES.length - 1];
  return {
    ...c,
    opensAt: envTime('CHALLENGE_OPENS_AT') ?? c.opensAt,
    closesAt: envTime('CHALLENGE_CLOSES_AT') ?? c.closesAt,
    // Environment-only on purpose — see the note on the twist field above.
    twist: process.env.CHALLENGE_TWIST?.trim() || c.twist,
  };
}

// upcoming -> open -> closed. All comparisons UTC ms.
export function challengeState(c, now = Date.now()) {
  if (now < c.opensAt) return 'upcoming';
  if (now < c.closesAt) return 'open';
  return 'closed';
}

// The twist is public once the window opens (kickoff = reveal).
export const twistRevealed = (c, now = Date.now()) => now >= c.opensAt && !!c.twist;

/* ---------- entries ---------- */

const ID_ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';

export function newEntryId() {
  const bytes = randomBytes(10);
  return `ce_${[...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`;
}

export const ENTRY_ID_RE = /^ce_[a-z2-9]{10}$/;

// X's actual constraint: 1-15 word characters. Stored without the @, in the
// case the entrant typed (X handles are case-insensitive; display keeps the
// typed case, lookups lower-case in SQL).
export const XHANDLE_RE = /^[A-Za-z0-9_]{1,15}$/;

export function normalizeHandle(raw) {
  if (typeof raw !== 'string') return null;
  const h = raw.trim().replace(/^@+/, '');
  return XHANDLE_RE.test(h) ? h : null;
}

/* Canonical form for dedupe: lowercase host, no fragment, sorted value-bearing
   query, no trailing "?" — so evil.com/?2, evil.com/#x and evil.com// collapse
   into one row (audit H4). Query is rebuilt via URLSearchParams so the stored
   URL is RE-ENCODED, not left in decoded form — otherwise the URL we screen
   could differ from the one we publish (audit N1). */
export function canonicalUrl(u) {
  const c = new URL(u.href);
  c.hash = '';
  c.hostname = c.hostname.toLowerCase();
  c.pathname = c.pathname.replace(/\/+/g, '/').replace(/\/+$/, '') || '/';
  const sp = new URLSearchParams();
  for (const [k, v] of [...c.searchParams.entries()].filter(([, v]) => v !== '').sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    sp.append(k, v);
  }
  const q = sp.toString();
  c.search = q ? `?${q}` : '';
  return c.href;
}

/* Hosting suffixes where the registrable unit is one label DEEPER than the
   last two labels — either multi-label public suffixes (co.uk) or shared
   platforms where every user owns a subdomain (*.vercel.app). For these the
   block unit is "<one label>.<suffix>" so blocking one project's host does
   NOT blanket-block every sibling on the platform. Not the full PSL — the
   common cases vibe-coders actually ship on, extendable as needed. */
const SHARED_SUFFIXES = new Set([
  // free/app hosting one label per user
  'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'github.io',
  'gitlab.io', 'herokuapp.com', 'web.app', 'firebaseapp.com', 'onrender.com',
  'fly.dev', 'railway.app', 'up.railway.app', 'surge.sh', 'glitch.me',
  'replit.app', 'repl.co', 'streamlit.app', 'deno.dev', 'cloudflareaccess.com',
  // common multi-label public suffixes
  'co.uk', 'org.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp',
  'co.in', 'co.za', 'com.br', 'com.mx', 'com.sg',
]);

/* The unit we block on, computed identically when STORING and when CHECKING
   so a bare exact-match lookup catches apex + every subdomain of a blocked
   registrable domain (audit H4). evil.com, www.evil.com and deep.sub.evil.com
   all collapse to "evil.com"; foo.vercel.app collapses to "foo.vercel.app"
   (siblings unaffected). */
export function registrableHost(hostname) {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  const labels = host.split('.');
  if (labels.length <= 2) return host;
  for (let i = 1; i < labels.length - 1; i += 1) {
    if (SHARED_SUFFIXES.has(labels.slice(i).join('.'))) {
      return labels.slice(i - 1).join('.');
    }
  }
  return labels.slice(-2).join('.');
}

/* ---------- page metadata fetch (title + the page's own og:image) ----------
   The 60-second form asks for a URL and nothing else; title and image are
   derived. This fetches an ATTACKER-CHOSEN URL server-side, so it runs
   entirely through safe-fetch.js: connection pinned to a vetted public
   address (no DNS-rebind window), redirects walked by hand with every hop
   re-screened by parsePublicUrl, 256KB decoded-byte cap, 8s budget. The URL
   we actually LANDED on comes back too, so the Safe Browsing gate and the
   stored record describe the real destination, not the first hop. */

const META_BYTES = 262144; // 256KB is plenty to find <head> content
const META_TIMEOUT = 8000;
const MAX_HOPS = 3;

// The entry URL's own policy, reused for every redirect hop.
const screenHop = (raw) => parsePublicUrl(raw, { maxLen: 500 });

/* Strip characters that let a scraped title lie about itself: HTML markup
   chars (defence in depth for any future unescaped sink — we do NOT decode
   entities back into live markup), bidi overrides and zero-width glyphs that
   visually reorder or hide text. */
const UNSAFE_GLYPHS = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

export function sanitizeTitle(raw) {
  return raw
    .replace(/[<>]/g, '')
    .replace(UNSAFE_GLYPHS, '') // zero-width, bidi overrides/isolates, BOM
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

export async function fetchPageMeta(url) {
  // reached=false means the walk never resolved to a definitive final
  // response (a hop was refused, the chain was too deep, or the transport
  // failed) — the caller must treat that as unknown and HOLD, never screen
  // only the clean first hop and list live (audit re-pass H3).
  const meta = { title: url.hostname, ogImage: null, finalUrl: url.href, reached: false };
  const res = await safeFetch(url, {
    screen: screenHop,
    maxBytes: META_BYTES,
    timeoutMs: META_TIMEOUT,
    maxHops: MAX_HOPS,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
  });
  if (!res) return meta; // refused/failed walk → reached stays false

  // We reached a real final response. Record WHERE we landed BEFORE looking at
  // content-type, so a non-HTML / 4xx / empty-body final is screened at its
  // true destination instead of silently reverting to the submitted URL.
  meta.reached = true;
  meta.finalUrl = res.finalUrl.href;
  if (!res.body || !res.contentType.includes('html')) return meta;

  const html = res.body.toString('utf8');

  const rawTitle = html.match(/<title[^>]*>([^<]{1,300})/i)?.[1];
  if (rawTitle) {
    const clean = sanitizeTitle(rawTitle);
    if (clean) meta.title = clean;
  }

  // property= or name=, either attribute order, single or double quotes.
  const og =
    html.match(/<meta[^>]+(?:property|name)\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']{1,500})["']/i)?.[1] ??
    html.match(/<meta[^>]+content\s*=\s*["']([^"']{1,500})["'][^>]+(?:property|name)\s*=\s*["']og:image["']/i)?.[1];
  if (og) {
    // og:image resolves against the page we actually landed on, and must
    // clear the same public-https bar as the entry URL.
    try {
      const resolved = parsePublicUrl(new URL(og, res.finalUrl.href).href, { maxLen: 500 });
      if (resolved) meta.ogImage = resolved.href;
    } catch {
      /* malformed og:image URL — just skip it */
    }
  }
  return meta;
}

/* ---------- display ---------- */

export function countdownParts(untilMs, now = Date.now()) {
  const s = Math.max(0, Math.floor((untilMs - now) / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}
