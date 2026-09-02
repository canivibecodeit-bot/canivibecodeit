/* Sponsor icon uploads: the one place bytes a sponsor hands us are inspected,
   rendered and parked on R2. Used by both post-checkout details pages (the
   homepage sponsor card and the Build Games row).

   Trust model: the file is attacker-controlled. Nothing about it is believed:
   not the extension, not the declared Content-Type, not the dimensions in
   its header. The bytes are sniffed for a real signature, the header is
   read for a pixel count before any decode, the decode runs under sharp's
   failOn:'error' + limitInputPixels, and what gets stored is a fresh
   256x256 WebP that sharp produced (no metadata, no container tricks). SVG is
   accepted ONLY as a source to rasterise: the markup is screened (no script,
   no event handlers, no foreignObject, no external references, no doctype),
   rendered by librsvg, and the SVG bytes themselves are never stored or
   served. */
import sharp from 'sharp';
import { r2Configured, r2Put, r2PublicUrl } from './r2.js';

export const ICON_MAX_BYTES = 2 * 1024 * 1024;
export const ICON_MAX_PIXELS = 24_000_000; // 24 MP: a 4898x4898 square
export const ICON_SIZE = 256; // crisp at 2x for the biggest slot (56px)
export const ICON_ACCEPT = 'image/png,image/jpeg,image/webp,image/svg+xml';
export const ICON_HINT = 'square works best, at least 128px, under 2MB';

// Every rejection is one of these strings; the UI shows them verbatim.
export const ICON_ERRORS = {
  empty: 'that file is empty',
  size: 'that file is over 2MB',
  format: 'that is not a png, jpeg, webp or svg',
  pixels: 'that image is over 24 megapixels',
  decode: 'that file could not be decoded as an image',
  svgRoot: 'svg: the root element must be <svg>',
  svgDoctype: 'svg: doctype and entity declarations are not allowed',
  svgScript: 'svg: scripts are not allowed',
  svgHandler: 'svg: event handler attributes are not allowed',
  svgForeign: 'svg: foreignObject is not allowed',
  svgExternal: 'svg: external references are not allowed',
  svgParse: 'svg: not well-formed xml',
};

/* ---------- sniffing ---------- */

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sniffRaster(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)) return 'png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
  if (
    buf.length >= 12 &&
    buf.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buf.subarray(8, 12).toString('latin1') === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
}

/* Text that could be an SVG document: no NUL bytes, decodes as UTF-8, and
   the first non-blank character is '<'. Anything binary is not text. */
function asSvgText(buf) {
  if (buf.includes(0)) return null;
  let text = buf.toString('utf8');
  if (text.includes('�')) return null; // not valid UTF-8
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  return text.trimStart().startsWith('<') ? text : null;
}

/* Screen SVG markup. Comments are stripped before inspection so a comment
   can neither hide a tag nor fake one. Anything that would let the document
   run code, load a remote resource or embed HTML is rejected outright;
   only same-document fragment references (#id) survive. Well-formedness is
   settled by the actual parse in renderIcon (librsvg / libxml2). */
