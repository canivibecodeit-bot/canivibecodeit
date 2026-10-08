/* The Build Games judging tool: the pure parts of lib/buildgames-judging.js.
   Who may sign in and how the cookie holds, what the score API accepts,
   how the shortlist file is read, how the results add up, and the CSV.
   No database is touched. Run: npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  COOKIE_DAYS,
  NOTE_MAX,
  SCORE_CATEGORIES,
  computeResults,
  entryKey,
  entryScored,
  isLocked,
  judgeBySlug,
  judgeCookieSecret,
  judgeList,
  judgeSheet,
  lockRow,
  normaliseShortlist,
  parseJudgeCookie,
  resultsCsv,
  signJudgeCookie,
  validateScoreRequest,
  verifyJudgePassword,
} from '../src/lib/buildgames-judging.js';

const SECRET = 'test-secret-0123456789abcdef';

test('the three judges come from the game page, slug = handle, password = first name', () => {
  assert.deepEqual(
    judgeList().map((j) => [j.slug, j.firstName]),
    [
      ['tdinh_me', 'Tony'],
      ['dudufolio', 'Dudu'],
      ['scheemunai', 'Andrej'],
    ]
  );
  assert.equal(judgeBySlug('tdinh_me').name, 'Tony Dinh');
  assert.equal(judgeBySlug('TDINH_ME'), null);
  assert.equal(judgeBySlug('nobody'), null);
  assert.equal(judgeBySlug(undefined), null);
  assert.equal(judgeBySlug({}), null);
});

test('password: first name, case-insensitive, trimmed; nothing else', () => {
  assert.equal(verifyJudgePassword('tdinh_me', 'Tony'), true);
  assert.equal(verifyJudgePassword('tdinh_me', '  tony '), true);
  assert.equal(verifyJudgePassword('tdinh_me', 'TONY'), true);
  assert.equal(verifyJudgePassword('dudufolio', 'dudu'), true);
  assert.equal(verifyJudgePassword('scheemunai', 'Andrej'), true);
  assert.equal(verifyJudgePassword('tdinh_me', 'Tony Dinh'), false);
  assert.equal(verifyJudgePassword('tdinh_me', 'Dudu'), false);
  assert.equal(verifyJudgePassword('tdinh_me', ''), false);
  assert.equal(verifyJudgePassword('tdinh_me', '   '), false);
  assert.equal(verifyJudgePassword('tdinh_me', 'x'.repeat(65)), false);
  assert.equal(verifyJudgePassword('tdinh_me', null), false);
  assert.equal(verifyJudgePassword('tdinh_me', ['Tony']), false);
  assert.equal(verifyJudgePassword('nobody', 'Tony'), false);
});

test('cookie: signed for 30 days, rejects tampering, another secret, expiry, junk', () => {
  const now = Date.UTC(2026, 9, 8, 12, 0, 0);
  const c = signJudgeCookie('tdinh_me', SECRET, now);
  assert.match(c, /^tdinh_me\.\d+\.[A-Za-z0-9_-]{43}$/);
  assert.equal(parseJudgeCookie(c, SECRET, now).slug, 'tdinh_me');
  // valid right up to the 30th day, not after
  assert.equal(parseJudgeCookie(c, SECRET, now + COOKIE_DAYS * 86400000 - 1000)?.slug, 'tdinh_me');
  assert.equal(parseJudgeCookie(c, SECRET, now + COOKIE_DAYS * 86400000 + 1000), null);
  // another judge's slug with Tony's signature
  assert.equal(parseJudgeCookie(c.replace('tdinh_me', 'dudufolio'), SECRET, now), null);
  // pushed expiry
  const [slug, exp, sig] = c.split('.');
  assert.equal(parseJudgeCookie(`${slug}.${Number(exp) + 99999}.${sig}`, SECRET, now), null);
  // flipped signature byte
  const flipped = sig[0] === 'A' ? 'B' + sig.slice(1) : 'A' + sig.slice(1);
  assert.equal(parseJudgeCookie(`${slug}.${exp}.${flipped}`, SECRET, now), null);
  assert.equal(parseJudgeCookie(c, 'other-secret', now), null);
  assert.equal(parseJudgeCookie(c, '', now), null);
  assert.equal(parseJudgeCookie('', SECRET, now), null);
  assert.equal(parseJudgeCookie(undefined, SECRET, now), null);
  assert.equal(parseJudgeCookie('a.b', SECRET, now), null);
  assert.equal(parseJudgeCookie('x'.repeat(300), SECRET, now), null);
  // unknown judge cannot be signed
  assert.equal(signJudgeCookie('nobody', SECRET, now), null);
  assert.equal(signJudgeCookie('tdinh_me', '', now), null);
});

test('cookie secret: the judging secret, else the auth secret, else nothing (fail closed)', () => {
  assert.equal(judgeCookieSecret({ BUILDGAMES_JUDGING_SECRET: 'a', BETTER_AUTH_SECRET: 'b' }), 'a');
  assert.equal(judgeCookieSecret({ BETTER_AUTH_SECRET: 'b' }), 'b');
  assert.equal(judgeCookieSecret({}), '');
});

const RAW = [
  { rank: 2, name: 'Inkwell', handle: '@mira', demoUrl: 'https://inkwell.example/', repoUrl: 'https://github.com/mira/inkwell', oneLine: 'notes' },
  { rank: 1, entryId: 'E-01', product: ' Penny <b>Wise</b> ', name: 'Pennywise', handle: 'alex', demoUrl: 'https://penny.example/', repoUrl: 'javascript:alert(1)', oneLine: 'money <b>x</b>' },
  { name: 'Shot list', demoUrl: 'https://shot.example/', oneLine: 'a\u0000b​c' },
];

test('shortlist: keys are stable, order by rank, urls checked, control characters dropped', () => {
  const list = normaliseShortlist(RAW);
  assert.deepEqual(
    list.map((e) => [e.rank, e.key, e.name]),
    [
      [1, 'e-01', 'Pennywise'],
      [2, 'inkwell', 'Inkwell'],
      [3, 'shot-list', 'Shot list'],
    ]
  );
  assert.equal(list[1].handle, 'mira');
  assert.equal(list[0].product, 'Penny <b>Wise</b>', 'product as text; the page escapes it');
  assert.equal(list[1].product, 'Inkwell', 'no product: the entrant name stands in');
  assert.equal(list[0].repoUrl, '', 'a javascript: url is dropped');
  assert.equal(list[0].oneLine, 'money <b>x</b>', 'text is kept as text; the page escapes it');
  assert.equal(list[2].oneLine, 'abc');
  assert.equal(entryKey({ entryId: ' E 01 ' }), 'e-01');
  assert.equal(entryKey({ entryId: 'bge_b9ysh6kzac' }), 'bge_b9ysh6kzac', 'production entry ids keep their underscore');
  assert.equal(entryKey({ name: 'Café Noir!' }), 'cafe-noir');
  assert.throws(() => normaliseShortlist({}), /array/);
  assert.throws(() => normaliseShortlist([{ name: 'x' }]), /demo url/);
  assert.throws(() => normaliseShortlist([{ demoUrl: 'https://a.example/' }]), /name/);
  assert.throws(() => normaliseShortlist([RAW[0], { ...RAW[0], rank: 9 }]), /duplicate/);
});

const judge = judgeBySlug('tdinh_me');
const keys = new Set(['e-01', 'inkwell']);
const ok = (body, ctx = {}) => {
  const v = validateScoreRequest(body, { judge, entryKeys: keys, locked: false, ...ctx });
  assert.equal(v.error, undefined, `expected ok, got ${v.error}`);
  return v.row;
};
const bad = (body, status, ctx = {}) => {
  const v = validateScoreRequest(body, { judge, entryKeys: keys, locked: false, ...ctx });
  assert.ok(v.error, `expected an error for ${JSON.stringify(body)}`);
  assert.equal(v.status, status, `${JSON.stringify(body)}: ${v.error}`);
};

test('score API: whole numbers 0 to 10 only, known judge, known entry, known category', () => {
  assert.deepEqual(ok({ entry: 'e-01', category: 'replacement', score: 7 }), {
    judge: 'tdinh_me',
    entry_key: 'e-01',
    category: 'replacement',
    score: 7,
    note: null,
  });
  ok({ entry: 'e-01', category: 'creative', score: 0 });
  ok({ entry: 'inkwell', category: 'polished', score: 10 });
  assert.equal(ok({ entry: 'e-01', category: 'polished', score: null }).score, null, 'null clears a score');
  for (const score of [-1, 11, 7.5, '7', '', true, undefined, NaN, Infinity, [7], {}]) {
    bad({ entry: 'e-01', category: 'replacement', score }, 400);
  }
  bad({ entry: 'e-01', category: 'overall', score: 5 }, 400);
  bad({ entry: 'e-01', category: 'lock', score: 1 }, 400);
  bad({ entry: 'e-01', score: 5 }, 400);
  bad({ entry: 'nope', category: 'replacement', score: 5 }, 404);
  bad({ entry: '', category: 'replacement', score: 5 }, 404);
  bad({ category: 'replacement', score: 5 }, 404);
  bad(null, 400);
  bad('e-01', 400);
  bad({ entry: 'e-01', category: 'replacement', score: 5 }, 401, { judge: null });
  bad({ entry: 'e-01', category: 'replacement', score: 5 }, 423, { locked: true });
  bad({ entry: 'e-01', category: 'note', note: 'x' }, 423, { locked: true });
});

test('score API: notes are text, trimmed, single-spaced, at most 200 characters', () => {
  assert.deepEqual(ok({ entry: 'e-01', category: 'note', note: '  nice   one\n\u0000 ' }), {
    judge: 'tdinh_me',
    entry_key: 'e-01',
    category: 'note',
    score: null,
    note: 'nice one',
  });
  assert.equal(ok({ entry: 'e-01', category: 'note', note: 'x'.repeat(500) }).note.length, NOTE_MAX);
  assert.equal(ok({ entry: 'e-01', category: 'note', note: '' }).note, '');
  assert.equal(ok({ entry: 'e-01', category: 'note' }).note, '');
  bad({ entry: 'e-01', category: 'note', note: 7 }, 400);
  bad({ entry: 'e-01', category: 'note', note: 'x'.repeat(5000) }, 400);
});

const entries = normaliseShortlist(RAW);
const row = (judge, entry_key, category, score, note = null) => ({ judge, entry_key, category, score, note, updated_at: 1 });
const ROWS = [
  row('tdinh_me', 'e-01', 'replacement', 8),
  row('tdinh_me', 'e-01', 'creative', 6),
  row('tdinh_me', 'e-01', 'polished', 9),
  row('tdinh_me', 'e-01', 'note', null, 'ship it'),
  row('tdinh_me', 'inkwell', 'replacement', 3),
  row('dudufolio', 'e-01', 'replacement', 7),
  row('dudufolio', 'e-01', 'creative', 10),
  row('dudufolio', 'e-01', 'polished', 5),
  row('dudufolio', 'inkwell', 'replacement', 9),
  row('dudufolio', 'inkwell', 'creative', 9),
  row('dudufolio', 'inkwell', 'polished', 9),
  row('scheemunai', 'shot-list', 'creative', 4),
  // rows that must never count: out of range, unknown category, a stranger
  row('tdinh_me', 'inkwell', 'creative', 11),
  row('tdinh_me', 'inkwell', 'polished', 'high'),
  row('tdinh_me', 'inkwell', 'overall', 10),
  row('intruder', 'e-01', 'replacement', 10),
  lockRow(true),
];

test('a judge sheet carries that judge’s valid scores and note only', () => {
  const sheet = judgeSheet(ROWS, 'tdinh_me');
  assert.deepEqual(sheet.get('e-01'), { note: 'ship it', replacement: 8, creative: 6, polished: 9 });
  assert.deepEqual(sheet.get('inkwell'), { note: '', replacement: 3 });
  assert.equal(sheet.get('shot-list'), undefined);
  assert.equal(entryScored(sheet.get('e-01')), true);
  assert.equal(entryScored(sheet.get('inkwell')), false);
  assert.equal(entryScored(undefined), false);
});

test('results: per judge per category, category totals, overall total, notes, progress, order', () => {
  const { results, progress } = computeResults(entries, ROWS);
  assert.deepEqual(
    results.map((r) => [r.key, r.total]),
    [
      ['e-01', 45],
      ['inkwell', 30],
      ['shot-list', 4],
    ]
  );
  const top = results[0];
  assert.deepEqual(top.categoryTotals, { replacement: 15, creative: 16, polished: 14 });
  assert.deepEqual(top.byJudge.tdinh_me, { note: 'ship it', replacement: 8, creative: 6, polished: 9 });
  assert.deepEqual(top.byJudge.dudufolio, { note: '', replacement: 7, creative: 10, polished: 5 });
  assert.deepEqual(top.byJudge.scheemunai, { note: '', replacement: null, creative: null, polished: null });
  assert.equal(top.byJudge.intruder, undefined);
  assert.deepEqual(
    progress.map((p) => [p.firstName, p.scored, p.of]),
    [
      ['Tony', 1, 3],
      ['Dudu', 2, 3],
      ['Andrej', 0, 3],
    ]
  );
  // ties keep shortlist rank order
  const tied = computeResults(entries, []);
  assert.deepEqual(
    tied.results.map((r) => r.key),
    ['e-01', 'inkwell', 'shot-list']
  );
  assert.equal(SCORE_CATEGORIES.length, 3);
});

test('the lock is one reserved row and never a score', () => {
  assert.equal(isLocked(ROWS), true);
  assert.equal(isLocked([]), false);
  assert.equal(isLocked([lockRow(false)]), false);
  assert.equal(isLocked([row('tdinh_me', '*', 'lock', 1)]), false, 'only the admin row counts');
  const { results } = computeResults(entries, [lockRow(true)]);
  assert.equal(results.every((r) => r.total === 0), true);
});

test('csv: one row per entry, quoted where needed, progress at the foot', () => {
  const data = computeResults(entries, [...ROWS, row('scheemunai', 'e-01', 'note', null, 'good, "really"')]);
  const csv = resultsCsv(data);
  const lines = csv.split('\r\n');
  assert.equal(lines[0].split(',').slice(0, 6).join(','), 'rank,product,entrant,handle,demo,repo');
  assert.equal(lines[0].split(',').length, 6 + 3 * 4 + 1 + 3);
  assert.match(lines[1], /^1,Penny <b>Wise<\/b>,Pennywise,alex,https:\/\/penny\.example\/,,8,7,,15,6,10,,16,9,5,,14,45,ship it,,"good, ""really"""$/);
  assert.match(lines[2], /^2,Inkwell,Inkwell,mira,/);
  assert.equal(lines[5], 'Tony Dinh: 1 of 3 scored,Dudu: 2 of 3 scored,Andrej: 0 of 3 scored');
});
