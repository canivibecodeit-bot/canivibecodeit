// The recommendation card's outbound link: one server-counted redirect.
// Counting never blocks the navigation — past the rate limit the click still
// redirects, it just doesn't count. Known destinations only (no open
// redirect: the `to` key selects a constant, it is never a URL).
import { bgRecClick, rateLimit } from '../../../lib/db.js';
import { buildGamesLive } from '../../../lib/flags.js';
import { clientIp } from '../../../lib/request.js';
import { withUtm } from '../../../lib/sponsors.js';
import { HOWTOAI_REC } from '../../../lib/buildgames.js';

const RECS = { howtoai: HOWTOAI_REC };

export async function GET({ request, clientAddress, url }) {
  if (!buildGamesLive()) return new Response(null, { status: 404 });
  const rec = RECS[url.searchParams.get('to') ?? ''];
  if (!rec) return new Response(null, { status: 404 });

  const ip = clientIp(request, clientAddress);
  try {
    if (await rateLimit(`bgrec:${ip}`, 10, 60 * 60 * 1000)) {
      await bgRecClick(url.searchParams.get('to'));
    }
  } catch {
    /* the count is best-effort; the navigation never is */
  }
  // UTM-tagged so the partner sees the referral in his own stats; noindex on
  // the redirect as belt on braces (the anchor's rel does the SEO work).
  return new Response(null, {
    status: 302,
    headers: { Location: withUtm(rec.url, 'build_games'), 'X-Robots-Tag': 'noindex' },
  });
}
