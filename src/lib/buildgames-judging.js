/* The Build Games judging tool: the pure parts. Who the judges are and how
   they sign in, what a valid score looks like, how the results add up, and
   the CSV. No database, no request objects: the pages and the API call in
   here and lib/db.js stores the rows. Tests: test/buildgames-judging.test.mjs.

   Sign-in is deliberately light. Three known people, each with a page of
   their own and a password that is their first name as printed on the game
   page. The page URLs are never listed anywhere, the compare is constant
   time, attempts are rate limited per address (the page), and a signed
   HttpOnly cookie keeps them signed in for 30 days. */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { JUDGES } from './buildgames.js';

/* The three prize categories as the judges score them. The keys are stored
   in the database, so they never change; the help lines are the operator's
   plain words for the column heads. */
export const SCORE_CATEGORIES = [
  { key: 'replacement', name: 'Replacement', help: "does it do the paid product's job, would a real user switch?" },
  { key: 'creative', name: 'Creative', help: 'originality of the idea and how it was built' },
  { key: 'polished', name: 'Polished', help: 'design, reliability, completeness' },
];
export const SCORE_MIN = 0;
export const SCORE_MAX = 10;
export const NOTE_MAX = 200;
export const COOKIE_NAME = 'bg_judge';
export const COOKIE_DAYS = 30;
// A row in the scores table whose category is this key carries the judge's
// note for the entry (score NULL); a reserved judge name holds the lock row.
export const NOTE_KEY = 'note';
export const LOCK_JUDGE = '_admin';
export const LOCK_ENTRY = '*';
export const LOCK_KEY = 'lock';

const CATEGORY_KEYS = new Set(SCORE_CATEGORIES.map((c) => c.key));

/* ---------- judges ---------- */

// The judge list on the game page is the source of truth: slug = X handle,
// password = first name as printed there.
export function judgeList() {
  return JUDGES.map((j) => ({
    slug: j.handle,
    name: j.name,
    firstName: j.name.trim().split(/\s+/)[0],
  }));
}

export function judgeBySlug(slug) {
  if (typeof slug !== 'string') return null;
  return judgeList().find((j) => j.slug === slug) ?? null;
}

const digest = (s) => createHmac('sha256', 'cvci-judge-password').update(String(s), 'utf8').digest();

// Case-insensitive, trimmed; compared as equal-length digests so the time
// taken never depends on how much of the password matched.
export function verifyJudgePassword(slug, password) {
  const judge = judgeBySlug(slug);
  if (!judge || typeof password !== 'string') return false;
  const given = password.trim().toLowerCase();
  if (!given || given.length > 64) return false;
  return timingSafeEqual(digest(given), digest(judge.firstName.toLowerCase()));
}

/* ---------- the signed cookie ---------- */

// Value: <slug>.<expiry seconds>.<HMAC-SHA256 base64url>. The secret is the
// site's auth secret (Railway and the mirror both carry one); with no secret
// at all nothing can be signed or verified, so the pages fail closed.
export function judgeCookieSecret(env = process.env) {
  return env.BUILDGAMES_JUDGING_SECRET || env.BETTER_AUTH_SECRET || '';
}

const sign = (payload, secret) => createHmac('sha256', secret).update(payload, 'utf8').digest('base64url');

export function signJudgeCookie(slug, secret, now = Date.now()) {
  if (!secret || !judgeBySlug(slug)) return null;
  const exp = Math.floor(now / 1000) + COOKIE_DAYS * 24 * 60 * 60;
  const payload = `${slug}.${exp}`;
  return `${payload}.${sign(payload, secret)}`;
}

