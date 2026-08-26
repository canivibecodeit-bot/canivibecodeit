// Report a challenge entry. Reports are a counter, not a takedown button:
// crossing the threshold auto-holds the entry (out of the gallery, not
// deleted) and pings Rob once. Rate-limited so one grudge can't be a brigade.
import { bumpEntryReport, challengeEntryById, rateLimit, updateChallengeEntry } from '../../../lib/db.js';
import { challengeLive } from '../../../lib/flags.js';
import { alertRob, esc } from '../../../lib/mail.js';
import { clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';
import { ENTRY_ID_RE } from '../../../lib/challenge.js';

const HOLD_AT = 5;

export async function POST({ request, clientAddress }) {
  if (!challengeLive()) return new Response(null, { status: 404 });
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`chrep:${ip}`, 10, 60 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }

  const id = String(body.id ?? '');
  if (!ENTRY_ID_RE.test(id)) return json({ error: 'bad id' }, 400);

  const count = await bumpEntryReport(id);
  if (count == null) return json({ error: 'unknown entry' }, 404);

  // Threshold crossing exactly once: the == keeps repeat reports from
  // re-holding an entry an admin already looked at and relisted.
  if (count === HOLD_AT) {
    const entry = await challengeEntryById(id);
    if (entry && entry.status === 'live') {
      await updateChallengeEntry(id, { status: 'held', held_reason: `reports: ${count}` });
      alertRob(
        '[cvci] challenge entry auto-held on reports',
        `<p><b>${esc(entry.page_title ?? entry.url)}</b> by @${esc(entry.x_handle)} hit ${count} reports and is out of the gallery pending a look.</p>
         <p><a href="https://canivibecodeit.com/admin/challenge?token=${encodeURIComponent(process.env.ADMIN_TOKEN ?? '')}">open the queue</a></p>`
      ).catch((err) => console.error(`challenge report alert failed: ${err.message}`));
    }
  }

  return json({ ok: true });
}
