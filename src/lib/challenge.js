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
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { parsePublicUrl } from './builds.js';

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

/* ---------- page metadata fetch (title + the page's own og:image) ----------
   The 60-second form asks for a URL and nothing else; title and image are
   derived. This is a server-side fetch of an ATTACKER-CHOSEN URL, so it is
   the vertical's sharpest edge and every hop is treated as hostile:
   - parsePublicUrl already refused IP literals, credentials, non-https and
     internal-looking names — but that is string-level only, so
   - every hostname is DNS-resolved first and rejected if ANY address is
     loopback, private, link-local, CGNAT, metadata (169.254.x), or v6
     equivalents — a public name pointing at 127.0.0.1 gets nowhere;
   - redirects are followed MANUALLY (max 3), each hop re-parsed against the
     same public-https bar and re-resolved — a friendly page that 302s to
     169.254.169.254 dies at the hop, not after;
   - the read is capped at 256KB of DECODED bytes (the reader sees
     post-decompression output, so a gzip bomb stops at the cap too);
   - 8s overall budget, silent failure — a page that won't say its title
     becomes its hostname, never an error the entrant sees. */

const META_BYTES = 262144; // 256KB is plenty to find <head> content
const META_TIMEOUT = 8000;
const MAX_HOPS = 3;

// Address ranges a server-side fetch must never reach. v4 checked directly
// and again when mapped inside v6 (::ffff:a.b.c.d).
function privateV4(ip) {
  const o = ip.split('.').map(Number);
  return (
    o[0] === 0 || o[0] === 10 || o[0] === 127 ||
    (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || // CGNAT
    (o[0] === 169 && o[1] === 254) ||              // link-local + cloud metadata
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    o[0] >= 224                                    // multicast + reserved
  );
}

function privateAddress(ip) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // ULA
    v6.startsWith('fe8') || v6.startsWith('fe9') ||
    v6.startsWith('fea') || v6.startsWith('feb')  // link-local
  );
}

// True only when the hostname resolves and EVERY address is public.
async function resolvesPublic(hostname) {
  try {
    const addrs = await lookup(hostname, { all: true, verbatim: true });
    return addrs.length > 0 && addrs.every((a) => !privateAddress(a.address));
  } catch {
    return false; // unresolvable = nothing to fetch anyway
  }
}

export async function fetchPageMeta(url) {
  const meta = { title: url.hostname, ogImage: null };
  try {
    // Walk redirects by hand: every hop must clear the public-https bar AND
    // resolve to public addresses before it is fetched.
    let current = url;
    let res = null;
    const deadline = AbortSignal.timeout(META_TIMEOUT);
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      if (!(await resolvesPublic(current.hostname))) return meta;
      res = await fetch(current.href, {
        redirect: 'manual',
        signal: deadline,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; canivibecodeit-challenge; +https://canivibecodeit.com/challenge)',
          Accept: 'text/html',
        },
      });
      if (res.status < 300 || res.status >= 400) break;
      const location = res.headers.get('location');
      res.body?.cancel().catch(() => {});
      if (!location || hop === MAX_HOPS) return meta;
      const next = parsePublicUrl(new URL(location, current.href).href, { maxLen: 500 });
      if (!next) return meta;
      current = next;
      res = null;
    }
    if (!res || !res.ok || !(res.headers.get('content-type') || '').includes('html')) return meta;
    url = current; // og:image resolves against the page we actually read

    const reader = res.body.getReader();
    const chunks = [];
    let size = 0;
    while (size < META_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    reader.cancel().catch(() => {});
    const html = Buffer.concat(chunks).toString('utf8');

    const title = html.match(/<title[^>]*>([^<]{1,300})/i)?.[1];
    if (title) {
      const clean = title
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
      if (clean) meta.title = clean;
    }

    // property= or name=, either attribute order, single or double quotes.
    const og =
      html.match(/<meta[^>]+(?:property|name)\s*=\s*["']og:image["'][^>]+content\s*=\s*["']([^"']{1,500})["']/i)?.[1] ??
      html.match(/<meta[^>]+content\s*=\s*["']([^"']{1,500})["'][^>]+(?:property|name)\s*=\s*["']og:image["']/i)?.[1];
    if (og) {
      // Relative og:image URLs resolve against the page; whatever comes out
      // must clear the same public-https bar as the entry URL itself.
      const resolved = parsePublicUrl(new URL(og, url.href).href, { maxLen: 500 });
      if (resolved) meta.ogImage = resolved.href;
    }
  } catch {
    /* a slow or broken page is not the entrant's problem */
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
  };
}
