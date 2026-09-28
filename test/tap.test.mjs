/* The Attention Playbook house ad: the pure parts of lib/tap.js. The
   redirect and the counters are exercised against the running site; here
   the line copy, the redirect target and the per-window aggregation. Run:
   npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  TAP_FALLBACK_LINE,
  TAP_PLACEMENTS,
  _setSales,
  aggregateTapStats,
  isTapPlacement,
  tapHref,
  tapLine,
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
  assert.equal(tapLine({ sold: 197, price: 224, nextPrice: 249, remainingAtPrice: 3, launched: false }), '197 sold. 3 left at $224, then $249.');
  assert.equal(tapLine({ sold: 1200, price: 249, nextPrice: 299, remainingAtPrice: 40, launched: false }), '1,200 sold. 40 left at $249, then $299.');
  assert.equal(tapLine({ sold: 0, price: 224, nextPrice: 249, remainingAtPrice: 3, launched: false }), '3 left at $224, then $249.');
  assert.equal(tapLine({ sold: 250, price: 249, nextPrice: null, remainingAtPrice: 0, launched: false }), '250 sold. Pre-order, $249.');
  assert.equal(tapLine({ sold: 400, price: 299, nextPrice: null, remainingAtPrice: null, launched: true }), 'Now live, $299.');
  assert.equal(tapLine(null), TAP_FALLBACK_LINE);
  for (const s of [tapLine({ sold: 197, price: 224, nextPrice: 249, remainingAtPrice: 3 }), TAP_FALLBACK_LINE]) {
    assert.doesNotMatch(s, /[—–]/, 'no dashes in public copy');
    assert.match(s, /\.$/, 'ends with a period');
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
