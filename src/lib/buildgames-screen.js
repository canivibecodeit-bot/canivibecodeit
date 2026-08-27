/* Screening for a submitted Build Games link. Same open-submission threat
   class as the challenge entry form, so it runs through the same hardened
   primitives: parsePublicUrl + the DNS-pinned safeFetch walk (no SSRF), a
   favicon pulled from the page we actually land on, and a Safe Browsing check
   on the FINAL url that fails CLOSED (unreachable / API-down → held). */
import { parsePublicUrl } from './builds.js';
import { safeFetch } from './safe-fetch.js';
import { checkUrl, safeBrowsingOn, uncheckedAllowed } from './safe-browsing.js';

const FETCH_BYTES = 262144;
const FETCH_TIMEOUT = 8000;
const screenHop = (raw) => parsePublicUrl(raw, { maxLen: 500 });

/* Fetch the page (SSRF-safe), report the url we landed on, whether we reached
   a definitive destination, and the best favicon URL we can find. */
async function fetchSiteFavicon(url) {
  const out = { reached: false, ok2xx: false, finalUrl: url, faviconUrl: null };
  const res = await safeFetch(url, {
    screen: screenHop,
    maxBytes: FETCH_BYTES,
    timeoutMs: FETCH_TIMEOUT,
    maxHops: 3,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' },
  });
  if (!res) return out;
  out.reached = true;
  out.ok2xx = res.status >= 200 && res.status < 300;
  out.finalUrl = res.finalUrl;
  if (!res.body || !res.contentType.includes('html')) {
    // No HTML to parse — try the conventional /favicon.ico at the origin.
    out.faviconUrl = originFavicon(res.finalUrl);
    return out;
  }
  const html = res.body.toString('utf8');
  // <link rel="icon|shortcut icon|apple-touch-icon" href="...">, any attr order.
  const relIcon =
    html.match(/<link[^>]+rel\s*=\s*["'][^"']*icon[^"']*["'][^>]+href\s*=\s*["']([^"']{1,500})["']/i)?.[1] ??
    html.match(/<link[^>]+href\s*=\s*["']([^"']{1,500})["'][^>]+rel\s*=\s*["'][^"']*icon[^"']*["']/i)?.[1];
  if (relIcon) {
    try {
      const resolved = parsePublicUrl(new URL(relIcon, res.finalUrl.href).href, { maxLen: 500 });
      if (resolved) out.faviconUrl = resolved.href;
    } catch {
      /* malformed icon href — fall through to origin favicon */
    }
  }
  if (!out.faviconUrl) out.faviconUrl = originFavicon(res.finalUrl);
  return out;
}

function originFavicon(u) {
  const guess = parsePublicUrl(`${u.origin}/favicon.ico`, { maxLen: 500 });
  return guess ? guess.href : null;
}

/* Full screen of a raw submitted link string. Returns:
   { ok, verdict, finalUrl (URL), faviconUrl (string|null), reason }
   verdict: 'ok' | 'held' | 'reject'
   - reject → bad URL, don't create anything (400 to the user)
   - held   → created but not displayed until a human clears it
   - ok     → clears screening; displays once it has cleared money */
export async function screenSubmission(rawLink) {
  const url = parsePublicUrl(rawLink);
  if (!url) return { ok: false, verdict: 'reject', reason: 'needs a public https link' };

  const site = await fetchSiteFavicon(url);

  // Reachability + a 2xx are basic validity checks, independent of Safe
  // Browsing: a link that never reached a definitive public destination (dead
  // site, or an internal host the SSRF guard refused) OR that answered non-2xx
  // (404 / error / a bare redirect that didn't resolve to a page) is held —
  // a paid #1 spot must not point at a dead link (audit M7).
  if (!site.reached) {
    return { ok: true, verdict: 'held', finalUrl: url, faviconUrl: null, reason: 'link unreachable, pending review' };
  }
  if (!site.ok2xx) {
    return { ok: true, verdict: 'held', finalUrl: site.finalUrl, faviconUrl: null, reason: 'link did not return a live page (non-2xx), pending review' };
  }

  let verdict = 'ok';
  let reason = null;
  if (safeBrowsingOn()) {
    const sb = await checkUrl(site.finalUrl.href);
    if (sb === 'unknown') {
      verdict = 'held';
      reason = 'safe-browsing: check unavailable, pending review';
    } else if (sb) {
      verdict = 'held';
      reason = `safe-browsing: ${sb.join(', ')}`;
    }
  } else if (!uncheckedAllowed()) {
    // Gate unarmed and not explicitly opted out: fail CLOSED. This is the
    // belt to assertSafeBrowsingReady()'s braces — even a caller that forgot
    // the assert can never list a link that was never malware-screened (H1).
    verdict = 'held';
    reason = 'safe-browsing: gate not armed, pending review';
  }
  return { ok: true, verdict, finalUrl: site.finalUrl, faviconUrl: site.faviconUrl, reason };
}
