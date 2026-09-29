/* The Attention Playbook house ad: a plain ad block for the course, tracked
   through the How to AI rec layer (rec_clicks and rec_impressions keyed
   `tap:<placement>`) and never touching a sponsor slot.

   One counting redirect for every placement: GET /api/rec/tap?p=<placement>
   302s to the course site with utm_campaign = the placement, so clicks and
   impressions can be read per placement from /admin/tap-ad. Conversions are
   attributed on the course side by utm_source. */
import {
  rateLimit,
  recClick,
  recClickClass,
  recClickClassRows,
  recClickRows,
  recImpression,
  recImpressionRows,
} from './db.js';
import { BOT_RE } from './impressions.js';
import { clientIp } from './request.js';

export const TAP_URL = 'https://theattentionplaybook.com/';
export const TAP_SALES_URL = 'https://theattentionplaybook.com/api/sales';

/* Placements. `rail` is The Attention Playbook's house slot in the rails
   and the tapes, on every page that has them. `app`, `category` and `home`
   are the inline module on those pages, shown where the rails are not
   (small screens). A placement missing here 400s at the redirect and counts
   nothing, so a new one is added HERE in the same change that mounts it. */
export const TAP_PLACEMENTS = ['app', 'category', 'home', 'rail'];
const PLACEMENT_SET = new Set(TAP_PLACEMENTS);

// The price at launch. The feed names the next step only while there is
// one before launch; once the pre-order price is fixed, this is what follows.
export const TAP_LAUNCH_PRICE = 299;
// What the module says when the live counter cannot be read.
export const TAP_FALLBACK_LINE = 'Pre-order $249, $299 at launch.';
// The rail card's one-line form of the same.
export const TAP_FALLBACK_SHORT = 'Pre-order $249';

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

/* The line under the pitch, operator copy: "195 sold at $224, then $249".
   No dashes. */
export function tapLine(data) {
  if (!data) return TAP_FALLBACK_LINE;
  if (data.launched) return `Now live at ${usd(data.price)}`;
  const sold = data.sold != null && data.sold > 0 ? `${data.sold.toLocaleString('en-US')} sold at ` : 'Pre-order ';
  // The next step while there is one; after the last step, the launch price.
  const next =
    data.nextPrice != null && data.nextPrice > data.price
      ? `, then ${usd(data.nextPrice)}`
      : data.price < TAP_LAUNCH_PRICE
        ? `, ${usd(TAP_LAUNCH_PRICE)} at launch`
        : '';
  return `${sold}${usd(data.price)}${next}`;
}

// The rail card's line: the shortest form, one line at card width.
export function tapLineShort(data) {
  if (!data) return TAP_FALLBACK_SHORT;
  if (data.launched) return `Now live, ${usd(data.price)}`;
  if (data.sold != null && data.sold > 0) return `${data.sold.toLocaleString('en-US')} sold, ${usd(data.price)}`;
  return `Pre-order ${usd(data.price)}`;
}

/* ---------- counting ---------- */

/* One impression per SSR render of a page that carries the ad, the CTR
   denominator. With the house slot on, that is the slot's card, under
   `rail`, and the inline module does not count as well; with it off, the
   inline module counts under its own placement. Bots are skipped by user
   agent, same as sponsor impressions; best-effort and never awaited by a
   render. */
export function countTapImpression(placement, userAgent) {
  if (!isTapPlacement(placement)) return;
  if (!userAgent || BOT_RE.test(String(userAgent))) return;
  recImpression(srcKey(placement), dayKey()).catch(() => {});
}

/* What kind of request reached the redirect. Only `browser` is a click: a
   person navigating. The site's client router prefetches every same-origin
   link on hover and on keyboard focus, and the ad link IS same-origin, so
   before this check a pointer passing over the ad was booked as a click.
   The links now opt out of prefetching (data-astro-prefetch="false"); this
   is the second line, and it also covers other people's prefetchers, link
   previews, crawlers and HEAD probes.

   Coarse on purpose: the class is stored per (placement, day) and says what
   arrived, never who. No user agent string and no IP is kept anywhere. */
export const TAP_CLASSES = ['browser', 'prefetch', 'bot', 'headless', 'other'];

const PURPOSE_HEADERS = ['sec-purpose', 'purpose', 'x-purpose', 'x-moz'];
const PURPOSE_RE = /prefetch|prerender|preview/i;

export function classifyTapRequest(request) {
  if (String(request.method || 'GET').toUpperCase() !== 'GET') return 'other';
  const h = request.headers;
  if (PURPOSE_HEADERS.some((name) => PURPOSE_RE.test(h.get(name) || ''))) return 'prefetch';
  // A person following the link is a document navigation. Anything else a
  // browser labels (empty for fetch and <link rel=prefetch>, image, script)
  // is the page or an extension fetching in the background. Browsers too
  // old to send the header fall through to the user agent checks.
  const dest = (h.get('sec-fetch-dest') || '').toLowerCase();
  if (dest && dest !== 'document') return 'prefetch';
  const ua = h.get('user-agent') || '';
  if (!ua) return 'other';
  if (/headless/i.test(ua)) return 'headless';
  if (BOT_RE.test(ua)) return 'bot';
  return 'browser';
}

/* The redirect. Counting never blocks the navigation: whatever arrives is
   sent through, and only a person's navigation inside the per-IP limit
   counts. A browser past the limit is filed under `other`. */
export async function redirectToTap({ request, clientAddress, placement }) {
  if (!isTapPlacement(placement)) return new Response('unknown placement', { status: 400 });
  let cls = classifyTapRequest(request);
  try {
    if (cls === 'browser') {
      if (await rateLimit(`rec:${clientIp(request, clientAddress)}`, 20, 60 * 60 * 1000)) {
        await recClick(srcKey(placement), dayKey());
      } else {
        cls = 'other';
      }
    }
    await recClickClass(srcKey(placement), dayKey(), cls);
  } catch {
    /* count is best-effort */
  }
  return new Response(null, {
    status: 302,
    headers: {
      Location: tapHref(placement),
      'X-Robots-Tag': 'noindex, nofollow',
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

/* Requests to the redirect per window and class, all placements together.
   Pure, like aggregateTapStats. `browser` here can exceed the click count
   only by rows written before a failed click write; normally they match. */
export function aggregateTapClasses(classRows, now = Date.now()) {
  const out = Object.fromEntries(
    TAP_WINDOWS.map((w) => [w.key, Object.fromEntries([...TAP_CLASSES.map((c) => [c, 0]), ['total', 0]])])
  );
  for (const r of classRows) {
    if (!String(r.src).startsWith('tap:') || !isTapPlacement(String(r.src).slice(4))) continue;
    const cls = TAP_CLASSES.includes(r.cls) ? r.cls : 'other';
    for (const w of TAP_WINDOWS) {
      if (r.day < sinceDay(w.days, now)) continue;
      out[w.key][cls] += Number(r.count) || 0;
      out[w.key].total += Number(r.count) || 0;
    }
  }
  return out;
}

export async function tapClassStats(now = Date.now()) {
  return aggregateTapClasses(await recClickClassRows('0000-00-00'), now);
}
