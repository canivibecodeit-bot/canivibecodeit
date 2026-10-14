/* The Build Games results: the published results resolve against the real
   shortlist file, one prize per builder, the categories are the game's
   three in the game's order, and the honourable mentions never include the
   winner of their own category. No database is touched. Run: npm test */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATEGORIES } from '../src/lib/buildgames.js';
import { SCORE_CATEGORIES, normaliseShortlist } from '../src/lib/buildgames-judging.js';
import { FUND_NOTE, RESULTS, resultsView, usd, winnersAnnounced } from '../src/lib/buildgames-results.js';

const shortlist = normaliseShortlist(
  JSON.parse(readFileSync(new URL('../src/data/buildgames-shortlist.json', import.meta.url), 'utf8'))
);

test('the results are announced and resolve against the shortlist file', () => {
  assert.equal(winnersAnnounced(), true);
  const view = resultsView(shortlist);
  assert.equal(view.winners.length, 3);
  assert.equal(view.finalists.length, shortlist.length);
  for (const w of view.winners) {
    assert.equal(w.entry.product, w.product, `${w.category}: the product name matches the entry`);
    assert.ok(w.entry.demoUrl.startsWith('https://'), `${w.category}: a demo link`);
    assert.equal(w.mentions.length, 3, `${w.category}: three honourable mentions`);
  }
});

test('the categories are the game page’s three, in its order, under the judging tool’s keys', () => {
  assert.deepEqual(
    RESULTS.winners.map((w) => w.category),
    CATEGORIES.map((c) => c.name)
  );
  assert.deepEqual(
    RESULTS.winners.map((w) => w.key),
    SCORE_CATEGORIES.map((c) => c.key)
  );
});

test('one prize per builder: three different entries win, nothing wins twice', () => {
  const entries = RESULTS.winners.map((w) => w.entry);
  assert.equal(new Set(entries).size, 3);
  const view = resultsView(shortlist);
  const handles = view.winners.map((w) => w.entry.handle.toLowerCase());
  assert.equal(new Set(handles).size, 3, 'three different builders');
});

test('honourable mentions never include the category’s own winner, and never repeat', () => {
  for (const w of RESULTS.winners) {
    assert.ok(!w.mentions.includes(w.entry), `${w.category}: the winner is not also a mention`);
    assert.equal(new Set(w.mentions).size, w.mentions.length, `${w.category}: no repeated mention`);
  }
});

test('the fund note names the pool, the fund and the prize, in house style', () => {
  assert.match(FUND_NOTE, /\$2,750/);
  assert.match(FUND_NOTE, /\$800/);
  assert.ok(!/[\u2014\u2013]/.test(FUND_NOTE), 'no dashes');
  assert.ok(!/admin fee/i.test(FUND_NOTE));
});

test('the fund is three prizes', () => {
  assert.equal(RESULTS.fundCents, RESULTS.prizeCents * RESULTS.winners.length);
  assert.equal(usd(RESULTS.prizeCents), '$800');
  assert.equal(usd(RESULTS.fundCents), '$2,400');
});

test('every finalist has a whole-number total out of 90, listed highest first, and the winners are flagged', () => {
  const view = resultsView(shortlist);
  assert.equal(RESULTS.totals.length, shortlist.length, 'one total per finalist');
  assert.equal(new Set(RESULTS.totals.map(([k]) => k)).size, shortlist.length, 'no key twice');
  for (const f of view.finalists) {
    assert.ok(Number.isInteger(f.total) && f.total >= 0 && f.total <= RESULTS.totalMax, `${f.product}: ${f.total}`);
  }
  const totals = view.finalists.map((f) => f.total);
  assert.deepEqual(totals, [...totals].sort((a, b) => b - a), 'highest first');
  assert.deepEqual(view.finalists.slice(0, 3).map((f) => f.product), ['InMotion', 'openheard', 'Excerpt'], 'ties keep the published order');
  const flagged = view.finalists.filter((f) => f.won).map((f) => f.won.category).sort();
  assert.deepEqual(flagged, [...CATEGORIES.map((c) => c.name)].sort());
});

test('display-name overrides apply to the winners and nowhere else', () => {
  const view = resultsView(shortlist);
  for (const [key, name] of Object.entries(RESULTS.names)) {
    const f = view.finalists.find((x) => x.key === key);
    assert.equal(f.name, name);
  }
  assert.equal(view.finalists.find((f) => f.key === 'bge_b9ysh6kzac').name, 'ibo');
});

test('an unknown entry key fails loudly', () => {
  assert.throws(() => resultsView(shortlist.filter((e) => e.key !== RESULTS.winners[0].entry)), /unknown entry/);
  assert.throws(() => resultsView([]), /no shortlist/);
});
