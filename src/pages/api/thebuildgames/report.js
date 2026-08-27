// Report a Build Games sponsor. Distinct-reporter dedupe (stable salt), auto-
// hold at threshold, one alert. Same shape as the challenge report endpoint.
import { createHash } from 'node:crypto';
import { addBgReport, bgSponsorById, rateLimit, updateBgSponsor } from '../../../lib/db.js';
import { buildGamesLive } from '../../../lib/flags.js';
import { alertRob, esc } from '../../../lib/mail.js';
import { clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';
import { SPONSOR_ID_RE, displayName } from '../../../lib/buildgames.js';

const HOLD_AT = 5;
const REPORT_SALT =
  process.env.SPONSOR_SIGNING_SECRET || process.env.BETTER_AUTH_SECRET || process.env.ADMIN_TOKEN || 'cvci-buildgames-reports';

export async function POST({ request, clientAddress }) {
  if (!buildGamesLive()) return new Response(null, { status: 404 });
  if (crossOrigin(request)) return json({ error: 'bad origin' }, 403);

  const ip = clientIp(request, clientAddress);
  if (!(await rateLimit(`bgrep:${ip}`, 10, 60 * 60 * 1000))) return json({ error: 'slow down' }, 429);

  let body;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const id = String(body.id ?? '');
  if (!SPONSOR_ID_RE.test(id)) return json({ error: 'bad id' }, 400);

  const reporterHash = createHash('sha256').update(`${REPORT_SALT}:${id}:${ip}`).digest('hex').slice(0, 32);
  const distinct = await addBgReport(id, reporterHash);
  if (distinct == null) return json({ ok: true }); // dup or unknown — neutral

  if (distinct === HOLD_AT) {
    const s = await bgSponsorById(id);
    if (s && s.status === 'active') {
      await updateBgSponsor(id, { status: 'held', held_reason: `reports: ${distinct} distinct` });
      alertRob(
        '[cvci] build games sponsor auto-held on reports',
        `<p><b>${esc(displayName(s))}</b> (${esc(s.link)}) hit ${distinct} distinct reports and is out of the board pending a look. Its cleared money stays in the pool.</p>
         <p><a href="https://canivibecodeit.com/admin/thebuildgames">open the queue and paste your token</a></p>`
      ).catch((err) => console.error(`bg report alert failed: ${err.message}`));
    }
  }
  return json({ ok: true });
}
