// Challenge entry moderation: release (held -> live), unlist (anything ->
// unlisted, out of the gallery for good unless relisted), relist, and the
// kind switches for seed/demo labeling. Token-gated like the other admin
// endpoints; form posts bounce back to /admin/challenge, JSON callers get
// JSON. Works with the flag off — the queue must stay reachable.
import { challengeEntryById, updateChallengeEntry } from '../../../lib/db.js';
import { json, readBody } from '../../../lib/request.js';
import { isAdmin } from '../../../lib/sponsors.js';
import { ENTRY_ID_RE } from '../../../lib/challenge.js';

const ACTIONS = {
  release: { status: 'live', held_reason: null },
  unlist: { status: 'unlisted' },
  relist: { status: 'live', held_reason: null },
  'mark-seed': { kind: 'seed' },
  'mark-demo': { kind: 'demo' },
  'mark-entry': { kind: 'entry' },
};

export async function POST({ request }) {
  const wantsJson = (request.headers.get('content-type') || '').includes('application/json');

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  if (!isAdmin(body.token)) return json({ error: 'not found' }, 404);

  // Same-origin paths only: "//evil.com" and "/\evil.com" are both absolute
  // to a browser, so a leading slash on its own proves nothing.
  const backTo = (message) => {
    const back = String(body.return_to || '');
    const target = /^\/(?![/\\])/.test(back) ? back : '/challenge';
    const sep = target.includes('?') ? '&' : '?';
    return new Response(null, {
      status: 303,
      headers: { Location: `${target}${sep}msg=${encodeURIComponent(message)}` },
    });
  };
  const doneWith = (message) => (wantsJson ? json({ ok: true, message }) : backTo(message));
  const fail = (error, status) => (wantsJson ? json({ error }, status) : backTo(error));

  const action = String(body.action ?? '');
  const id = String(body.id ?? '');
  if (!ENTRY_ID_RE.test(id)) return fail('bad id', 400);
  if (!Object.hasOwn(ACTIONS, action)) return fail('unknown action', 400);

  const entry = await challengeEntryById(id);
  if (!entry) return fail('unknown entry', 404);

  await updateChallengeEntry(id, ACTIONS[action]);
  return doneWith(`${action} · done`);
}
