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

/* Generic: fetch an attacker-supplied image URL through the SSRF-safe path,
   re-encode with sharp (drops polyglot/container trickery), store on R2 under
   `key`. Returns the R2 public URL, or null (fetch failed, not an image, too
   big, undecodable, or R2 not configured → caller uses a fallback). `resize`
   is {w, h, fit}. */
export async function selfHostImage(rawUrl, key, resize) {
  if (!r2Configured()) return null;
  let start;
  try {
    start = new URL(rawUrl);
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
    const out = await sharp(res.body, { failOn: 'error', limitInputPixels: 24_000_000 })
      .rotate()
      .resize(resize.w, resize.h, { fit: resize.fit ?? 'cover', position: 'attention' })
      .webp({ quality: 82 })
      .toBuffer();
    await r2Put(key, out, 'image/webp');
    return r2PublicUrl(key);
  } catch {
    return null;
  }
}

// og:image for a challenge entry (1200x630 card).
export const selfHostOgImage = (ogUrl, entryId) =>
  selfHostImage(ogUrl, `challenge/${entryId}.webp`, { w: 1200, h: 630, fit: 'cover' });

// favicon/icon for a Build Games sponsor (small square).
export const selfHostSponsorIcon = (iconUrl, sponsorId) =>
  selfHostImage(iconUrl, `buildgames/${sponsorId}.webp`, { w: 96, h: 96, fit: 'cover' });
