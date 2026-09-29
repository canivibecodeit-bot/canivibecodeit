/* House-ad numbers as JSON, for scripts: impressions, clicks and CTR per
   placement for today / 7 days / 30 days / all time. Same token as the
   admin consoles, taken from the bg_admin cookie the console sets, an
   Authorization: Bearer header, or ?token= for a one-off query. Failed
   attempts are rate limited per IP so the token cannot be guessed at
   speed. */
import { rateLimit } from '../../../lib/db.js';
import { clientIp, json } from '../../../lib/request.js';
import { isAdmin } from '../../../lib/sponsors.js';
import { TAP_PLACEMENTS, TAP_WINDOWS, tapLine, tapSales, tapSalesAge, tapStats } from '../../../lib/tap.js';

export async function GET({ request, clientAddress, cookies, url }) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = cookies?.get('bg_admin')?.value || bearer || url.searchParams.get('token') || '';
  if (!isAdmin(token)) {
    if (!(await rateLimit(`tapadmin:${clientIp(request, clientAddress)}`, 10, 15 * 60 * 1000))) {
      return json({ error: 'slow down' }, 429);
    }
    return json({ error: 'not found' }, 404);
  }
  const [stats, sales] = await Promise.all([tapStats(), tapSales()]);
  const res = json({
    generated_at: new Date().toISOString(),
    placements: TAP_PLACEMENTS,
    windows: TAP_WINDOWS.map((w) => w.key),
    stats,
    line: tapLine(sales),
    sales_age_ms: tapSalesAge(),
    note: 'Conversions are counted on the Attention Playbook side by utm_source=canivibecodeit.',
  });
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex');
  return res;
}
