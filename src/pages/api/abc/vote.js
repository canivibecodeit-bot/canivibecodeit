/* POST /api/abc/vote {word_id}: toggle the caller's vote on a live word.
   One vote per voter key per word (a signed-in user id, else an HMAC of
   the IP: lib/abc.js), so a second POST takes the vote back. Same origin
   only, and a burst cap per IP like the app votes. Replies {count, voted}. */
import { abcToggleVote, abcWord, rateLimit } from '../../../lib/db.js';
import { voterKeyFor } from '../../../lib/abc.js';
import { clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';

export async function POST({ request, locals, clientAddress }) {
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);
  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const id = Number(body?.word_id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'unknown word' }, 404);

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`abc-vote-burst:${ip}`, 30, 60 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }

  const word = await abcWord(id);
  if (!word || word.status !== 'live') return json({ error: 'unknown word' }, 404);

  const { count, voted } = await abcToggleVote(id, voterKeyFor(request, clientAddress, locals.user));
  return json({ count, voted });
}
