/* The Build Games — sponsor bidding surface. OUTBID-style PUBLIC self-serve:
   anyone pays any amount, submits a link + tagline, the favicon is pulled and
   self-hosted, and they appear on the board at their cumulative rank. 100% of
   cleared money goes to the builders' prize pool.

   Data model (two tables, see db.js):
   - buildgames_sponsors : identity = canonical link (one row per link).
     tagline + icon are set by the FIRST cleared payment and are immutable via
     payments thereafter (admin can still correct) — kills the $5 defacement
     vector. status = active | held | removed (moderation).
   - buildgames_payments : append-only ledger. status = pending | cleared |
     reversed. Ranking = SUM(cleared, non-reversed) per sponsor; pot = SUM over
     ALL sponsors (removed-for-abuse money stays in the pool). A reversed
     chargeback drops out of both sums automatically.

   Payments are behind an interface (buildgames-payments.js): admin-entry is
   the launch impl; a processor webhook slots in later. Checkout stays dark
   until the entity/processor decision lands. */
import { randomBytes } from 'node:crypto';
import { canonicalUrl, registrableHost } from './challenge.js';

/* ---------- config ---------- */

const envTime = (name) => {
  const v = process.env[name];
  if (!v) return null;
  const n = /^\d+$/.test(v) ? Number(v) : Date.parse(v);
  return Number.isFinite(n) ? n : null;
};

// Countdown target: New York local midnight, Sept 1 (EDT = 04:00 UTC).
export const gamesStartAt = () => envTime('BUILDGAMES_START_AT') ?? Date.UTC(2026, 8, 1, 4, 0, 0);

// Public bidding accepts submissions only when this is on. Off = the board
// still renders (admin can seed) but the CTA reads "opening soon" and the
// submit endpoint 409s — the slip-protection state for launch morning.
export const biddingOpen = () => ['1', 'true'].includes(process.env.BUILDGAMES_BIDDING_OPEN ?? '');

// $5 floor, matching outbid: spam costs something, micro-disputes stay sane.
export const MIN_BID_CENTS = 500;
export const MAX_BID_CENTS = 1_500_000; // $15k ceiling per single payment

// Identity TTL: a sponsor row created by a submission whose payment NEVER
// clears must not squat the link + tagline forever (the one edge where
// first-submission is weaker than first-cleared). If no payment has cleared
// within this window, the unfunded identity is released so a real payer can
// take the link. Enforced lazily at submit-time AND by a sweep job.
export const IDENTITY_TTL_MS = (() => {
  const v = Number(process.env.BUILDGAMES_IDENTITY_TTL_MS);
  return Number.isFinite(v) && v > 0 ? v : 48 * 60 * 60 * 1000; // 48h default
})();

// A sponsor row is releasable when nothing has ever cleared for it
// (first_cleared_at null) and it is older than the TTL. Never release a
// 'removed' row — that identity is intentionally blocked.
export function isExpiredUnfunded(sponsor, now = Date.now()) {
  return (
    sponsor.status !== 'removed' &&
    sponsor.first_cleared_at == null &&
    now - sponsor.created_at > IDENTITY_TTL_MS
  );
}

/* ---------- uncapped asymptotic fill (never 100%) ---------- */

const FILL_SCALE_CENTS = () => envTime('BUILDGAMES_FILL_SCALE_CENTS') ?? 2_500_000; // $25k
const MAX_FILL = 0.9;
const FILL_FLOOR = 0.03;

export function fillLevel(potCents) {
  if (potCents <= 0) return 0;
  const scale = FILL_SCALE_CENTS();
  return Math.min(MAX_FILL, Math.max(FILL_FLOOR, MAX_FILL * (potCents / (potCents + scale))));
}

/* ---------- ids ---------- */

const ID_ALPHABET = 'abcdefghjkmnpqrstvwxyz23456789';
const mkId = (prefix) => `${prefix}_${[...randomBytes(10)].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')}`;
export const newSponsorId = () => mkId('bgs');
export const newPaymentId = () => mkId('bgp');
export const SPONSOR_ID_RE = /^bgs_[a-z2-9]{10}$/;
export const PAYMENT_ID_RE = /^bgp_[a-z2-9]{10}$/;

/* ---------- identity + input hygiene ---------- */

// The identity key for a sponsor: the canonical link (lowercased host, no
// fragment, sorted value-bearing query). Same-link submissions collapse to one
// cumulative identity.
export function sponsorIdentity(url) {
  return canonicalUrl(url);
}

export { registrableHost };

const UNSAFE_GLYPHS = /[​-‏‪-‮⁠-⁯﻿]/g;
const URL_ISH = /(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,}(\/|\b))/i;

/* Clean a public tagline: strip markup chars and bidi/zero-width glyphs,
   collapse whitespace, cap length. Returns null if it's empty or contains a
   URL (links belong in the entry link, which is screened; a URL in the
   tagline would be an unscreened link on a high-traffic page). */
export function cleanTagline(raw) {
  if (typeof raw !== 'string') return null;
  const t = raw
    .replace(/[<>]/g, '')
    .replace(UNSAFE_GLYPHS, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  if (t.length < 2) return null;
  if (URL_ISH.test(t)) return null;
  return t;
}

/* ---------- ranking (rows carry cleared_total + first_cleared_at from SQL) ---------- */

// Board order: cumulative cleared money desc, earliest first-cleared wins ties
// so a spot holds until someone's total is strictly higher.
export function rankSponsors(rows) {
  return [...rows].sort(
    (a, b) => b.cleared_total - a.cleared_total || (a.first_cleared_at ?? Infinity) - (b.first_cleared_at ?? Infinity)
  );
}

/* ---------- display ---------- */

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

export function monogram(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

// A display name for a sponsor with no chosen name: the registrable host.
export function displayName(sponsor) {
  if (sponsor.tagline) return sponsor.tagline;
  try {
    return new URL(sponsor.link).hostname.replace(/^www\./, '');
  } catch {
    return sponsor.link;
  }
}
