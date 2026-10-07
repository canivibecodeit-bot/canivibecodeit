/* The audience page (/audience): the last 30 days of this site's traffic,
   read from PostHog server-side and published for sponsors. Everything a
   sponsor sees here comes from the two queries below; nothing is typed in
   by hand except the one dated snapshot that stands in while the first
   read of the day is still running.

   Reading rules:
   - $pageview events on canivibecodeit.com, the scripted-browser pair
     excluded (SITE, shared with the public stats page).
   - The Build Games page is excluded for 1 to 3 October 2026: a reload
     loop inflated it on those days (see the Development Guidelines).
   - Session figures come from PostHog's sessions table, the same site
     filter on the entry URL and the same exclusion.
   - Results are cached for six hours. A refresh that fails keeps the last
     good figures, however old. A page render never waits more than
     WAIT_MS for PostHog: a cold cache gets the dated snapshot instead.
   - The personal API key is read by lib/analytics.js only and never
     leaves the server. */
import { SITE, hogql } from './analytics.js';

export const RANGE_DAYS = 30;
export const TTL_MS = 6 * 60 * 60 * 1000;
// The most a page render waits for a read on a cold cache: the page must
// answer well inside a second whatever PostHog is doing.
export const WAIT_MS = 300;

// Days on which the Build Games page carried a reload loop.
export const EXCLUDED = { path: '/thebuildgames', from: '2026-10-01', to: '2026-10-03' };

const eventsWhere = () =>
  `${SITE} AND event = '$pageview' AND timestamp >= now() - INTERVAL ${RANGE_DAYS} DAY ` +
  `AND NOT (properties.$pathname LIKE '${EXCLUDED.path}%' AND toDate(timestamp) BETWEEN '${EXCLUDED.from}' AND '${EXCLUDED.to}')`;

const sessionsWhere = () =>
  `$entry_current_url LIKE '%canivibecodeit.com%' AND $start_timestamp >= now() - INTERVAL ${RANGE_DAYS} DAY ` +
  `AND NOT ($entry_current_url LIKE '%${EXCLUDED.path}%' AND toDate($start_timestamp) BETWEEN '${EXCLUDED.from}' AND '${EXCLUDED.to}')`;

/* The six reads, in two batches of three: PostHog allows three concurrent
   queries per project. Pure, so the SQL can be checked by a test. */
export function audienceQueries() {
  const e = eventsWhere();
  const s = sessionsWhere();
  return {
    totals: `SELECT uniqExact(distinct_id) AS visitors, count() AS views FROM events WHERE ${e}`,
    byDay: `SELECT toDate(timestamp) AS d, uniqExact(distinct_id) AS visitors, count() AS views FROM events WHERE ${e} GROUP BY d ORDER BY d`,
    countries: `SELECT properties.$geoip_country_code AS c, uniqExact(distinct_id) AS visitors FROM events WHERE ${e} GROUP BY c ORDER BY visitors DESC LIMIT 10`,
    devices: `SELECT properties.$device_type AS t, uniqExact(distinct_id) AS visitors FROM events WHERE ${e} GROUP BY t ORDER BY visitors DESC`,
    sessions: `SELECT count() AS sessions, avg($session_duration) AS seconds, sum($pageview_count) / count() AS pages, countIf($pageview_count > 1) / count() AS beyond_one FROM sessions WHERE ${s}`,
    referrers: `SELECT $entry_referring_domain AS r, count() AS sessions FROM sessions WHERE ${s} GROUP BY r ORDER BY sessions DESC LIMIT 40`,
  };
}

