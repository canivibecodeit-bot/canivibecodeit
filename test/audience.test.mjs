/* The audience page: the queries it sends, the grouping and formatting it
   applies, and the cache rules that keep a render from ever waiting on
   PostHog. Run: npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXCLUDED, FALLBACK, RANGE_DAYS, RETRY_MS, TTL_MS, audienceQueries, countryName, createAudienceCache, fmtDuration, fmtPct, groupReferrers, summarise } from '../src/lib/audience.js';

test('queries: pageviews on the site, the last 30 days, the Build Games days excluded', () => {
  const q = audienceQueries();
  assert.equal(RANGE_DAYS, 30);
  for (const key of ['totals', 'byDay', 'countries', 'devices']) {
    const sql = q[key];
    assert.match(sql, /properties\.\$host = 'canivibecodeit\.com'/, key);
    assert.match(sql, /event = '\$pageview'/, key);
    assert.match(sql, /timestamp >= now\(\) - INTERVAL 30 DAY/, key);
    assert.match(sql, /NOT \(properties\.\$pathname LIKE '\/thebuildgames%' AND toDate\(timestamp\) BETWEEN '2026-10-01' AND '2026-10-03'\)/, key);
    assert.match(sql, /NOT IN \(/, `${key} keeps the scripted-browser exclusion`);
  }
  for (const key of ['sessions', 'referrers']) {
    const sql = q[key];
    assert.match(sql, /FROM sessions/, key);
    assert.match(sql, /\$entry_current_url LIKE '%canivibecodeit\.com%'/, key);
    assert.match(sql, /\$start_timestamp >= now\(\) - INTERVAL 30 DAY/, key);
    assert.match(sql, /NOT \(\$entry_current_url LIKE '%\/thebuildgames%' AND toDate\(\$start_timestamp\) BETWEEN '2026-10-01' AND '2026-10-03'\)/, key);
  }
  assert.match(q.totals, /uniqExact\(distinct_id\)/);
  assert.match(q.sessions, /avg\(\$session_duration\)/);
  assert.match(q.sessions, /countIf\(\$pageview_count > 1\) \/ count\(\)/);
  assert.match(q.referrers, /\$entry_referring_domain/);
  assert.deepEqual(EXCLUDED, { path: '/thebuildgames', from: '2026-10-01', to: '2026-10-03' });
  // Nothing in the SQL could be a key.
  for (const sql of Object.values(q)) assert.doesNotMatch(sql, /phx_|Bearer/);
});

test('referrers: direct, Google, X, other search, named sites, the rest as other; internal entries dropped', () => {
  const rows = [['$direct', 500], ['www.google.com', 300], ['t.co', 120], ['canivibecodeit.com', 50], ['search.brave.com', 20], ['duckduckgo.com', 15], ['www.bing.com', 5], ['l.facebook.com', 12], ['facebook.com', 8], ['github.com', 9], ['com.google.android.googlequicksearchbox', 10], ['x.com', 4], ['someblog.example', 3], ['another.example', 2]];
  const out = groupReferrers(rows, 1000);
  const by = Object.fromEntries(out.map((r) => [r.name, r.sessions]));
  assert.equal(by.Direct, 500);
  assert.equal(by.Google, 310);
  assert.equal(by.X, 124);
  assert.equal(by['Other search'], 40);
  assert.equal(by.Facebook, 20);
  assert.equal(by.GitHub, 9);
  assert.equal(by.Other, 5);
  assert.equal(by['canivibecodeit.com'], undefined);
  assert.equal(out[0].name, 'Direct');
  assert.equal(out[0].share, 0.5);
  assert.equal(out[out.length - 1].name, 'Other');
  // At most `limit` named groups, then other.
  const many = groupReferrers([['$direct', 9], ['www.google.com', 8], ['t.co', 7], ['duckduckgo.com', 6], ['facebook.com', 5], ['instagram.com', 4], ['linkedin.com', 3], ['youtube.com', 2], ['github.com', 1], ['threads.net', 1]], 46, 3);
  assert.deepEqual(many.map((r) => r.name), ['Direct', 'Google', 'X', 'Other']);
  assert.equal(many[3].sessions, 22);
  assert.deepEqual(groupReferrers([], 0), []);
});

test('summarise: the figures a sponsor reads, from raw rows', () => {
  const now = Date.UTC(2026, 9, 7, 12);
  const s = summarise({
    totals: [[28227, 195038]],
    byDay: [['2026-10-05', 1000, 5000], ['2026-10-06', 1300, 6000], ['2026-10-07', 500, 2000]],
    countries: [['US', 5606], ['IN', 2221]],
    devices: [['Desktop', 17213], ['Mobile', 10885], ['Tablet', 193]],
    sessions: [[43277, 212.35, 4.6095, 0.4927]],
    referrers: [['$direct', 19702], ['www.google.com', 12977]],
  }, now);
  assert.equal(s.visitors, 28227);
  assert.equal(s.views, 195038);
  assert.deepEqual(s.range, { from: '2026-09-07', to: '2026-10-07', days: 30 });
  assert.equal(s.perDay.median, 1000);
  assert.equal(s.perDay.min, 500);
  assert.equal(s.perDay.max, 1300);
  assert.equal(s.perDay.series.length, 3);
  assert.equal(s.sessions, 43277);
  assert.equal(s.pagesPerSession, 4.6095);
  assert.equal(s.sessionSeconds, 212.35);
  assert.equal(s.beyondOne, 0.4927);
  assert.equal(s.countries[0].code, 'US');
  assert.ok(Math.abs(s.countries[0].share - 0.1986) < 0.001);
  assert.ok(Math.abs(s.devices[0].share - 0.6084) < 0.001);
  assert.equal(s.referrers[0].name, 'Direct');
  assert.equal(s.live, true);
  // Empty results do not throw and give zeros.
  const z = summarise({ totals: [], byDay: [], countries: [], devices: [], sessions: [], referrers: [] }, now);
  assert.equal(z.visitors, 0);
  assert.equal(z.perDay.median, 0);
  assert.deepEqual(z.referrers, []);
});

test('formatting, plain English', () => {
  assert.equal(fmtDuration(212.35), '3 min 32 s');
  assert.equal(fmtDuration(180), '3 min');
  assert.equal(fmtDuration(42), '42 s');
  assert.equal(fmtDuration(0), '0 s');
  assert.equal(fmtPct(0.4927), '49%');
  assert.equal(fmtPct(0.19861, 1), '19.9%');
  assert.equal(countryName('GB'), 'United Kingdom');
  assert.equal(countryName('??'), 'Unknown');
  assert.equal(FALLBACK.live, false);
  assert.equal(FALLBACK.visitors, 28227);
  assert.equal(TTL_MS, 6 * 60 * 60 * 1000);
  assert.equal(RETRY_MS, 5 * 60 * 1000);
});

test('cache: six hours, stale kept on failure, one refresh at a time, a cold cache never waits long', async () => {
  let now = 1_000_000;
  let reads = 0;
  let fail = false;
  let slow = null;
  const read = () => { reads += 1; if (fail) return Promise.reject(new Error('posthog down')); if (slow) return slow; return Promise.resolve({ n: reads }); };
  const c = createAudienceCache({ read, now: () => now, ttlMs: TTL_MS, waitMs: 50 });
  // Warm: the first read is awaited briefly and arrives in time.
  assert.deepEqual(await c.get(), { n: 1 });
  // Inside the TTL nothing is re-read.
  now += TTL_MS - 1;
  assert.deepEqual(await c.get(), { n: 1 });
  assert.equal(reads, 1);
  // Past the TTL: the stale figures are served at once and one refresh runs.
  now += 2;
  assert.deepEqual(await c.get(), { n: 1 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reads, 2);
  assert.deepEqual(await c.get(), { n: 2 });
  // A failed refresh keeps the last good figures and waits a TTL before trying again.
  now += TTL_MS + 1;
  fail = true;
  assert.deepEqual(await c.get(), { n: 2 });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(reads, 3);
  assert.deepEqual(await c.get(), { n: 2 });
  assert.equal(reads, 3, 'no retry inside the TTL');
  fail = false;
  // No figures at all and a failed read: tried again after the shorter retry, not the full TTL.
  fail = true;
  const empty = createAudienceCache({ read, now: () => now, ttlMs: TTL_MS, waitMs: 50, retryMs: 1000 });
  assert.equal(await empty.get(), null);
  const r0 = reads;
  now += 999;
  assert.equal(await empty.get(), null);
  assert.equal(reads, r0, 'not yet');
  now += 2;
  await empty.get();
  assert.equal(reads, r0 + 1, 'retried after the retry interval');
  fail = false;
  // A cold cache with a slow PostHog: the caller gets null within the wait, not a hang.
  let resolveSlow;
  slow = new Promise((r) => { resolveSlow = r; });
  const cold = createAudienceCache({ read, now: () => now, ttlMs: TTL_MS, waitMs: 50 });
  const t0 = Date.now();
  assert.equal(await cold.get(), null);
  assert.ok(Date.now() - t0 < 400, 'bounded wait');
  // Concurrent callers share the one in-flight read.
  const before = reads;
  await Promise.all([cold.get(), cold.get(), cold.get()]);
  assert.equal(reads, before);
  resolveSlow({ n: 'late' });
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await cold.get(), { n: 'late' });
});
