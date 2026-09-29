/* Flood guard: the rules that decide which pages may be kept, when a copy
   may be served and when an address is told to slow down. The guard itself
   is exercised with a stand-in render; the flood is reproduced against the
   running site. Run: npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { _reset, copyKey, floodConfig, guardPage, isHotPage, isPageRequest, noteRequest, overLimit, underPressure } from '../src/lib/flood-guard.js';

const apps = (slug) => ['notion', 'granola', '1password'].includes(slug);
const cfg = floodConfig();

test('hot pages are the public directory pages and nothing else', () => {
  for (const p of ['/', '/categories', '/alternatives', '/category/meeting-notes', '/alternative/appflowy', '/notion', '/notion/alternatives', '/1password']) {
    assert.equal(isHotPage(p, apps), true, p);
  }
  for (const p of ['/admin/sponsors', '/admin/tap-ad', '/sponsor', '/sponsor/stats', '/sponsor/details', '/account', '/signin', '/submit', '/post-a-build',
    '/stats', '/newsletter', '/moats/abc', '/thebuildgames', '/thebuildgames/entry', '/studies/p/token/slug', '/api/rec/tap', '/not-an-app', '/not-an-app/alternatives',
    '/category/', '/category/a/b', '/NOTION', '/notion/', '', null, undefined]) {
    assert.equal(isHotPage(p, apps), false, String(p));
  }
});

test('a copy is never kept or served for anything personal', () => {
  const base = { method: 'GET', pathname: '/notion', search: '', cookie: '', signedIn: false };
  assert.equal(copyKey(base, apps), '/notion');
  assert.equal(copyKey({ ...base, cookie: 'theme=dark; other=1' }, apps), '/notion');
  assert.equal(copyKey({ ...base, method: 'POST' }, apps), null);
  assert.equal(copyKey({ ...base, method: 'HEAD' }, apps), null);
  assert.equal(copyKey({ ...base, search: '?t=abc' }, apps), null);
  assert.equal(copyKey({ ...base, search: '?utm_source=x' }, apps), null);
  assert.equal(copyKey({ ...base, signedIn: true }, apps), null);
  assert.equal(copyKey({ ...base, cookie: 'better-auth.session_token=abc' }, apps), null);
  assert.equal(copyKey({ ...base, cookie: 'bg_admin=abc' }, apps), null);
  assert.equal(copyKey({ ...base, pathname: '/sponsor/stats' }, apps), null);
});

test('page requests: pages only, never the API, the analytics proxy or files', () => {
  assert.equal(isPageRequest('GET', '/'), true);
  assert.equal(isPageRequest('GET', '/notion'), true);
  assert.equal(isPageRequest('GET', '/api/stats'), false);
  assert.equal(isPageRequest('GET', '/ph/e'), false);
  assert.equal(isPageRequest('GET', '/icons/notion.png'), false);
  assert.equal(isPageRequest('POST', '/notion'), false);
});

test('pressure: calm traffic never qualifies, a flood does within seconds', () => {
  const w = cfg.busyWindowMs;
  // A page that is merely popular: one request a second for a minute.
  let st = { inflight: 0, bucketAt: 0, bucket: 0, prev: 0 };
  for (let s = 0; s < 60; s++) assert.equal(underPressure(st, noteRequest(st, 1_000_000 + s * 1000, w), cfg), false, `second ${s}`);
  // The fastest measured person: 256 page requests a minute, spread over pages; even all on ONE page it is 4.3 a second.
  st = { inflight: 0, bucketAt: 0, bucket: 0, prev: 0 };
  let tripped = false;
  for (let i = 0; i < 30; i++) tripped ||= underPressure(st, noteRequest(st, 2_000_000 + i * 234, w), cfg);
  assert.equal(tripped, false, 'thirty requests at the fastest measured pace, all on one page, within 7 s');
  // The measured flood at its slowest, 21 a second.
  st = { inflight: 0, bucketAt: 0, bucket: 0, prev: 0 };
  let at = null;
  for (let i = 0; i < 200 && at == null; i++) if (underPressure(st, noteRequest(st, 3_000_000 + i * 48, w), cfg)) at = i * 48;
  assert.ok(at != null && at <= 2000, `flood recognised after ${at} ms`);
  // Renders piling up count as pressure on their own.
  assert.equal(underPressure({ inflight: cfg.busyInflight }, 1, cfg), true);
  assert.equal(underPressure({ inflight: cfg.busyInflight - 1 }, 1, cfg), false);
});

test('backstop: far above a person, never a shared bucket', () => {
  assert.equal(cfg.limitRequests, 3000);
  assert.equal(cfg.limitWindowMs, 5 * 60 * 1000);
  const table = new Map();
  const t0 = Math.floor(5_000_000_000 / cfg.limitWindowMs) * cfg.limitWindowMs;
  // The fastest measured session, 256 a minute, kept up for the whole five minutes: 1,280.
  for (let i = 0; i < 1280; i++) assert.equal(overLimit('203.0.113.9', t0 + i * 234, cfg, table), 0);
  // A pointer swept down the list for five minutes without pause, 410 a minute: 2,050.
  for (let i = 0; i < 2050; i++) assert.equal(overLimit('203.0.113.10', t0 + i * 146, cfg, table), 0);
  // Ten a second and more, sustained, is where it starts.
  let wait = 0;
  for (let i = 0; i < 3001; i++) wait = overLimit('203.0.113.11', t0 + i * 50, cfg, table);
  assert.ok(wait >= 1 && wait <= 300, `told to wait ${wait} s`);
  assert.equal(overLimit('203.0.113.11', t0 + cfg.limitWindowMs + 1, cfg, table), 0, 'the next window starts clean');
  // An address the server could not establish is never counted: it would be everyone at once.
  for (let i = 0; i < 5000; i++) assert.equal(overLimit('unknown', t0 + i, cfg, table), 0);
  for (let i = 0; i < 5000; i++) assert.equal(overLimit('', t0 + i, cfg, table), 0);
});

const page = (body = '<html>page</html>', extra = {}) => new Response(body, { status: 200, headers: { 'Content-Type': 'text/html', ...extra } });
const ctx = (path = '/', headers = {}) => ({
  request: new Request(`https://site.test${path}`, { headers: { 'user-agent': 'Mozilla/5.0 Chrome/140', 'x-forwarded-for': '203.0.113.50', ...headers } }),
  url: new URL(`https://site.test${path}`),
  locals: { user: null },
  clientAddress: '203.0.113.50',
  isPrerendered: false,
});

test('calm traffic: every request renders, a copy is never served', async () => {
  _reset();
  let renders = 0;
  for (let i = 0; i < 12; i++) {
    const res = await guardPage(ctx('/'), async () => page(`<html>render ${++renders}</html>`));
    assert.equal(res.headers.get('X-Served'), null);
    assert.equal(await res.text(), `<html>render ${i + 1}</html>`);
  }
  assert.equal(renders, 12);
});

test('under a burst: renders stop piling up and the kept copy is served', async () => {
  _reset();
  let renders = 0;
  const slow = () => new Promise((r) => setTimeout(() => r(page(`<html>render ${++renders}</html>`)), 60));
  // A first visitor leaves a copy behind.
  await (await guardPage(ctx('/'), slow)).text();
  await new Promise((r) => setTimeout(r, 20));
  const answers = await Promise.all(Array.from({ length: 300 }, () => guardPage(ctx('/'), slow).then(async (r) => ({ copy: r.headers.get('X-Served') === 'copy', body: await r.text() }))));
  assert.ok(renders <= 1 + cfg.busyRequests, `renders stayed bounded: ${renders}`);
  assert.ok(answers.filter((a) => a.copy).length >= 300 - cfg.busyRequests, 'the rest were served the copy');
  assert.ok(answers.every((a) => /^<html>render \d+<\/html>$/.test(a.body)), 'everyone got a whole page');
});

test('what must always render: signed-in, tokens, forms, other pages, non-HTML', async () => {
  _reset();
  let renders = 0;
  const r = async () => page(`<html>${++renders}</html>`);
  const flood = async (c) => Promise.all(Array.from({ length: 120 }, () => guardPage(c(), r).then((x) => x.headers.get('X-Served'))));
  for (const make of [
    () => ({ ...ctx('/'), locals: { user: { id: 'u1' } } }),
    () => ctx('/', { cookie: 'better-auth.session_token=abc' }),
    () => ctx('/', { cookie: 'bg_admin=secret' }),
    () => ctx('/sponsor/stats?t=abc'),
    () => ctx('/?utm_source=x'),
    () => ctx('/submit'),
    () => ctx('/admin/tap-ad'),
  ]) {
    const before = renders;
    const served = await flood(make);
    assert.equal(served.filter(Boolean).length, 0);
    assert.equal(renders - before, 120);
  }
  // A page that sets a cookie or is not a plain 200 HTML page is never kept.
  _reset();
  for (const res of [() => page('<html>x</html>', { 'Set-Cookie': 'a=1' }), () => new Response('nope', { status: 404, headers: { 'Content-Type': 'text/html' } }), () => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } })]) {
    _reset();
    const served = await Promise.all(Array.from({ length: 120 }, () => guardPage(ctx('/'), async () => res()).then((x) => x.headers.get('X-Served'))));
    assert.equal(served.filter(Boolean).length, 0);
  }
});

test('switched off, it is not there', async () => {
  _reset();
  process.env.FLOOD_GUARD = '0';
  try {
    let renders = 0;
    const served = await Promise.all(Array.from({ length: 200 }, () => guardPage(ctx('/'), async () => page(`<html>${++renders}</html>`)).then((x) => x.headers.get('X-Served'))));
    assert.equal(renders, 200);
    assert.equal(served.filter(Boolean).length, 0);
  } finally {
    delete process.env.FLOOD_GUARD;
  }
});