/* Referring domains, grouped the way a sponsor reads them. Pure. */
const REFERRER_GROUPS = [
  ['Direct', (d) => d === '$direct' || d === ''],
  ['Google', (d) => /(^|\.)google\.[a-z.]+$/.test(d) || /googlequicksearchbox/.test(d)],
  ['X', (d) => d === 't.co' || /(^|\.)(twitter|x)\.com$/.test(d)],
  ['Other search', (d) => /(^|\.)(brave|duckduckgo|bing|yahoo|ecosia|yandex|startpage|qwant)\./.test(d)],
  ['Facebook', (d) => /(^|\.)facebook\.com$/.test(d)],
  ['Instagram', (d) => /(^|\.)instagram\.com$/.test(d)],
  ['LinkedIn', (d) => /(^|\.)linkedin\.com$/.test(d)],
  ['YouTube', (d) => /(^|\.)youtube\.com$/.test(d) || d === 'youtu.be'],
  ['GitHub', (d) => /(^|\.)github\.com$/.test(d)],
  ['Threads', (d) => /(^|\.)threads\.(com|net)$/.test(d)],
  ['Substack', (d) => /(^|\.)substack\.com$/.test(d)],
  ['Reddit', (d) => /(^|\.)reddit\.com$/.test(d)],
];

export function groupReferrers(rows, totalSessions, limit = 8) {
  const groups = new Map();
  let other = 0;
  for (const [domain, n] of rows) {
    const d = String(domain ?? '').toLowerCase();
    const count = Number(n) || 0;
    // Entries that start on the site itself are not a source of visitors.
    if (/(^|\.)canivibecodeit\.com$/.test(d)) continue;
    const hit = REFERRER_GROUPS.find(([, test]) => test(d));
    if (hit) groups.set(hit[0], (groups.get(hit[0]) ?? 0) + count);
    else other += count;
  }
  const listed = [...groups.entries()].sort((a, b) => b[1] - a[1]);
  const shown = listed.slice(0, limit);
  for (const [, n] of listed.slice(limit)) other += n;
  const out = shown.map(([name, sessions]) => ({ name, sessions, share: totalSessions ? sessions / totalSessions : 0 }));
  if (other > 0) out.push({ name: 'Other', sessions: other, share: totalSessions ? other / totalSessions : 0 });
  return out;
}

const median = (xs) => {
  const a = xs.slice().sort((x, y) => x - y);
  return a.length ? (a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2) : 0;
};

