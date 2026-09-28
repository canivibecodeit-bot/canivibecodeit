/* The Attention Playbook house ad: the site owner's own course, promoted in
   a tracked module that reuses the How to AI rec layer (rec_clicks and
   rec_impressions keyed `tap:<placement>`) and never touches a sponsor slot.

   One counting redirect for every placement: GET /api/rec/tap?p=<placement>
   302s to the course site with utm_campaign = the placement, so clicks and
   impressions can be read per placement from /admin/tap-ad. Conversions are
   attributed on the course side by utm_source. */
import { rateLimit, recClick, recClickRows, recImpression, recImpressionRows } from './db.js';
import { BOT_RE } from './impressions.js';
import { clientIp } from './request.js';

export const TAP_URL = 'https://theattentionplaybook.com/';
export const TAP_SALES_URL = 'https://theattentionplaybook.com/api/sales';

// A placement missing here 400s at the redirect and counts nothing, so a new
// module is added HERE in the same change that mounts it.
export const TAP_PLACEMENTS = ['app', 'category', 'home'];
const PLACEMENT_SET = new Set(TAP_PLACEMENTS);

// What the module says when the live counter cannot be read.
export const TAP_FALLBACK_LINE = 'Pre-order, $224. $299 at launch.';

const srcKey = (placement) => `tap:${placement}`;
const dayKey = (d = new Date()) => d.toISOString().slice(0, 10);

export function isTapPlacement(p) {
  return PLACEMENT_SET.has(p);
}

export function tapHref(placement) {
  const params = new URLSearchParams({
    utm_source: 'canivibecodeit',
    utm_medium: 'house-ad',
    utm_campaign: placement,
  });
  return `${TAP_URL}?${params.toString()}`;
}

/* ---------- live sales line ---------- */

const SALES_TTL_MS = 5 * 60 * 1000;
// A failed read is retried sooner than a good one is refreshed, without
// hammering a site that is down.
const SALES_RETRY_MS = 60 * 1000;
const SALES_TIMEOUT_MS = 2500;

let sales = { data: null, at: 0, until: 0, inflight: null };

function parseSales(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  const price = num(raw.price);
  if (price == null) return null;
  return {
    sold: num(raw.sold),
    price,
    nextPrice: num(raw.nextPrice),
    remainingAtPrice: num(raw.remainingAtPrice),
    launched: raw.launched === true,
  };
}

async function fetchSales() {
  const res = await fetch(TAP_SALES_URL, {
    signal: AbortSignal.timeout(SALES_TIMEOUT_MS),
    headers: { accept: 'application/json', 'user-agent': 'canivibecodeit house-ad' },
  });
  if (!res.ok) throw new Error(`sales feed answered ${res.status}`);
  return parseSales(await res.json());
}

function refreshSales() {
  if (sales.inflight) return sales.inflight;
  sales.inflight = fetchSales()
    .then((data) => {
      const now = Date.now();
      if (data) sales = { data, at: now, until: now + SALES_TTL_MS, inflight: null };
      else sales = { ...sales, until: now + SALES_RETRY_MS, inflight: null };
      return sales.data;
    })
    .catch((err) => {
      console.error(`tap sales feed unavailable: ${err?.message || err}`);
      sales = { ...sales, until: Date.now() + SALES_RETRY_MS, inflight: null };
      return sales.data;
    });
  return sales.inflight;
}

/* Cached for five minutes. A render past the TTL that already holds a
   snapshot serves it and refreshes in the background, so the page never
   waits on the course site; only a cold process waits, and at most
   SALES_TIMEOUT_MS. Returns null when nothing has ever been read. */
export async function tapSales() {
  const now = Date.now();
  if (sales.until > now) return sales.data;
  if (sales.data) {
    void refreshSales();
    return sales.data;
  }
  return refreshSales();
}

// Cache age for the admin page; null when nothing has been read yet.
export function tapSalesAge() {
  return sales.at ? Date.now() - sales.at : null;
}

// For tests: seed or clear the snapshot without a network read.
export function _setSales(data, ttlMs = SALES_TTL_MS) {
  const now = Date.now();
  sales = data ? { data, at: now, until: now + ttlMs, inflight: null } : { data: null, at: 0, until: 0, inflight: null };
}

