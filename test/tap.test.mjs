/* The Attention Playbook house ad: the pure parts of lib/tap.js. The
   redirect and the counters are exercised against the running site; here
   the line copy, the redirect target and the per-window aggregation. Run:
   npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TAP_FALLBACK_LINE,
  TAP_FALLBACK_SHORT,
  TAP_PLACEMENTS,
  _setSales,
  aggregateTapClasses,
  aggregateTapStats,
  classifyTapRequest,
  isTapPlacement,
  tapHref,
  tapLine,
  tapLineShort,
  tapRailCss,
  tapRailFit,
  tapSales,
} from '../src/lib/tap.js';

test('placements are closed: only the three mounted keys count', () => {
  assert.deepEqual(TAP_PLACEMENTS, ['app', 'category', 'home']);
  assert.equal(isTapPlacement('app'), true);
  assert.equal(isTapPlacement('showcase'), false);
  assert.equal(isTapPlacement(''), false);
});

test('redirect target carries the house-ad utm set with the placement as campaign', () => {
  const u = new URL(tapHref('category'));
  assert.equal(u.origin + u.pathname, 'https://theattentionplaybook.com/');
  assert.equal(u.searchParams.get('utm_source'), 'canivibecodeit');
  assert.equal(u.searchParams.get('utm_medium'), 'house-ad');
  assert.equal(u.searchParams.get('utm_campaign'), 'category');
});

test('line copy: live counter, launched, capped and fallback', () => {
  assert.equal(tapLine({ sold: 195, price: 224, nextPrice: 249, remainingAtPrice: 5, launched: false }), '195 sold at $224, then $249');
  assert.equal(tapLine({ sold: 1200, price: 249, nextPrice: 299, remainingAtPrice: 40, launched: false }), '1,200 sold at $249, then $299');
  assert.equal(tapLine({ sold: 0, price: 224, nextPrice: 249, remainingAtPrice: 3, launched: false }), 'Pre-order $224, then $249');
  assert.equal(tapLine({ sold: 250, price: 249, nextPrice: null, remainingAtPrice: 0, launched: false }), '250 sold at $249');
  assert.equal(tapLine({ sold: 400, price: 299, nextPrice: null, remainingAtPrice: null, launched: true }), 'Now live at $299');
  assert.equal(tapLine(null), TAP_FALLBACK_LINE);
  assert.equal(TAP_FALLBACK_LINE, 'Pre-order $224, $299 at launch.');
  for (const line of [tapLine({ sold: 195, price: 224, nextPrice: 249, remainingAtPrice: 5 }), TAP_FALLBACK_LINE]) {
    assert.doesNotMatch(line, /[\u2014\u2013]/, 'no dashes in public copy');
  }
});

test('a seeded snapshot is served from cache without a network read', async () => {
  _setSales({ sold: 10, price: 224, nextPrice: 249, remainingAtPrice: 190, launched: false });
  assert.equal((await tapSales()).sold, 10);
  _setSales(null);
});

test('aggregation: windows are inclusive UTC days per placement plus a total', () => {
  const now = Date.UTC(2026, 8, 28, 12); // 2026-09-28 midday UTC
  const imp = [
    { src: 'tap:app', day: '2026-09-28', count: 100 },
    { src: 'tap:app', day: '2026-09-22', count: 50 }, // inside 7 days (22..28)
    { src: 'tap:app', day: '2026-09-21', count: 7 }, // outside 7, inside 30
    { src: 'tap:home', day: '2026-08-01', count: 1000 }, // all time only
    { src: 'apppage', day: '2026-09-28', count: 999 }, // How to AI rows are ignored
    { src: 'tap:unknown', day: '2026-09-28', count: 5 }, // unmounted key ignored
  ];
  const clk = [
    { src: 'tap:app', day: '2026-09-28', count: 4 },
    { src: 'tap:home', day: '2026-08-01', count: 10 },
  ];
  const s = aggregateTapStats(imp, clk, now);
  assert.deepEqual(s.app.today, { impressions: 100, clicks: 4, ctr: 4 });
  assert.equal(s.app.d7.impressions, 150);
  assert.equal(s.app.d30.impressions, 157);
  assert.equal(s.app.all.impressions, 157);
  assert.deepEqual(s.home.today, { impressions: 0, clicks: 0, ctr: 0 });
  assert.deepEqual(s.home.all, { impressions: 1000, clicks: 10, ctr: 1 });
  assert.equal(s.category.all.impressions, 0);
  assert.equal(s.total.all.impressions, 1157);
  assert.equal(s.total.all.clicks, 14);
  assert.equal(s.total.today.ctr, 4);
});

test('short line for the rail card: one line, shortest form', () => {
  assert.equal(tapLineShort({ sold: 198, price: 224, nextPrice: 249, remainingAtPrice: 2, launched: false }), '198 sold, $224');
  assert.equal(tapLineShort({ sold: 1200, price: 249, nextPrice: 299, remainingAtPrice: 40, launched: false }), '1,200 sold, $249');
  assert.equal(tapLineShort({ sold: 0, price: 224, nextPrice: 249, remainingAtPrice: 3, launched: false }), 'Pre-order $224');
  assert.equal(tapLineShort({ sold: 400, price: 299, nextPrice: null, remainingAtPrice: null, launched: true }), 'Now live, $299');
  assert.equal(tapLineShort(null), TAP_FALLBACK_SHORT);
  assert.equal(TAP_FALLBACK_SHORT, 'Pre-order $224');
  // Fits one line of the narrowest card: about 25 characters at this size.
  for (const d of [{ sold: 198, price: 224 }, { sold: 12000, price: 299 }, null]) assert.ok(tapLineShort(d).length <= 24);
});

test('rail fit: the card shows only where every sponsor card keeps full height', () => {
  // Production shape: three slot cards in the right rail.
  const fit = tapRailFit({ cards: 3 });
  assert.equal(fit.top, 3 * 176 + 2 * 10 + 10);
  assert.equal(fit.tiers.length, 1);
  const [t] = fit.tiers;
  assert.equal(t.minWidth, 1280);
  assert.equal(t.reserve, 176);
  // At the threshold the rail (viewport minus 90px of chrome) holds the
  // sponsor cards at 176px, the gap and this card exactly.
  assert.equal(t.minHeight, 90 + 558 + 176);
  const shows = (w, h) => fit.tiers.some((x) => w >= x.minWidth && h >= x.minHeight);
  for (const [w, h] of [[1920, 1080], [1536, 864], [1440, 900]]) assert.equal(shows(w, h), true, `${w}x${h} rail`);
  for (const [w, h] of [[1440, 800], [1366, 768], [1280, 720], [1279, 1000]]) assert.equal(shows(w, h), false, `${w}x${h} inline`);
});

test('rail fit: more cards need more height, the sold-out notice counts at 128px', () => {
  assert.equal(tapRailFit({ cards: 0 }).top, 0);
  assert.equal(tapRailFit({ cards: 1 }).top, 176 + 10);
  assert.equal(tapRailFit({ cards: 5, soldOut: true }).top, 5 * 176 + 128 + 5 * 10 + 10);
  assert.equal(tapRailFit({ cards: 4 }).tiers[0].minHeight - tapRailFit({ cards: 3 }).tiers[0].minHeight, 186);
});

test('rail css: rail shown and inline hidden by the same rule', () => {
  const css = tapRailCss(tapRailFit({ cards: 3 }));
  assert.equal(
    css,
    'aside.sp-rail .tap-ad-rail{top:558px}@media (min-width:1280px) and (min-height:824px){aside.sp-rail .tap-ad-rail{display:block;max-height:176px}aside.tap-ad-hide-rail{display:none}}'
  );
});

const UA_CHROME = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const req = (headers = {}, method = 'GET') => ({ method, headers: new Headers(headers) });

test('classify: only a person navigating is a browser click', () => {
  // A real click on a target=_blank link.
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-fetch-dest': 'document', 'sec-fetch-mode': 'navigate' })), 'browser');
  // An older browser that sends no fetch metadata still counts.
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME })), 'browser');
});

test('classify: prefetches never count, whoever sends them', () => {
  // <link rel=prefetch> from the client router on hover (Chromium).
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-purpose': 'prefetch', 'sec-fetch-dest': 'empty' })), 'prefetch');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-purpose': 'prefetch;prerender' })), 'prefetch');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, purpose: 'prefetch' })), 'prefetch');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'x-moz': 'prefetch' })), 'prefetch');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'x-purpose': 'preview' })), 'prefetch');
  // The fetch() fallback where rel=prefetch is unsupported (Safari): no
  // purpose header, but the destination is not a document.
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-fetch-dest': 'empty', 'sec-fetch-mode': 'cors' })), 'prefetch');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-fetch-dest': 'image' })), 'prefetch');
  // A prefetch that claims to be a document is still a prefetch.
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-purpose': 'prefetch', 'sec-fetch-dest': 'document' })), 'prefetch');
});

test('classify: crawlers, headless browsers, HEAD and missing agents', () => {
  assert.equal(classifyTapRequest(req({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' })), 'bot');
  assert.equal(classifyTapRequest(req({ 'user-agent': 'facebookexternalhit/1.1' })), 'bot');
  assert.equal(classifyTapRequest(req({ 'user-agent': 'curl/8.5.0' })), 'bot');
  assert.equal(classifyTapRequest(req({ 'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36' })), 'headless');
  assert.equal(classifyTapRequest(req({})), 'other');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME, 'sec-fetch-dest': 'document' }, 'HEAD')), 'other');
  assert.equal(classifyTapRequest(req({ 'user-agent': UA_CHROME }, 'POST')), 'other');
});

test('class aggregation: per window across placements, other rec rows ignored', () => {
  const now = Date.UTC(2026, 8, 29, 12);
  const rows = [
    { src: 'tap:app', day: '2026-09-29', cls: 'browser', count: 3 },
    { src: 'tap:app', day: '2026-09-29', cls: 'prefetch', count: 30 },
    { src: 'tap:home', day: '2026-09-29', cls: 'bot', count: 2 },
    { src: 'tap:home', day: '2026-09-20', cls: 'headless', count: 1 }, // 30 days only
    { src: 'tap:home', day: '2026-09-29', cls: 'mystery', count: 4 }, // unknown class files under other
    { src: 'apppage', day: '2026-09-29', cls: 'browser', count: 99 }, // How to AI rows are ignored
    { src: 'tap:nowhere', day: '2026-09-29', cls: 'browser', count: 9 }, // unmounted key ignored
  ];
  const c = aggregateTapClasses(rows, now);
  assert.deepEqual(c.today, { browser: 3, prefetch: 30, bot: 2, headless: 0, other: 4, total: 39 });
  assert.equal(c.d7.headless, 0);
  assert.equal(c.d30.headless, 1);
  assert.equal(c.all.total, 40);
  assert.deepEqual(aggregateTapClasses([], now).today, { browser: 0, prefetch: 0, bot: 0, headless: 0, other: 0, total: 0 });
});
