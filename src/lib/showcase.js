/* Model showcase ingest (/built-with/<model>). Turns a list of X post URLs
   into model_demos rows: text, author, avatar and the best media, pulled
   server-side from the syndication endpoint (richest data, no key) and
   fxtwitter (bitrates, sizes, views), then self-hosted on R2 so a visitor
   never loads anything from X. Without R2 (the mirror) the remote URLs are
   kept so the page can still render for review; production self-hosts.
   Shared by scripts/ingest-demos.mjs and /api/showcase/admin. */
import sharp from 'sharp';
import { newId, parsePublicUrl } from './builds.js';
import { safeFetch } from './safe-fetch.js';
import { r2Configured, r2Put, r2PublicUrl } from './r2.js';
import { insertModelDemo, modelDemoBySource, updateModelDemo } from './db.js';
import { showcaseModel } from './models.js';

export const X_STATUS_RE = /^https?:\/\/(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{5,25})/i;
export const DEMO_ID_RE = /^md_[a-z2-9]{10}$/;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36';
const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const TEXT_MAX = 280;

export function parseXUrl(raw) {
  const m = X_STATUS_RE.exec(String(raw ?? '').trim());
  if (!m) return null;
  return { handle: m[1], id: m[2], canonical: `https://x.com/${m[1]}/status/${m[2]}` };
}

/* The react-tweet token formula. Any non-empty token is accepted upstream;
   this one just matches what the widget itself sends. */
const syndToken = (id) => ((Number(id) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');

async function getJson(url, timeoutMs = 12000) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } catch {
    return { status: 0, json: null };
  }
}

export async function fetchSyndication(id) {
  const { status, json } = await getJson(`https://cdn.syndication.twimg.com/tweet-result?id=${id}&token=${syndToken(id)}`);
  if (status !== 200 || !json || !json.id_str) return null;
  return json;
}

// fxtwitter: a first 404 on a not-yet-cached post is transient; retry once.
export async function fetchFx(id) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const { status, json } = await getJson(`https://api.fxtwitter.com/status/${id}`);
    if (status === 200 && json?.tweet) return json.tweet;
    if (status !== 404) break;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return null;
}

/* Short, editable text: the post minus its trailing t.co links, whitespace
   collapsed, capped. Curators can rewrite it later through the admin API. */