export function svgProblem(text) {
  const body = text.replace(/<!--[\s\S]*?-->/g, '');
  if (/<!DOCTYPE|<!ENTITY/i.test(body)) return ICON_ERRORS.svgDoctype;
  // Root element: skip the XML declaration and processing instructions, then
  // the first tag must be <svg.
  const afterProlog = body.replace(/^\s*(<\?[\s\S]*?\?>\s*)*/, '');
  if (!/^<svg[\s>]/i.test(afterProlog)) return ICON_ERRORS.svgRoot;
  // Tag names may carry any namespace prefix (svg:script, x:script) and
  // may self-close (<script/>); both forms are still the element.
  const tag = (name) => new RegExp(`<\\s*(?:[\\w.-]+:)?${name}(?=[\\s>/])`, 'i');
  if (tag('script').test(body)) return ICON_ERRORS.svgScript;
  if (/[\s"'/]on[a-z]+\s*=/i.test(body)) return ICON_ERRORS.svgHandler;
  if (tag('foreignObject').test(body)) return ICON_ERRORS.svgForeign;
  // href / xlink:href must be a fragment; url(...) in styles must be a
  // fragment; no javascript: anywhere; no HTML embeds.
  const hrefs = body.matchAll(/(?:xlink:)?href\s*=\s*(["'])([\s\S]*?)\1/gi);
  for (const m of hrefs) {
    if (!m[2].trim().startsWith('#')) return ICON_ERRORS.svgExternal;
  }
  const urls = body.matchAll(/url\s*\(\s*(["']?)([\s\S]*?)\1\s*\)/gi);
  for (const m of urls) {
    if (!m[2].trim().startsWith('#')) return ICON_ERRORS.svgExternal;
  }
  if (/javascript\s*:/i.test(body)) return ICON_ERRORS.svgScript;
  if (tag('(?:iframe|embed|object|meta|link|base)').test(body)) return ICON_ERRORS.svgExternal;
  if (/@import/i.test(body)) return ICON_ERRORS.svgExternal;
  return null;
}

/* Cheap checks first, in order: size, signature, then the header-declared
   pixel count (read without decoding). Returns { ok: true, kind } or
   { ok: false, error }. */
export async function inspectIcon(buf) {
  if (!buf || buf.length === 0) return { ok: false, error: ICON_ERRORS.empty };
  if (buf.length > ICON_MAX_BYTES) return { ok: false, error: ICON_ERRORS.size };
  let kind = sniffRaster(buf);
  if (!kind) {
    const text = asSvgText(buf);
    if (!text) return { ok: false, error: ICON_ERRORS.format };
    const problem = svgProblem(text);
    if (problem) return { ok: false, error: problem };
    kind = 'svg';
  }
  // Dimensions come from the container header only; a bomb is refused
  // before a single row is inflated. sharp's own limit backs this up.
  let meta;
  try {
    meta = await sharp(buf, { failOn: 'error', limitInputPixels: false, pages: 1 }).metadata();
  } catch {
    return { ok: false, error: kind === 'svg' ? ICON_ERRORS.svgParse : ICON_ERRORS.decode };
  }
  if (meta.format !== kind) return { ok: false, error: ICON_ERRORS.format };
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (w < 1 || h < 1) return { ok: false, error: ICON_ERRORS.decode };
  if (w * h > ICON_MAX_PIXELS) return { ok: false, error: ICON_ERRORS.pixels };
  return { ok: true, kind, width: w, height: h };
}

/* Decode, centre-crop to a square, resize to ICON_SIZE, emit WebP with no
   metadata. An SVG is rasterised at a density that makes its longer side at
   least 2x the output, so small viewBoxes come out crisp. Throws on any
   decode failure (the caller maps that to ICON_ERRORS.decode). */
export async function renderIcon(buf, info) {
  const opts = { failOn: 'error', limitInputPixels: ICON_MAX_PIXELS, pages: 1 };
  if (info.kind === 'svg') {
    const longest = Math.max(info.width, info.height, 1);
    // metadata() reports SVG size at 72 dpi; scale so the render is large.
    opts.density = Math.min(2400, Math.max(72, Math.ceil((72 * ICON_SIZE * 2) / longest)));
  }
  return sharp(buf, opts)
    .rotate()
    .resize(ICON_SIZE, ICON_SIZE, { fit: 'cover', position: 'centre' })
    .webp({ quality: 88 })
    .toBuffer();
}

/* Full path: inspect, render, store. `keyStem` is built by the caller from
   server-side ids only ([a-z0-9_-]); the timestamp versions the object so the
   immutable edge cache never serves a stale icon after a replacement.
   Returns { ok: true, url, key } or { ok: false, error, status }. */
export async function hostIcon(buf, keyStem) {
  const info = await inspectIcon(buf);
  if (!info.ok) return { ok: false, error: info.error, status: 400 };
  if (!/^[a-z0-9_/-]+$/.test(keyStem)) throw new Error('hostIcon: bad key stem');
  let out;
  try {
    out = await renderIcon(buf, info);
  } catch {
    return { ok: false, error: ICON_ERRORS.decode, status: 400 };
  }
  if (!r2Configured()) {
    return { ok: false, error: 'icon storage is not configured on this deployment', status: 503 };
  }
  const key = `${keyStem}-${Date.now()}.webp`;
  await r2Put(key, out, 'image/webp');
  return { ok: true, url: r2PublicUrl(key), key, kind: info.kind };
}

/* Is this URL one of ours (an icon we hosted under `prefix`)? Used so a
   later details save keeps an uploaded icon instead of recomputing the
   favicon over it. */
export function hostedIconUrl(url, prefix) {
  const base = process.env.R2_PUBLIC_BASE;
  if (!base || !url) return false;
  return String(url).startsWith(`${base}/${prefix}/`);
}
