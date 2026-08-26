import { timingSafeEqual } from 'node:crypto';

/* Cloudflare origin lock. A Transform Rule on the zone stamps a secret
   x-origin-verify header onto every request CF forwards, so a request without
   it reached the origin directly and its client-sent headers can't be
   trusted. Three env-driven states (rollback is an env change, never a
   deploy):
   - ORIGIN_VERIFY_SECRET unset            → off (local dev / mirror)
   - secret set, ORIGIN_VERIFY_ENFORCE!=1  → log-only: count the miss, serve
   - secret set, ORIGIN_VERIFY_ENFORCE=1   → 403 the request
   Lives here (a leaf util) so both middleware and clientIp share one answer. */
export function originVerdict(request) {
  const secret = process.env.ORIGIN_VERIFY_SECRET;
  if (!secret) return 'ok';
  const got = request.headers.get('x-origin-verify') ?? '';
  // Node hands header values over as latin1; re-encoding them as UTF-8 would
  // make any secret with a byte over 0x7F unmatchable and 403 the whole site.
  const a = Buffer.from(got, 'latin1');
  const b = Buffer.from(secret, 'utf8');
  if (a.length === b.length && timingSafeEqual(a, b)) return 'ok';
  return ['1', 'true'].includes(process.env.ORIGIN_VERIFY_ENFORCE) ? 'block' : 'log';
}

// True ONLY when the origin lock is active AND this request carried the valid
// edge stamp — i.e. it genuinely came through Cloudflare. An unset secret
// (mirror / local dev) is not edge-proof, so it is never "verified edge".
function fromVerifiedEdge(request) {
  return !!process.env.ORIGIN_VERIFY_SECRET && originVerdict(request) === 'ok';
}

/* Client IP for rate-limit bucketing. cf-connecting-ip is Cloudflare's stamp
   and is only meaningful on a request that actually came through Cloudflare —
   so we trust it ONLY when the origin lock proves that. A direct-to-origin
   request (lock on but unstamped) gets the shared 'unknown' bucket rather
   than a self-chosen one. With the lock off (mirror), nginx overwrites
   x-forwarded-for with the real peer address, so the first hop is
   trustworthy and cf-connecting-ip — which a client could forge — is ignored
   entirely. This closes the CF-Connecting-IP spoof (audit H1). */
export function clientIp(request, astroClientAddress) {
  if (process.env.ORIGIN_VERIFY_SECRET) {
    if (fromVerifiedEdge(request)) {
      const cf = request.headers.get('cf-connecting-ip');
      if (cf) return cf;
    }
    // Locked but not edge-verified: trust no client-supplied IP header.
    return 'unknown';
  }
  // The literal 'unknown' fallback, not astroClientAddress: Astro's
  // clientAddress starts trusting x-forwarded-for if security.allowedDomains
  // is ever set, which would silently reopen the spoof this closes.
  return (
    request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
    astroClientAddress ||
    'unknown'
  );
}

// Serialise a value for embedding inside a <script> tag via set:html. Only "<"
// can begin a "</script>" that would break out of the tag, so escaping it (and
// the two JS line terminators) makes the JSON inert as markup while staying
// valid JSON and valid JS. Use this for EVERY set:html JSON blob.
export function scriptJson(value) {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function validEmail(email) {
  return typeof email === 'string' && email.length <= 254 && EMAIL_RE.test(email);
}

// Cross-site writes are already blocked by the session cookie's SameSite=Lax;
// this closes the loop explicitly since Astro's own checkOrigin is off (it
// misfires behind the proxy). Only a PRESENT mismatched Origin is rejected:
// same-origin non-browser clients may omit the header entirely.
export function crossOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  const expected = process.env.BETTER_AUTH_URL || process.env.SITE_URL;
  if (!expected) return false;
  try {
    return new URL(origin).origin !== new URL(expected).origin;
  } catch {
    return true;
  }
}

// Accepts JSON or classic form posts, so the forms work without JS too.
export async function readBody(request) {
  const type = request.headers.get('content-type') || '';
  if (type.includes('application/json')) return await request.json();
  const form = await request.formData();
  return Object.fromEntries(form.entries());
}