/* From the six result sets to the figures on the page. Pure. */
export function summarise({ totals, byDay, countries, devices, sessions, referrers }, now = Date.now()) {
  const [visitors, views] = totals[0] ?? [0, 0];
  const days = byDay.map(([d, v, pv]) => ({ day: d, visitors: Number(v) || 0, views: Number(pv) || 0 }));
  const perDay = days.map((x) => x.visitors);
  const [sessionCount, seconds, pages, beyondOne] = sessions[0] ?? [0, 0, 0, 0];
  const deviceTotal = devices.reduce((s, [, v]) => s + (Number(v) || 0), 0);
  const to = new Date(now).toISOString().slice(0, 10);
  const from = new Date(now - RANGE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  return {
    range: { from, to, days: RANGE_DAYS },
    visitors: Number(visitors) || 0,
    views: Number(views) || 0,
    perDay: { median: Math.round(median(perDay)), min: perDay.length ? Math.min(...perDay) : 0, max: perDay.length ? Math.max(...perDay) : 0, series: days },
    sessions: Number(sessionCount) || 0,
    pagesPerSession: Number(pages) || 0,
    sessionSeconds: Number(seconds) || 0,
    beyondOne: Number(beyondOne) || 0,
    countries: countries.map(([c, v]) => ({ code: c || '??', visitors: Number(v) || 0, share: visitors ? (Number(v) || 0) / visitors : 0 })),
    devices: devices.map(([t, v]) => ({ type: t || 'Unknown', visitors: Number(v) || 0, share: deviceTotal ? (Number(v) || 0) / deviceTotal : 0 })),
    referrers: groupReferrers(referrers, Number(sessionCount) || 0),
    asOf: new Date(now).toISOString(),
    live: true,
  };
}

/* What the page shows until the first read completes after a deploy, or if
   PostHog cannot be read at all: the figures as read on the date given,
   labelled as such. Update when the real figures drift. */
export const FALLBACK = {
  range: { from: '2026-09-07', to: '2026-10-07', days: 30 },
  visitors: 28227,
  views: 195038,
  perDay: { median: 1162, min: 516, max: 1960, series: [] },
  sessions: 43277,
  pagesPerSession: 4.61,
  sessionSeconds: 212,
  beyondOne: 0.493,
  countries: [['US', 5606], ['IN', 2221], ['GB', 1653], ['DE', 1203], ['TR', 1129], ['FR', 1092], ['BR', 1084], ['CA', 889], ['CN', 787], ['NL', 700]].map(([code, visitors]) => ({ code, visitors, share: visitors / 28227 })),
  devices: [['Desktop', 17213], ['Mobile', 10885], ['Tablet', 193]].map(([type, visitors]) => ({ type, visitors, share: visitors / 28291 })),
  referrers: groupReferrers([['$direct', 19702], ['www.google.com', 12977], ['t.co', 5159], ['search.brave.com', 624], ['duckduckgo.com', 457], ['www.bing.com', 367], ['www.youtube.com', 262], ['l.facebook.com', 253], ['github.com', 225]], 43277),
  asOf: '2026-10-07T00:00:00.000Z',
  live: false,
};

/* The cache. Built with its reads and clock injectable so the rules can be
   tested without PostHog: six-hour TTL, stale figures kept on failure,
   one refresh in flight at a time, a bounded wait on a cold cache. */
export const RETRY_MS = 5 * 60 * 1000;

export function createAudienceCache({ read, now = Date.now, ttlMs = TTL_MS, waitMs = WAIT_MS, retryMs = RETRY_MS } = {}) {
  let cache = { at: 0, data: null };
  // Cold means never filled. With figures in hand a refresh is due after the
  // TTL; without any (the first read failed) it is due again sooner, so an
  // outage at boot does not leave the snapshot up for six hours.
  const due = () => cache.at === 0 || now() - cache.at >= (cache.data ? ttlMs : retryMs);
  let inflight = null;
  const refresh = () => {
    if (!inflight) {
      inflight = read()
        .then((data) => {
          cache = { at: now(), data };
          return data;
        })
        .catch(() => {
          cache.at = now(); // keep what we have, try again after the TTL
          return cache.data;
        })
        .finally(() => {
          inflight = null;
        });
    }
    return inflight;
  };
  return {
    refresh,
    async get() {
      if (due()) refresh();
      if (cache.data) return cache.data;
      if (!inflight) return null;
      return Promise.race([inflight, new Promise((r) => setTimeout(r, waitMs, null))]);
    },
    peek: () => cache,
  };
}

async function readFromPostHog() {
  const q = audienceQueries();
  const [totals, byDay, countries] = await Promise.all([hogql(q.totals), hogql(q.byDay), hogql(q.countries)]);
  const [devices, sessions, referrers] = await Promise.all([hogql(q.devices), hogql(q.sessions), hogql(q.referrers)]);
  return summarise({ totals, byDay, countries, devices, sessions, referrers });
}

const configured = () => !!(process.env.POSTHOG_PROJECT_ID && process.env.POSTHOG_PERSONAL_KEY);
const live = createAudienceCache({ read: readFromPostHog });

/* Warm the cache at server boot (the middleware calls this as it loads), so
   the first visitor after a deploy gets live figures, not the snapshot.
   Best-effort: a failure here is retried by the first page render. */
export function warmAudience() {
  if (configured()) live.refresh().catch(() => {});
}
warmAudience();

export async function audienceStats() {
  if (!configured()) return FALLBACK;
  return (await live.get()) ?? FALLBACK;
}

/* ---------- formatting, plain English ---------- */

export function fmtDuration(seconds) {
  const s = Math.max(0, Math.round(Number(seconds) || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r} s`;
  return r ? `${m} min ${r} s` : `${m} min`;
}

export function fmtPct(share, digits = 0) {
  return `${(100 * (Number(share) || 0)).toFixed(digits)}%`;
}

const regionNames = new Intl.DisplayNames(['en-GB'], { type: 'region' });
export function countryName(code) {
  try {
    return /^[A-Z]{2}$/.test(code) ? regionNames.of(code) : 'Unknown';
  } catch {
    return code;
  }
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function fmtDay(iso) {
  const [y, m, d] = String(iso).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
