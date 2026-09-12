/* POST /api/abc/suggest: a signed-in user proposes a word for a letter.
   Body {letter, word, why, website?}. Validated in lib/abc.js (letter A-Z,
   2-24 letters in one or two words starting with the letter, why up to 80
   plain characters, no links/handles/emails anywhere). Gates in order: a
   session (401), same origin (403), the honeypot (a fake 202), 10 an hour
   per IP, a small global cap, 3 per user per UTC day (429, enforced again
   inside the insert so parallel posts cannot exceed it), then the
   duplicate check (409). The word is stored pending and screened in the
   background; the reply carries the id the page polls. */
import { rateLimit } from '../../../lib/db.js';
import { SUGGEST_DAILY, addSuggestion, suggestionsLeft, validateSuggestion } from '../../../lib/abc.js';
import { clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';

export async function POST({ request, locals, clientAddress }) {
  const user = locals.user;
  if (!user) return json({ error: 'sign in to suggest a word' }, 401);
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  // Honeypot: a real visitor never fills this hidden field.
  if (typeof body?.website === 'string' && body.website.trim() !== '') {
    return json({ ok: true, id: 0, status: 'pending' }, 202);
  }

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`abc-suggest:${ip}`, 10, 60 * 60 * 1000))) {
    return json({ error: 'that is a lot of words for one hour. back soon.' }, 429);
  }
  // Every accepted word costs one screener call, so the whole site gets a
  // ceiling too (a flood is a bill, not just noise).
  if (!(await rateLimit('abc-suggest:all', 300, 24 * 60 * 60 * 1000))) {
    return json({ error: 'the suggestion box is full for today, try tomorrow' }, 429);
  }

  const v = validateSuggestion(body);
  if (v.error) return json({ error: v.error }, 400);

  const left = await suggestionsLeft(user.id);
  if (left <= 0) {
    return json({ error: `that's ${SUGGEST_DAILY} for today, back tomorrow`, left: 0 }, 429);
  }

  // The insert itself enforces the quota again, atomically: the check above
  // only exists for the friendlier message on the ordinary path.
  const r = await addSuggestion({ letter: v.letter, word: v.word, why: v.why, userId: user.id });
  if (r.error === 'duplicate') return json({ error: 'already suggested', left }, 409);
  if (r.error) return json({ error: `that's ${SUGGEST_DAILY} for today, back tomorrow`, left: 0 }, 429);

  return json({ id: r.id, letter: v.letter, word: v.word, why: v.why, status: 'pending', left: left - 1 }, 202);
}
