/* GET /api/abc/word/:id: the page polls this after a suggestion until the
   screener has answered. A live word is public; a pending or rejected one
   is only reported to the user who suggested it (404 to anyone else, so
   unscreened text is never readable by id). A pending word that has sat
   for a while kicks the retry queue. */
import { abcWord, rateLimit } from '../../../../lib/db.js';
import { STALE_PENDING_MS, scheduleRetry } from '../../../../lib/abc.js';
import { clientIp, json } from '../../../../lib/request.js';

export async function GET({ params, request, locals, clientAddress }) {
  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`abc-poll:${ip}`, 120, 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }
  const id = Number(params.id);
  if (!Number.isInteger(id) || id <= 0) return json({ error: 'unknown word' }, 404);
  const word = await abcWord(id);
  if (!word) return json({ error: 'unknown word' }, 404);
  const mine = !!locals.user && word.user_id === locals.user.id;
  if (word.status !== 'live' && !mine) return json({ error: 'unknown word' }, 404);
  if (word.status === 'pending' && Date.now() - word.created_at > STALE_PENDING_MS) scheduleRetry(1000);
  return new Response(
    JSON.stringify({
      id: word.id,
      letter: word.letter,
      word: word.word,
      why: word.why ?? null,
      status: word.status,
      votes: word.status === 'live' ? word.votes : 0,
    }),
    { status: 200, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }
  );
}
