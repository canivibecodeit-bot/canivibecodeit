/* Saves one judge's score or note: POST JSON {entry, category, score} or
   {entry, category: 'note', note}. The judge is the signed bg_judge cookie
   (HttpOnly, SameSite=Lax); the request must be same-origin and JSON, so
   no cross-site form can reach it. Scores are whole numbers from 0 to 10
   (null clears one); a note is up to 200 characters. Nothing is written
   while judging is locked. The row is upserted, so the judge can change
   any score until then. */
import { bgJudgingDelete, bgJudgingRows, bgJudgingUpsert, rateLimit } from '../../../../lib/db.js';
import { clientIp, crossOrigin, json, readBody } from '../../../../lib/request.js';
import { COOKIE_NAME, isLocked, judgeCookieSecret, parseJudgeCookie, validateScoreRequest } from '../../../../lib/buildgames-judging.js';
import { shortlist } from '../../../../lib/buildgames-shortlist.js';

export async function POST({ request, clientAddress, cookies }) {
  const entries = shortlist();
  const secret = judgeCookieSecret();
  if (!entries || !secret) return json({ error: 'not found' }, 404);
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') return json({ error: 'bad origin' }, 403);
  if (!(request.headers.get('content-type') || '').includes('application/json')) return json({ error: 'json only' }, 415);

  const judge = parseJudgeCookie(cookies.get(COOKIE_NAME)?.value, secret);
  if (!judge) return json({ error: 'sign in first' }, 401);

  if (!(await rateLimit(`judgescore:${clientIp(request, clientAddress)}`, 240, 10 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }

  let body;
  try {
    body = await readBody(request, { maxBytes: 4096 });
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const locked = isLocked(await bgJudgingRows());
  const v = validateScoreRequest(body, { judge, entryKeys: new Set(entries.map((e) => e.key)), locked });
  if (v.error) return json({ error: v.error }, v.status);

  const row = { ...v.row, updated_at: Date.now() };
  const clearing = row.category !== 'note' ? row.score === null : row.note === '';
  if (clearing) await bgJudgingDelete(row.judge, row.entry_key, row.category);
  else await bgJudgingUpsert(row);

  const res = json({ ok: true, entry: row.entry_key, category: row.category, score: row.score, note: row.note });
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
}
