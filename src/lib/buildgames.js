/* The Build Games: sponsor-facing hype + bidding surface. 100% of sponsor
   bids go to the builders' prize pool — so the pot IS the sum of active bids,
   no separate ledger. Bids are ADMIN-ENTERED in v1 (manual funding, no payment
   processor); the shape leaves room for a real payment hook later via status.

   Ranking: amount desc, earliest placed wins ties — so a spot holds until
   someone bids strictly MORE. "Whoever's on top stays on top till the games
   end" is then literally true: you only drop when out-bid.

   Phase A ships with SEED_BIDS so Rob can eyeball the pot + leaderboard before
   the DB/admin exist. Phase B swaps activeBids()/potCents() to read the
   buildgames_bids table; the page and animation don't change. */
import { randomBytes } from 'node:crypto';

/* ---------- config ---------- */

// Countdown target: midnight at the start of Sept 1 in America/New_York.
// Sept 1 is EDT (UTC-4), so local 00:00 = 04:00 UTC. Env-overridable for
// mirror testing. (The video says "midnight EST" colloquially; the code does
// actual New York local midnight.)
const envTime = (name) => {
  const v = process.env[name];
  if (!v) return null;
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};
export const gamesStartAt = () => envTime('BUILDGAMES_START_AT') ?? Date.UTC(2026, 8, 1, 4, 0, 0);

// The pool is UNCAPPED — there is no goal and the orb is never "full". Fill
// level maps pot size onto a hyperbolic curve that asymptotically approaches
// MAX_FILL but never reaches it, so there's always headroom: a little money
// shows a little pool, a lot shows a lot, and it never looks "done".
//   level = MAX_FILL * pot / (pot + SCALE)
// SCALE sets where the curve bends (bigger = slower to look full). At $25k:
//   $500 → ~2%, $5k → ~15%, $50k → ~60%, $500k → ~86%, ∞ → 90% (never).
// A small floor keeps even a $5 bid visibly wetting the bottom.
const FILL_SCALE_CENTS = () => envTime('BUILDGAMES_FILL_SCALE_CENTS') ?? 2_500_000; // $25k
const MAX_FILL = 0.9;
const FILL_FLOOR = 0.03;

export function fillLevel(potCents) {
  if (potCents <= 0) return 0;
  const scale = FILL_SCALE_CENTS();
  const curve = MAX_FILL * (potCents / (potCents + scale));
  return Math.min(MAX_FILL, Math.max(FILL_FLOOR, curve));
}

/* ---------- ids ---------- */

const ID_ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
export function newBidId() {
  return `bg_${[...randomBytes(10)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`;
}
export const BID_ID_RE = /^bg_[a-z2-9]{10}$/;

/* ---------- seed data (Phase A only) ---------- */

const SEED_BIDS = [
  { id: 'bg_seedaaaaaa', sponsor_name: 'Placeholder Labs', sponsor_url: 'https://example.com', logo_url: null, amount_cents: 250000, placed_at: 1, status: 'active' },
  { id: 'bg_seedbbbbbb', sponsor_name: 'Vibe Ventures', sponsor_url: 'https://example.com', logo_url: null, amount_cents: 180000, placed_at: 2, status: 'active' },
  { id: 'bg_seedcccccc', sponsor_name: 'One-Shot Capital', sponsor_url: null, logo_url: null, amount_cents: 120000, placed_at: 3, status: 'active' },
  { id: 'bg_seeddddddd', sponsor_name: 'Weekend Builders Co', sponsor_url: null, logo_url: null, amount_cents: 75000, placed_at: 4, status: 'active' },
  { id: 'bg_seedeeeeee', sponsor_name: 'The House', sponsor_url: null, logo_url: null, amount_cents: 40000, placed_at: 5, status: 'active' },
];

/* ---------- ranking + pot (pure, reused by page and endpoints) ---------- */

// Active bids, ranked. amount desc, earliest placed wins ties.
export function rankBids(bids) {
  return bids
    .filter((b) => b.status === 'active')
    .sort((a, b) => b.amount_cents - a.amount_cents || a.placed_at - b.placed_at);
}

export const potFromBids = (bids) => rankBids(bids).reduce((sum, b) => sum + b.amount_cents, 0);

// Phase A stubs — Phase B replaces these two with DB reads.
export const seedBids = () => SEED_BIDS.map((b) => ({ ...b }));

/* ---------- display ---------- */

// Whole-dollar money, grouped. Cents dropped for the big hero figure.
export function usd(cents) {
  return '$' + Math.round(cents / 100).toLocaleString('en-US');
}

export function countdownParts(untilMs, now = Date.now()) {
  const s = Math.max(0, Math.floor((untilMs - now) / 1000));
  return {
    days: Math.floor(s / 86400),
    hours: Math.floor((s % 86400) / 3600),
    minutes: Math.floor((s % 3600) / 60),
    seconds: s % 60,
  };
}

// Monogram for a sponsor with no logo — first two initials, uppercased.
export function monogram(name) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}
