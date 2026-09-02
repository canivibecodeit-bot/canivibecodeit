/* The HTTP side of a sponsor icon upload, shared by /api/sponsor/icon and
   /api/thebuildgames/icon. Each route supplies three callbacks:

     resolve(fields) -> { subject, keyStem } | { error, status }
       token -> row, with the same editability rules as that surface's
       details save. keyStem is built from server ids only.
     apply(subject, url) -> { icon_url } | { error, status }
       persist the hosted URL, bust any board cache.
     revert(subject) -> { icon_url }
       recompute the surface's default (favicon-derived) and persist it.

   What the shared layer enforces, in order: browser-only same-origin (an
   Origin or Referer that matches the site, nothing else accepted), per-IP
   rate limit, a hard body cap enforced while streaming (not after
   buffering), multipart parse, token presence, per-token rate limit, then
   the route's resolve. Only then are the bytes looked at (sponsor-icon.js).
   Rejections are logged with the reason and never with the file. */
import { createHash } from 'node:crypto';
import { rateLimit } from './db.js';
import { clientIp, json } from './request.js';
import { ICON_MAX_BYTES, hostIcon } from './sponsor-icon.js';

const BODY_CAP = ICON_MAX_BYTES + 64 * 1024; // the file plus multipart framing
const PER_HOUR = 10;
const HOUR = 60 * 60 * 1000;

function siteOrigin() {
  const expected = process.env.BETTER_AUTH_URL || process.env.SITE_URL;
  if (!expected) return null;
  try {
    return new URL(expected).origin;
  } catch {
    return null;
  }
}

/* Stricter than crossOrigin(): this endpoint only ever serves our own pages,
   so a request that names no origin at all (Origin and Referer both absent)
   is refused too. With no site URL configured (bare local dev) the check is
   moot and passes. */
export function sameOriginBrowser(request) {
  const site = siteOrigin();
  if (!site) return true;
  const origin = request.headers.get('origin');
  const referer = request.headers.get('referer');
  const source = origin || referer;
  if (!source) return false;
  try {
    return new URL(source).origin === site;
  } catch {
    return false;
  }
}

/* Read the body up to `cap` bytes; returns null the moment it goes over,
   cancelling the stream so nothing more is buffered. */
export async function readCapped(request, cap) {
  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > cap) return null;
  if (!request.body) return Buffer.alloc(0);
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > cap) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

const tokenKey = (token) => createHash('sha256').update(token).digest('base64url').slice(0, 22);

export function iconEndpoint({ surface, resolve, apply, revert }) {
  const reject = (reason, status, error = reason) => {
    console.warn(`icon upload rejected (${surface}): ${reason}`);
    return json({ error }, status);
  };

  return async function POST({ request, clientAddress }) {
    if (!sameOriginBrowser(request)) return reject('bad origin', 403);

    const ip = clientIp(request, clientAddress);
    if (!(await rateLimit(`icon:ip:${ip}`, PER_HOUR, HOUR))) return reject('rate limited (ip)', 429, 'slow down');

    const type = request.headers.get('content-type') || '';
    if (!type.startsWith('multipart/form-data')) return reject('not multipart', 400, 'bad request');

    const raw = await readCapped(request, BODY_CAP);
    if (raw === null) return reject('body over cap', 413, 'that file is over 2MB');

    let form;
    try {
      form = await new Response(raw, { headers: { 'content-type': type } }).formData();
    } catch {
      return reject('multipart parse failed', 400, 'bad request');
    }

    const token = String(form.get('token') ?? '').replaceAll('\0', '').trim();
    if (!token || token.length > 128) return reject('no token', 404, 'not found');
    if (!(await rateLimit(`icon:t:${tokenKey(token)}`, PER_HOUR, HOUR))) {
      return reject('rate limited (token)', 429, 'slow down');
    }

    const resolved = await resolve({ token });
    if (resolved.error) return reject(`resolve: ${resolved.error}`, resolved.status, resolved.error);
    const { subject, keyStem } = resolved;

    if (String(form.get('action') ?? '') === 'revert') {
      const out = await revert(subject);
      return json({ ok: true, reverted: true, icon_url: out.icon_url ?? null });
    }

    const file = form.get('file');
    if (!file || typeof file.arrayBuffer !== 'function') return reject('no file', 400, 'choose a file first');
    if (file.size > ICON_MAX_BYTES) return reject('file over cap', 413, 'that file is over 2MB');

    let hosted;
    try {
      hosted = await hostIcon(Buffer.from(await file.arrayBuffer()), keyStem);
    } catch (err) {
      console.error(`icon upload failed (${surface}): ${err?.message || err}`);
      return json({ error: 'could not store the icon, try again' }, 502);
    }
    if (!hosted.ok) return reject(hosted.error, hosted.status);

    const applied = await apply(subject, hosted.url);
    if (applied.error) return reject(`apply: ${applied.error}`, applied.status, applied.error);
    return json({ ok: true, icon_url: applied.icon_url, kind: hosted.kind });
  };
}
