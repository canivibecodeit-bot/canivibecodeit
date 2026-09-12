/* POST /api/abc/vote {word_id}: toggle the caller's vote on a live word.
   One vote per voter key per word (a signed-in user id, else an HMAC of
   the IP: lib/abc.js), so a second POST takes the vote back. Same origin
   only, and a burst cap per IP like the app votes. Replies {count, voted}. */
import { abcToggleVote, abcWord, rateLimit } from '../../../lib/db.js';
import { voterKeyFor } from '../../../lib/abc.js';
import { BodyTooLarge, clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';

// {"word_id": <int>} is a few dozen bytes; anything bigger is not a vote.
const MAX_BODY = 1024;

export async function POST({ request, locals, clientAddress }) {
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);
  // Throttle before the body is read: a burst of fat bodies must not get
  // parsed on its way to a 429.
  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`abc-vote-burst:${ip}`, 30, 60 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }
  let body;
  try {
    body = await readBody(request, { maxBytes: MAX_BODY });
  } catch (err) {
    if (err instanceof BodyTooLarge) return json({ error: 'too much' }, 413);
    return json({ error: 'bad request' }, 400);
  }
  const id = Number(body?.word_id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'unknown word' }, 404);

  const word = await abcWord(id);
  if (!word || word.status !== 'live') return json({ error: 'unknown word' }, 404);

  const { count, voted } = await abcToggleVote(id, voterKeyFor(request, clientAddress, locals.user));
  return json({ count, voted });
}
