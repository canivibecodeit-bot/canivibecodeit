/* Self-host an entry's og:image instead of hotlinking it (audit H5). A
   hotlinked image is attacker-controlled forever — swap what the URL serves
   after approval and every gallery visitor loads the new content live. So at
   submit time we fetch it ONCE through the SSRF-safe path, re-encode it with
   sharp (which drops any polyglot/container trickery), and store our own copy
   on R2. We serve only that copy; the entrant's host is never contacted by a
   visitor again.

   Mirror behaviour: R2 is unset here by design, so this returns null and the
   gallery falls back to the hostname tile — media-off, exactly as intended. */
import sharp from 'sharp';
import { parsePublicUrl } from './builds.js';
import { safeFetch } from './safe-fetch.js';
import { r2Configured, r2Put, r2PublicUrl } from './r2.js';

const MAX_IMAGE_BYTES = 3 * 1024 * 1024; // 3 MB off the wire
const FETCH_TIMEOUT = 8000;

const screenHop = (raw) => parsePublicUrl(raw, { maxLen: 500 });

/* Fetch, validate, re-encode, store. Returns the R2 public URL of our copy,
   or null (fetch failed, not an image, too big, or R2 not configured) — the
   caller then leaves og_image null and the fallback tile shows. */
export async function selfHostOgImage(ogUrl, entryId) {
  if (!r2Configured()) return null;

  let start;
  try {
    start = new URL(ogUrl);
  } catch {
    return null;
  }

  const res = await safeFetch(start, {
    screen: screenHop,
    maxBytes: MAX_IMAGE_BYTES,
    timeoutMs: FETCH_TIMEOUT,
    maxHops: 3,
    headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'image/*' },
  });
  if (!res || !res.body || !res.contentType.startsWith('image/')) return null;

  try {
    // Re-encode to a bounded WebP: normalises dimensions, strips metadata and
    // any non-image payload, and gives us a predictable content-type.
    const out = await sharp(res.body, { failOn: 'error', limitInputPixels: 24_000_000 })
      .rotate()
      .resize(1200, 630, { fit: 'cover', position: 'attention' })
      .webp({ quality: 80 })
      .toBuffer();
    const key = `challenge/${entryId}.webp`;
    await r2Put(key, out, 'image/webp');
    return r2PublicUrl(key);
  } catch {
    return null; // undecodable / hostile image → fallback tile
  }
}