const usd = (n) => `$${Number(n).toLocaleString('en-US')}`;

/* The line under the pitch. Sentences, house style: no dashes, every one
   ends with a period. */
export function tapLine(data) {
  if (!data) return TAP_FALLBACK_LINE;
  if (data.launched) return `Now live, ${usd(data.price)}.`;
  const sold = data.sold != null && data.sold > 0 ? `${data.sold.toLocaleString('en-US')} sold. ` : '';
  const step =
    data.remainingAtPrice != null && data.remainingAtPrice > 0 && data.nextPrice != null
      ? `${data.remainingAtPrice} left at ${usd(data.price)}, then ${usd(data.nextPrice)}.`
      : `Pre-order, ${usd(data.price)}.`;
  return `${sold}${step}`;
}

/* ---------- counting ---------- */

/* One impression per SSR render of a module, the CTR denominator. Bots are
   skipped by user agent, same as sponsor impressions; best-effort and never
   awaited by a render. */
export function countTapImpression(placement, userAgent) {
  if (!isTapPlacement(placement)) return;
  if (!userAgent || BOT_RE.test(String(userAgent))) return;
  recImpression(srcKey(placement), dayKey()).catch(() => {});
}

/* The redirect. Counting never blocks the navigation: a bot, or a visitor
   past the per-IP limit, is still sent through, it just does not count. */
export async function redirectToTap({ request, clientAddress, placement }) {
  if (!isTapPlacement(placement)) return new Response('unknown placement', { status: 400 });
  const ua = request.headers.get('user-agent') || '';
  try {
    if (ua && !BOT_RE.test(ua) && (await rateLimit(`rec:${clientIp(request, clientAddress)}`, 20, 60 * 60 * 1000))) {
      await recClick(srcKey(placement), dayKey());
    }
  } catch {
    /* count is best-effort */
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: tapHref(placement),
      'X-Robots-Tag': 'noindex',
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
    },
  });
}

/* ---------- reporting ---------- */

export const TAP_WINDOWS = [
  { key: 'today', label: 'today', days: 1 },
  { key: 'd7', label: '7 days', days: 7 },
  { key: 'd30', label: '30 days', days: 30 },
  { key: 'all', label: 'all time', days: null },
];

const sinceDay = (days, now) =>
  days == null ? '0000-00-00' : dayKey(new Date(now - (days - 1) * 24 * 60 * 60 * 1000));

/* Pure aggregation over (src, day, count) rows so it is testable without a
   database: per placement and per window, impressions, clicks and CTR. Days
   are UTC keys; "today" is the current UTC day. */
export function aggregateTapStats(impressionRows, clickRows, now = Date.now()) {
  const cutoffs = TAP_WINDOWS.map((w) => [w.key, sinceDay(w.days, now)]);
  const blank = () => Object.fromEntries(cutoffs.map(([k]) => [k, { impressions: 0, clicks: 0, ctr: 0 }]));
  const out = Object.fromEntries(TAP_PLACEMENTS.map((p) => [p, blank()]));
  out.total = blank();
  const add = (rows, field) => {
    for (const r of rows) {
      if (!String(r.src).startsWith('tap:')) continue;
      const placement = String(r.src).slice(4);
      if (!out[placement]) continue;
      for (const [key, since] of cutoffs) {
        if (r.day < since) continue;
        out[placement][key][field] += Number(r.count) || 0;
        out.total[key][field] += Number(r.count) || 0;
      }
    }
  };
  add(impressionRows, 'impressions');
  add(clickRows, 'clicks');
  for (const p of Object.keys(out)) {
    for (const [key] of cutoffs) {
      const w = out[p][key];
      w.ctr = w.impressions > 0 ? Number(((w.clicks / w.impressions) * 100).toFixed(2)) : 0;
    }
  }
  return out;
}

export async function tapStats(now = Date.now()) {
  const [impressions, clicks] = await Promise.all([recImpressionRows('0000-00-00'), recClickRows('0000-00-00')]);
  return aggregateTapStats(impressions, clicks, now);
}