export function cleanText(raw) {
  return String(raw ?? '')
    .replace(/https?:\/\/t\.co\/\w+/g, '')
    .replace(/[​-‏‪-‮⁠-⁯﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, TEXT_MAX);
}

/* Best media for a card: the highest-bitrate mp4 that fits the size budget
   (poster = the video thumbnail), else the first photo. GIFs arrive as mp4
   too and are flagged so the card can loop them. */
export function pickMedia(synd, fx) {
  const details = synd?.mediaDetails?.[0] ?? null;
  const fxMedia = fx?.media?.all?.[0] ?? null;
  const type = details?.type ?? (fxMedia?.type === 'video' ? 'video' : fxMedia?.type === 'gif' ? 'animated_gif' : fxMedia?.type === 'photo' ? 'photo' : null);
  if (!type) return { kind: 'none' };

  const width = details?.original_info?.width ?? fxMedia?.width ?? null;
  const height = details?.original_info?.height ?? fxMedia?.height ?? null;

  if (type === 'video' || type === 'animated_gif') {
    const durationS = (details?.video_info?.duration_millis ?? 0) / 1000 || fxMedia?.duration || 0;
    const fxFormats = (fx?.media?.videos?.[0]?.formats ?? fxMedia?.formats ?? [])
      .filter((f) => f.container === 'mp4' && f.url && typeof f.bitrate === 'number')
      .sort((a, b) => b.bitrate - a.bitrate);
    let chosen = null;
    for (const f of fxFormats) {
      const estBytes = durationS > 0 ? (f.bitrate * durationS) / 8 : 0;
      if (!estBytes || estBytes <= MAX_VIDEO_BYTES) {
        chosen = f.url;
        break;
      }
    }
    if (!chosen) {
      // syndication lists variants in ascending size without bitrates; the
      // last mp4 is the largest, the one before it the safer pick.
      const mp4s = (synd?.video?.variants ?? []).filter((v) => v.type === 'video/mp4' && v.src).map((v) => v.src);
      chosen = mp4s.length > 1 ? mp4s[mp4s.length - 2] : mp4s[0] ?? fxMedia?.url ?? null;
    }
    if (!chosen) return { kind: 'none' };
    return {
      kind: type === 'animated_gif' ? 'gif' : 'video',
      url: chosen,
      poster: details?.media_url_https ?? fxMedia?.thumbnail_url ?? null,
      width,
      height,
    };
  }

  const photo = synd?.photos?.[0] ?? null;
  const url = photo?.url ?? fx?.media?.photos?.[0]?.url ?? fxMedia?.url ?? null;
  if (!url) return { kind: 'none' };
  return { kind: 'image', url, poster: null, width: photo?.width ?? width, height: photo?.height ?? height };
}

/* ---------- self-hosting (R2 when configured, remote URL otherwise) ---------- */

const screenHop = (raw) => parsePublicUrl(raw, { maxLen: 600 });

async function fetchBytes(url, maxBytes, timeoutMs) {
  let start;
  try {
    start = new URL(url);
  } catch {
    return null;
  }
  const res = await safeFetch(start, {
    screen: screenHop,
    maxBytes,
    timeoutMs,
    maxHops: 3,
    headers: { 'User-Agent': UA, Accept: '*/*' },
  });
  if (!res || !res.body) return null;
  return res;
}

async function hostImage(url, key, { w, h, fit = 'inside' }) {
  if (!url) return null;
  if (!r2Configured()) return { url, hosted: false };
  try {
    const res = await fetchBytes(url, MAX_IMAGE_BYTES, 15000);
    if (!res || !res.contentType.startsWith('image/')) return { url, hosted: false };
    const out = await sharp(res.body, { failOn: 'error', limitInputPixels: 40_000_000 })
      .rotate()
      .resize(w, h, { fit, withoutEnlargement: true })
      .webp({ quality: 84 })
      .toBuffer();
    await r2Put(key, out, 'image/webp');
    return { url: r2PublicUrl(key), hosted: true };
  } catch {
    return { url, hosted: false };
  }
}

async function hostVideo(url, key) {
  if (!url) return null;
  if (!r2Configured()) return { url, hosted: false };
  try {
    const res = await fetchBytes(url, MAX_VIDEO_BYTES + 512 * 1024, 90000);
    if (!res || !/video\/mp4|application\/octet-stream/.test(res.contentType)) return { url, hosted: false };
    await r2Put(key, res.body, 'video/mp4');
    return { url: r2PublicUrl(key), hosted: true };
  } catch {
    return { url, hosted: false };
  }
}

/* ---------- one URL → one row ---------- */

export async function ingestXUrl({ modelSlug, url, order, dryRun = false }) {
  const parsed = parseXUrl(url);
  if (!parsed) return { url, ok: false, error: 'not an x.com status url' };
  const { id, canonical } = parsed;

  const [synd, fx] = await Promise.all([fetchSyndication(id), fetchFx(id)]);
  if (!synd && !fx) return { url, ok: false, error: 'post not reachable (syndication and fxtwitter both failed)' };

  const handle = synd?.user?.screen_name ?? fx?.author?.screen_name ?? parsed.handle;
  const name = synd?.user?.name ?? fx?.author?.name ?? null;
  const avatarRemote = (synd?.user?.profile_image_url_https ?? fx?.author?.avatar_url ?? '').replace('_normal.', '_200x200.') || null;
  const text = cleanText(synd?.text ?? fx?.text ?? '');
  const media = pickMedia(synd, fx);

  const summary = { url: canonical, id, handle, kind: media.kind, width: media.width, height: media.height, text: text.slice(0, 80) };
  if (dryRun) return { ...summary, ok: true, dryRun: true };

  const avatar = await hostImage(avatarRemote, `showcase/avatars/${handle.toLowerCase()}.webp`, { w: 96, h: 96, fit: 'cover' });
  let mediaUrl = null;
  let posterUrl = null;
  let hosted = false;
  if (media.kind === 'image') {
    const img = await hostImage(media.url, `showcase/${modelSlug}/${id}.webp`, { w: 1600, h: 1600 });
    mediaUrl = img?.url ?? null;
    hosted = !!img?.hosted;
  } else if (media.kind === 'video' || media.kind === 'gif') {
    const [vid, poster] = await Promise.all([
      hostVideo(media.url, `showcase/${modelSlug}/${id}.mp4`),
      hostImage(media.poster, `showcase/${modelSlug}/${id}-poster.webp`, { w: 1600, h: 1600 }),
    ]);
    mediaUrl = vid?.url ?? null;
    posterUrl = poster?.url ?? null;
    hosted = !!vid?.hosted;
  }

  const now = Date.now();
  const existing = await modelDemoBySource(modelSlug, 'x', id);
  const fields = {
    author_handle: handle,
    author_name: name,
    author_avatar_url: avatar?.url ?? null,
    media_kind: mediaUrl ? media.kind : 'none',
    media_url: mediaUrl,
    poster_url: posterUrl,
    width: media.width ?? null,
    height: media.height ?? null,
    featured_order: order,
    fetched_at: now,
  };
  if (existing) {
    // Re-ingest refreshes media and order; curated text is never overwritten.
    await updateModelDemo(existing.id, { ...fields, ...(existing.text ? {} : { text }) });
    return { ...summary, ok: true, action: 'update', demoId: existing.id, hosted };
  }
  const demoId = newId('md');
  await insertModelDemo({
    id: demoId,
    model_slug: modelSlug,
    source: 'x',
    source_url: canonical,
    source_id: id,
    text,
    status: 'live',
    created_at: now,
    updated_at: now,
    ...fields,
  });
  return { ...summary, ok: true, action: 'insert', demoId, hosted };
}

/* The batch: line order = featured order, one failure never stops the rest. */
export async function ingestUrls({ model, urls, dryRun = false, log = () => {} }) {
  const m = showcaseModel(model);
  if (!m) throw new Error(`unknown showcase model: ${model}`);
  const results = [];
  let order = 0;
  for (const raw of urls) {
    const url = String(raw).trim();
    if (!url || url.startsWith('#')) continue;
    order += 1;
    try {
      const r = await ingestXUrl({ modelSlug: m.slug, url, order, dryRun });
      results.push(r);
      log(`${r.ok ? 'ok ' : 'ERR'} #${order} ${url} ${r.ok ? `${r.kind}${r.hosted === false ? ' (remote media, R2 off)' : ''}` : r.error}`);
    } catch (err) {
      results.push({ url, ok: false, error: err.message });
      log(`ERR #${order} ${url} ${err.message}`);
    }
  }
  return results;
}
