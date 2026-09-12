/* The ABCs of moats: the suggestion validator, the voter key and the
   screener call (against a fake fetch). No database is touched. Run:
   npm test */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCREEN_SYSTEM_PROMPT,
  SUGGEST_DAILY,
  screenWord,
  utcDayStart,
  validateSuggestion,
  voterKeyFor,
} from '../src/lib/abc.js';

const ok = (body) => {
  const v = validateSuggestion(body);
  assert.equal(v.error, undefined, `expected ok, got: ${v.error}`);
  return v;
};
const bad = (body, part) => {
  const v = validateSuggestion(body);
  assert.ok(v.error, `expected an error for ${JSON.stringify(body)}`);
  if (part) assert.match(v.error, part);
};

test('accepts one or two plain words starting with the letter, normalised', () => {
  assert.deepEqual(ok({ letter: 'c', word: '  Community ', why: '' }), { letter: 'C', word: 'community', why: null });
  assert.deepEqual(ok({ letter: 'S', word: 'switching costs', why: ' the pain of  leaving ' }), {
    letter: 'S',
    word: 'switching costs',
    why: 'the pain of leaving',
  });
  ok({ letter: 'W', word: 'word-of-mouth'.slice(0, 7), why: null });
  ok({ letter: 'K', word: 'know-how' });
});

test('rejects the wrong shape', () => {
  bad(null, /send a word/);
  bad({ letter: 'AB', word: 'audience' }, /letter/);
  bad({ letter: '1', word: 'audience' }, /letter/);
  bad({ letter: 'A', word: 'a' }, /two letters/);
  bad({ letter: 'A', word: 'a'.repeat(25) }, /24/);
  bad({ letter: 'A', word: 'audience2' }, /letters only/);
  bad({ letter: 'A', word: 'one two three' }, /letters only/);
  bad({ letter: 'A', word: 'brand' }, /start with A/);
  bad({ letter: 'A', word: 'audience', why: 'x'.repeat(81) }, /80/);
});

test('rejects links, handles, emails and markup anywhere', () => {
  bad({ letter: 'H', word: 'https', why: 'see https://x.com' }, /links/);
  bad({ letter: 'A', word: 'audience', why: 'www.example.com' });
  bad({ letter: 'A', word: 'audience', why: 'ping @someone' });
  bad({ letter: 'A', word: 'audience', why: 'mail me@here.io' });
  bad({ letter: 'A', word: 'audience', why: '<b>bold</b>' });
  bad({ letter: 'A', word: 'audience', why: 'a {template}' });
  bad({ letter: 'A', word: 'audience', why: 'run `rm -rf`' });
});

test('strips control and invisible characters before judging', () => {
  assert.equal(ok({ letter: 'A', word: 'aud\u0000ience' }).word, 'audience');
  assert.equal(ok({ letter: 'A', word: 'audience', why: 'plain\u200b text\u202e' }).why, 'plain text');
  bad({ letter: 'A', word: 'audience', why: 'line\u2028https://x.dev' });
});

test('voter key: users by id, visitors by an HMAC of the IP, never the IP itself', () => {
  const req = (ip) => new Request('https://example.test/', { headers: { 'x-forwarded-for': ip } });
  assert.equal(voterKeyFor(req('1.2.3.4'), null, { id: 'u1' }), 'u:u1');
  const a = voterKeyFor(req('1.2.3.4'), null, null);
  const b = voterKeyFor(req('1.2.3.4'), null, null);
  const c = voterKeyFor(req('5.6.7.8'), null, null);
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^ip:[A-Za-z0-9_-]{32}$/);
  assert.ok(!a.includes('1.2.3.4'));
});

test('utc day start and the daily allowance', () => {
  assert.equal(utcDayStart(Date.UTC(2026, 8, 12, 23, 59, 59)), Date.UTC(2026, 8, 12));
  assert.equal(SUGGEST_DAILY, 3);
});

test('screener: parses the verdict, sends the word as data, falls back once, fails closed', async () => {
  process.env.OPENROUTER_API_KEY = 'test-key';
  const calls = [];
  const reply = (status, content) =>
    async (url, init) => {
      calls.push(JSON.parse(init.body));
      return { ok: status === 200, status, json: async () => ({ choices: [{ message: { content } }] }) };
    };
  // A clean answer.
  assert.deepEqual(
    await screenWord({ letter: 'C', word: 'craft', why: 'hard to copy' }, reply(200, '{"ok":true,"reason":"fine"}')),
    { ok: true, reason: 'fine' }
  );
  assert.equal(calls[0].messages[0].role, 'system');
  assert.equal(calls[0].messages[0].content, SCREEN_SYSTEM_PROMPT);
  assert.deepEqual(JSON.parse(calls[0].messages[1].content), { letter: 'C', word: 'craft', why: 'hard to copy' });
  // Prose around the JSON is tolerated; a rejection carries its reason.
  const r = await screenWord({ letter: 'X', word: 'xx', why: null }, reply(200, 'Sure: {"ok":false,"reason":"not a moat"} ok'));
  assert.deepEqual(r, { ok: false, reason: 'not a moat' });
  // First model down, second answers.
  let n = 0;
  const flaky = async (url, init) => {
    n++;
    if (n === 1) return { ok: false, status: 503, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) };
  };
  assert.deepEqual(await screenWord({ letter: 'A', word: 'audience' }, flaky), { ok: true, reason: null });
  assert.equal(n, 2);
  // Garbage from every model: throws, never approves.
  await assert.rejects(() => screenWord({ letter: 'A', word: 'audience' }, reply(200, 'yes')));
  await assert.rejects(() => screenWord({ letter: 'A', word: 'audience' }, reply(200, '{"reason":"x"}')));
  await assert.rejects(() => screenWord({ letter: 'A', word: 'audience' }, reply(500, '{"ok":true}')));
});
