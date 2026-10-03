/* The Build Games clock: which phase the page is in, and the rule that a
   page can reload itself at most once, when its countdown crosses zero in
   an open tab. The client scripts are run as they ship, against a stub
   page and a clock the test controls. Run: npm test */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';
import { entriesOpen, gameClock, gamesEndAt, gamesEnded, gamesStartAt, gamesStarted } from '../src/lib/buildgames.js';

test('phases: before the start, inside the window, after the close', () => {
  const start = gamesStartAt();
  const end = gamesEndAt();
  assert.ok(end > start);
  assert.deepEqual(gameClock(start - 1), { phase: 'pregame', target: start });
  assert.deepEqual(gameClock(start), { phase: 'running', target: end });
  assert.deepEqual(gameClock(end - 1), { phase: 'running', target: end });
  // At the close and ever after: no target at all, so nothing can count to it.
  assert.deepEqual(gameClock(end), { phase: 'ended', target: null });
  assert.deepEqual(gameClock(end + 3 * 24 * 60 * 60 * 1000), { phase: 'ended', target: null });
});

test('the clock never offers a target that has already passed', () => {
  const start = gamesStartAt();
  const end = gamesEndAt();
  for (const now of [start - 5000, start - 1, start, start + 1, end - 1, end, end + 1, end + 1e9]) {
    const c = gameClock(now);
    assert.ok(c.target === null || c.target > now, `at ${now - end} ms from the close: ${JSON.stringify(c)}`);
  }
});

test('ended agrees with entries being locked', () => {
  const end = gamesEndAt();
  for (const now of [gamesStartAt(), end - 1, end, end + 1]) {
    assert.equal(gamesEnded(now), gamesStarted(now) && !entriesOpen(now));
    assert.equal(gameClock(now).phase === 'ended', gamesEnded(now));
  }
});

/* A stub page: one countdown element, a clock the test moves, and timers
   the test fires by hand. Counts calls to location.reload(). */
function page(file, { target, attrs = {} }) {
  let now = 1_800_000_000_000;
  const timeouts = [];
  const intervals = [];
  let reloads = 0;
  const cell = () => ({ textContent: '', hidden: false, dataset: {} });
  const cells = { '[data-cd-days]': cell(), '[data-cd-hours]': cell(), '[data-cd-mins]': cell(), '[data-cd-secs]': cell(), '[data-cd-sec-cell]': cell() };
  const cd = { dataset: { target: target(now), ...attrs }, querySelector: (s) => cells[s] ?? null, querySelectorAll: () => [] };
  const document = {
    querySelector: (s) => (s === '[data-countdown]' ? cd : null),
    querySelectorAll: () => [],
    getElementById: () => null,
    addEventListener() {},
    body: { dataset: {} },
    documentElement: { classList: { contains: () => false } },
  };
  const sandbox = {
    document,
    location: { search: '', pathname: '/thebuildgames', hash: '', reload: () => { reloads += 1; } },
    history: { replaceState() {} },
    navigator: { sendBeacon: () => true },
    matchMedia: () => ({ matches: false }),
    URLSearchParams,
    Date: { now: () => now },
    Math, Number, String, JSON, console,
    setTimeout: (fn, ms) => { timeouts.push({ fn, at: now + ms }); return timeouts.length; },
    clearTimeout() {},
    setInterval: (fn, ms) => { intervals.push({ fn, ms, next: now + ms }); return intervals.length; },
    clearInterval() {},
    fetch: () => new Promise(() => {}),
  };
  sandbox.window = sandbox;
  vm.runInNewContext(readFileSync(new URL(`../public/js/${file}`, import.meta.url), 'utf8'), sandbox);
  const advance = (ms) => {
    const until = now + ms;
    while (now < until) {
      now += 100;
      for (const i of intervals) while (i.next <= now) { i.next += i.ms; i.fn(); }
      for (const t of timeouts.splice(0)) (t.at <= now ? t.fn() : timeouts.push(t));
    }
  };
  return { advance, reloads: () => reloads, pendingTimeouts: () => timeouts.length, cells, cd };
}

for (const [file, attrs] of [['buildgames.js', {}], ['challenge.js', { state: 'open' }]]) {
  test(`${file}: a page that loads past its target never reloads`, () => {
    for (const behind of [1, 1500, 60_000, 2 * 24 * 60 * 60 * 1000]) {
      const p = page(file, { target: (now) => String(now - behind), attrs });
      p.advance(30_000);
      assert.equal(p.reloads(), 0, `target ${behind} ms in the past: reloads in 30 s`);
      assert.equal(p.cells['[data-cd-secs]'].textContent.toString().replace(/^0+(?=\d)/, ''), '0');
    }
  });

  test(`${file}: crossing zero in an open tab reloads once, and only once`, () => {
    const p = page(file, { target: (now) => String(now + 3000), attrs });
    p.advance(2500);
    assert.equal(p.reloads(), 0, 'not before zero');
    p.advance(3000);
    assert.equal(p.reloads(), 1, 'once, 1.5 s after zero');
    p.advance(60_000);
    assert.equal(p.reloads(), 1, 'never again in the same page');
  });

  test(`${file}: a target that is not a number never reloads`, () => {
    for (const bad of ['', 'undefined', 'NaN', 'soon']) {
      const p = page(file, { target: () => bad, attrs });
      p.advance(10_000);
      assert.equal(p.reloads(), 0, JSON.stringify(bad));
    }
  });
}

test('the loop that happened: before the fix this page reloaded every 1.5 s, now it stays', () => {
  // What production served from Oct 1: a countdown aimed at the window close, already past.
  const p = page('buildgames.js', { target: (now) => String(now - 2 * 24 * 60 * 60 * 1000) });
  p.advance(30_000);
  assert.equal(p.reloads(), 0);
  assert.equal(p.pendingTimeouts(), 0, 'no reload is even scheduled');
});
