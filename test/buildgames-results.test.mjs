/* The Build Games results: the published results resolve against the real
   shortlist file, one prize per builder, the categories are the game's
   three in the game's order, and the honourable mentions never include the
   winner of their own category. No database is touched. Run: npm test */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATEGORIES } from '../src/lib/buildgames.js';
import { SCORE_CATEGORIES, normaliseShortlist } from '../src/lib/buildgames-judging.js';
import { RESULTS, resultsView, usd, winnersAnnounced } from '../src/lib/buildgames-results.js';

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

test('the fund is three prizes', () => {
  assert.equal(RESULTS.fundCents, RESULTS.prizeCents * RESULTS.winners.length);
  assert.equal(usd(RESULTS.prizeCents), '$800');
  assert.equal(usd(RESULTS.fundCents), '$2,400');
});

test('the finalists list is alphabetical by product and flags the winners', () => {
  const view = resultsView(shortlist);
  const products = view.finalists.map((f) => f.product);
  const sorted = [...products].sort((a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' }));
  assert.deepEqual(products, sorted);
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