// The judge the cookie names, or null for anything missing, altered,
// expired or signed with another secret.
export function parseJudgeCookie(value, secret, now = Date.now()) {
  if (!secret || typeof value !== 'string' || value.length > 200) return null;
  const parts = value.split('.');
  if (parts.length !== 3) return null;
  const [slug, expStr, sig] = parts;
  if (!/^\d{1,12}$/.test(expStr) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return null;
  const expected = sign(`${slug}.${expStr}`, secret);
  const a = Buffer.from(sig, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  if (Number(expStr) * 1000 <= now) return null;
  return judgeBySlug(slug);
}

/* ---------- the shortlist ---------- */

// Entry key: the stable id the scores are stored under. The file may carry
// an entryId; otherwise the name, slugified. Never the rank, which can move.
export function entryKey(entry) {
  const id = typeof entry?.entryId === 'string' ? entry.entryId.trim() : '';
  if (id) return id.toLowerCase().replace(/[^a-z0-9_]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
  const name = String(entry?.name ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 64);
  return name;
}

const cleanText = (v, max) =>
  typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\ufeff]/g, '').trim().slice(0, max) : '';

const cleanUrl = (v) => {
  if (typeof v !== 'string') return '';
  try {
    const u = new URL(v.trim());
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : '';
  } catch {
    return '';
  }
};

/* The shortlist as the pages use it: one clean object per entry, in rank
   order, keys unique. Anything the file carries beyond these fields is
   ignored. Throws on a shape the tool cannot score (so a bad file fails the
   build, never the judges). */
export function normaliseShortlist(raw) {
  if (!Array.isArray(raw)) throw new Error('shortlist: expected an array');
  const seen = new Set();
  const entries = raw.map((e, i) => {
    const key = entryKey(e);
    const name = cleanText(e?.name, 80);
    if (!key || !name) throw new Error(`shortlist: entry ${i} has no usable name`);
    if (seen.has(key)) throw new Error(`shortlist: duplicate entry key ${key}`);
    seen.add(key);
    const demoUrl = cleanUrl(e?.demoUrl);
    if (!demoUrl) throw new Error(`shortlist: entry ${key} has no demo url`);
    return {
      key,
      rank: Number.isInteger(e?.rank) ? e.rank : i + 1,
      name,
      // What the judges see first: the product, falling back to the entrant.
      product: cleanText(e?.product, 80) || name,
      handle: cleanText(e?.handle, 40).replace(/^@/, ''),
      demoUrl,
      repoUrl: cleanUrl(e?.repoUrl),
      oneLine: cleanText(e?.oneLine, 200),
      blurb: cleanText(e?.blurb, 600),
      screenshot: cleanUrl(e?.screenshot),
    };
  });
  return entries.sort((a, b) => a.rank - b.rank);
}

/* ---------- validation ---------- */

export function validScore(v) {
  return Number.isInteger(v) && v >= SCORE_MIN && v <= SCORE_MAX;
}

export function cleanNote(v) {
  if (v == null) return '';
  return cleanText(String(v), NOTE_MAX).replace(/\s+/g, ' ');
}

/* The score API's body, checked against what is known: a judge from the
   cookie, an entry key on the shortlist, a category (or a note), and a
   score that is a whole number from 0 to 10, or null to clear it. Returns
   {error, status} or the row to store. */
export function validateScoreRequest(body, { judge, entryKeys, locked }) {
  if (!judge) return { error: 'sign in first', status: 401 };
  if (locked) return { error: 'judging is locked', status: 423 };
  if (!body || typeof body !== 'object') return { error: 'bad request', status: 400 };
  const entry = typeof body.entry === 'string' ? body.entry : '';
  if (!entry || !entryKeys.has(entry)) return { error: 'unknown entry', status: 404 };
  const category = typeof body.category === 'string' ? body.category : '';
  if (category === NOTE_KEY) {
    if (body.note != null && typeof body.note !== 'string') return { error: 'bad note', status: 400 };
    if (typeof body.note === 'string' && body.note.length > NOTE_MAX * 4) return { error: 'note too long', status: 400 };
    return { row: { judge: judge.slug, entry_key: entry, category: NOTE_KEY, score: null, note: cleanNote(body.note) } };
  }
  if (!CATEGORY_KEYS.has(category)) return { error: 'unknown category', status: 400 };
  const score = body.score;
  if (score !== null && !validScore(score)) return { error: 'score must be a whole number from 0 to 10', status: 400 };
  return { row: { judge: judge.slug, entry_key: entry, category, score, note: null } };
}

/* ---------- results ---------- */

// Rows for one judge, as the page needs them: {entryKey: {replacement, creative, polished, note}}.
export function judgeSheet(rows, judgeSlug) {
  const sheet = new Map();
  for (const r of rows) {
    if (r.judge !== judgeSlug) continue;
    const cur = sheet.get(r.entry_key) ?? { note: '' };
    if (r.category === NOTE_KEY) cur.note = r.note ?? '';
    else if (CATEGORY_KEYS.has(r.category) && validScore(r.score)) cur[r.category] = r.score;
    sheet.set(r.entry_key, cur);
  }
  return sheet;
}

export function entryScored(cell) {
  return SCORE_CATEGORIES.every((c) => validScore(cell?.[c.key]));
}

/* Everything the admin page shows: per entry each judge's score per
   category, the category totals, the overall total and the notes; per
   judge, how many entries are fully scored. Sorted by overall total, ties
   by rank. Sums only; who wins is the operator's call. */
export function computeResults(entries, rows, judges = judgeList()) {
  const sheets = new Map(judges.map((j) => [j.slug, judgeSheet(rows, j.slug)]));
  const results = entries.map((entry) => {
    const byJudge = {};
    const categoryTotals = {};
    let total = 0;
    for (const c of SCORE_CATEGORIES) categoryTotals[c.key] = 0;
    for (const j of judges) {
      const cell = sheets.get(j.slug).get(entry.key) ?? {};
      byJudge[j.slug] = { note: cell.note ?? '' };
      for (const c of SCORE_CATEGORIES) {
        const s = validScore(cell[c.key]) ? cell[c.key] : null;
        byJudge[j.slug][c.key] = s;
        if (s !== null) {
          categoryTotals[c.key] += s;
          total += s;
        }
      }
    }
    return { ...entry, byJudge, categoryTotals, total };
  });
  results.sort((a, b) => b.total - a.total || a.rank - b.rank);
  const progress = judges.map((j) => {
    const sheet = sheets.get(j.slug);
    const scored = entries.filter((e) => entryScored(sheet.get(e.key))).length;
    return { slug: j.slug, name: j.name, firstName: j.firstName, scored, of: entries.length };
  });
  return { results, progress };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

export function resultsCsv({ results, progress }, judges = judgeList()) {
  const head = ['rank', 'product', 'entrant', 'handle', 'demo', 'repo'];
  for (const c of SCORE_CATEGORIES) {
    for (const j of judges) head.push(`${c.key}_${j.slug}`);
    head.push(`${c.key}_total`);
  }
  head.push('total');
  for (const j of judges) head.push(`note_${j.slug}`);
  const lines = [head.map(csvCell).join(',')];
  for (const r of results) {
    const line = [r.rank, r.product, r.name, r.handle, r.demoUrl, r.repoUrl];
    for (const c of SCORE_CATEGORIES) {
      for (const j of judges) line.push(r.byJudge[j.slug][c.key]);
      line.push(r.categoryTotals[c.key]);
    }
    line.push(r.total);
    for (const j of judges) line.push(r.byJudge[j.slug].note);
    lines.push(line.map(csvCell).join(','));
  }
  lines.push('');
  lines.push(progress.map((p) => csvCell(`${p.name}: ${p.scored} of ${p.of} scored`)).join(','));
  return lines.join('\r\n') + '\r\n';
}

/* ---------- the lock ---------- */

export function lockRow(locked, now = Date.now()) {
  return { judge: LOCK_JUDGE, entry_key: LOCK_ENTRY, category: LOCK_KEY, score: locked ? 1 : 0, note: null, updated_at: now };
}

export function isLocked(rows) {
  return rows.some((r) => r.judge === LOCK_JUDGE && r.entry_key === LOCK_ENTRY && r.category === LOCK_KEY && Number(r.score) === 1);
}
