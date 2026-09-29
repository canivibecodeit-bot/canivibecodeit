/* Flood guard: keeps a burst of requests from costing a render each, without
   ever changing what a visitor gets in normal traffic.

   What it is for. The home page takes recurring bursts: thousands of
   requests in a few minutes from dozens of sources wearing browser agents,
   every one abandoned after about ten seconds. Each cost a full render of
   the largest page on the site, and real visitors queued behind them.

   The rule that shapes everything here: a real visitor must never be
   worse off, a very enthusiastic one included. So:

   1. A copy of each hot page is KEPT after every anonymous render, but it
      is only SERVED while that page is under pressure. In calm traffic
      every request renders exactly as before, so votes, approvals and live
      figures show up at once, as they always have.
   2. Pressure means: several renders of the same page already in flight,
      or far more requests for it in a few seconds than people produce.
      Then the copy (at most TTL old) is served from memory, and requests
      that arrive before a first copy exists wait for the render already
      running instead of starting their own.
   3. Only as a backstop, one address asking for an absurd number of pages
      is told to slow down (429 with Retry-After). The limit sits far above
      anything measured from a person, prefetches included.

   Counting is untouched. A render logs impressions through the components
   it contains; each of them also notes what it counted in
   `locals.counted`, that note is kept with the copy, and serving the copy
   logs the same impressions through the same functions with the agent of
   the request being served. A served copy counts exactly as its render
   would have.

   Never kept or served: anything but GET, any query string, signed-in
   visitors and anything carrying a session or admin cookie, every page
   outside the hot list below (admin, sponsor pages, forms, accounts,
   tokens, per-visitor pages), any response that is not a plain 200 HTML
   page or that sets a cookie.

   FLOOD_GUARD=0 turns the whole thing off without a deploy. */
import { getApp } from './apps.js';
import { recordImpressions } from './impressions.js';
import { countImpression } from './rec.js';
import { clientIp } from './request.js';
import { countTapImpression } from './tap.js';

const num = (name, fallback) => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

export function floodConfig() {
  return {
    enabled: process.env.FLOOD_GUARD !== '0',
    // How old a served copy may be.
    ttlMs: num('FLOOD_TTL_MS', 45 * 1000),
    // While a page stays under pressure and its refresh is still running.
    staleMs: num('FLOOD_STALE_MS', 120 * 1000),
    // Pressure: this many renders of one page in flight...
    busyInflight: num('FLOOD_BUSY_INFLIGHT', 4),
    // ...or this many requests for it inside the window.
    busyRequests: num('FLOOD_BUSY_REQUESTS', 40),
    busyWindowMs: num('FLOOD_BUSY_WINDOW_MS', 10 * 1000),
    // How long a request waits for a render already running.
    waitMs: num('FLOOD_WAIT_MS', 8 * 1000),
    maxEntries: num('FLOOD_MAX_ENTRIES', 300),
    maxBytes: num('FLOOD_MAX_BYTES', 64 * 1024 * 1024),
    // Backstop per address. Measured from a browser driven faster than a
    // person can click: 256 page requests a minute, prefetches included;
    // a pointer swept down the list: 410 a minute, and a page holds about
    // 1,100 links in all. 3,000 in five minutes is ten a second, sustained.
    limitRequests: num('FLOOD_LIMIT_REQUESTS', 3000),
    limitWindowMs: num('FLOOD_LIMIT_WINDOW_MS', 5 * 60 * 1000),
  };
}

/* ---------- which pages ---------- */

const FIXED = new Set(['/', '/categories', '/alternatives']);
const SLUG = '[a-z0-9][a-z0-9-]{0,80}';
const CATEGORY_RE = new RegExp(`^/category/${SLUG}$`);
const ALTERNATIVE_RE = new RegExp(`^/alternative/${SLUG}$`);
const APP_RE = new RegExp(`^/(${SLUG})(/alternatives)?$`);

// The public directory pages: the same HTML for every anonymous visitor.
export function isHotPage(pathname, appExists = (slug) => !!getApp(slug)) {
  if (typeof pathname !== 'string') return false;
  if (FIXED.has(pathname)) return true;
  if (CATEGORY_RE.test(pathname) || ALTERNATIVE_RE.test(pathname)) return true;
  const m = APP_RE.exec(pathname);
  return !!m && appExists(m[1]);
}

const PRIVATE_COOKIE = /session_token|bg_admin/;

// A page request the guard looks at at all (pressure and backstop).
export function isPageRequest(method, pathname) {
  return method === 'GET' && !pathname.startsWith('/api/') && !pathname.startsWith('/ph/') && !pathname.includes('.');
}

// The key a copy is kept under, or null when this request must render.
export function copyKey({ method, pathname, search, cookie, signedIn }, appExists) {
  if (method !== 'GET' || search) return null;
  if (signedIn || PRIVATE_COOKIE.test(cookie || '')) return null;
  return isHotPage(pathname, appExists) ? pathname : null;
}

/* ---------- pressure ---------- */

const pages = new Map(); // key -> state

function stateOf(key) {
  let st = pages.get(key);
  if (!st) {
    st = { inflight: 0, bucketAt: 0, bucket: 0, prev: 0, copy: null, pending: null };
    pages.set(key, st);
  }
  return st;
}

// Requests inside the window, from two buckets so it slides.
export function noteRequest(st, now, windowMs) {
  const at = Math.floor(now / windowMs) * windowMs;
  if (at !== st.bucketAt) {
    st.prev = at - st.bucketAt === windowMs ? st.bucket : 0;
    st.bucket = 0;
    st.bucketAt = at;
  }
  st.bucket += 1;
  const into = (now - at) / windowMs;
  return st.bucket + st.prev * (1 - into);
}

export function underPressure(st, recent, cfg) {
  return st.inflight >= cfg.busyInflight || recent >= cfg.busyRequests;
}

/* ---------- copies ---------- */

let heldBytes = 0;

function drop(key) {
  const st = pages.get(key);
  if (st?.copy) {
    heldBytes -= st.copy.body.byteLength;
    st.copy = null;
  }
}

function keep(key, copy, cfg) {
  drop(key);
  const st = stateOf(key);
  st.copy = copy;
  heldBytes += copy.body.byteLength;
  if (heldBytes <= cfg.maxBytes && copiesHeld() <= cfg.maxEntries) return;
  // Oldest first; the page under pressure is by definition the newest.
  const held = [...pages.entries()].filter(([, s]) => s.copy).sort((a, b) => a[1].copy.at - b[1].copy.at);
  for (const [k] of held) {
    if (heldBytes <= cfg.maxBytes && copiesHeld() <= cfg.maxEntries) break;
    if (k !== key) drop(k);
  }
}

const copiesHeld = () => {
  let n = 0;
  for (const s of pages.values()) if (s.copy) n += 1;
  return n;
};

/* Serving a copy counts what its render counted, through the same
   functions, with the agent of the request being served. */
function recount(counted, userAgent) {
  for (const c of counted) {
    if (c.k === 'sponsor') recordImpressions(c.ids, userAgent);
    else if (c.k === 'rec') countImpression(c.src);
    else if (c.k === 'tap') countTapImpression(c.placement, userAgent);
  }
}

function serve(copy, request) {
  recount(copy.counted, request.headers.get('user-agent'));
  const headers = new Headers(copy.headers);
  headers.set('X-Served', 'copy');
  return new Response(copy.body, { status: 200, headers });
}

/* ---------- backstop ---------- */

const addresses = new Map(); // ip -> { at, n }

export function overLimit(ip, now, cfg, table = addresses) {
  if (!ip || ip === 'unknown') return 0; // never a shared bucket
  const at = Math.floor(now / cfg.limitWindowMs) * cfg.limitWindowMs;
  let row = table.get(ip);
  if (!row || row.at !== at) {
    row = { at, n: 0 };
    table.set(ip, row);
    if (table.size > 50000) for (const [k, v] of table) if (v.at !== at) table.delete(k);
  }
  row.n += 1;
  if (row.n <= cfg.limitRequests) return 0;
  return Math.max(1, Math.ceil((at + cfg.limitWindowMs - now) / 1000));
}

function slowDown(seconds) {
  return new Response('Too many requests. Please try again shortly.\n', {
    status: 429,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Retry-After': String(seconds), 'Cache-Control': 'no-store' },
  });
}

/* ---------- the guard ---------- */

export async function guardPage(context, render) {
  const cfg = floodConfig();
  const { request, url } = context;
  if (!cfg.enabled || context.isPrerendered || !isPageRequest(request.method, url.pathname)) return render();

  const now = Date.now();
  const wait = overLimit(clientIp(request, context.clientAddress), now, cfg);
  if (wait) return slowDown(wait);

  const key = copyKey({
    method: request.method,
    pathname: url.pathname,
    search: url.search,
    cookie: request.headers.get('cookie'),
    signedIn: !!context.locals.user,
  });
  if (!key) return render();

  const st = stateOf(key);
  const recent = noteRequest(st, now, cfg.busyWindowMs);
  if (underPressure(st, recent, cfg)) {
    const age = st.copy ? now - st.copy.at : Infinity;
    if (age <= cfg.ttlMs || (age <= cfg.staleMs && st.inflight > 0)) return serve(st.copy, request);
    if (st.pending) {
      const copy = await Promise.race([st.pending, new Promise((r) => setTimeout(r, cfg.waitMs, null))]);
      if (copy) return serve(copy, request);
    }
  }

  // Render, exactly as before, and keep a copy on the side.
  context.locals.counted = [];
  let settle;
  if (!st.pending) {
    st.pending = new Promise((r) => (settle = r));
  }
  st.inflight += 1;
  const finish = (copy) => {
    st.inflight -= 1;
    if (settle) {
      st.pending = null;
      settle(copy);
    }
  };

  let res;
  try {
    res = await render();
  } catch (err) {
    finish(null);
    throw err;
  }
  const keepable =
    res.status === 200 &&
    res.body &&
    (res.headers.get('Content-Type') || '').includes('text/html') &&
    !res.headers.has('Set-Cookie');
  if (!keepable) {
    finish(null);
    return res;
  }

  // The visitor's stream is untouched; the second branch fills the copy,
  // and keeps being read even if the visitor hangs up.
  const [toVisitor, toCopy] = res.body.tee();
  const headers = [...res.headers.entries()];
  (async () => {
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of toCopy) {
        chunks.push(chunk);
        size += chunk.byteLength;
        if (size > cfg.maxBytes / 4) throw new Error('page too large to keep');
      }
      const body = new Uint8Array(size);
      let at = 0;
      for (const c of chunks) {
        body.set(c, at);
        at += c.byteLength;
      }
      const copy = { body, headers, counted: [...(context.locals.counted || [])], at: Date.now() };
      keep(key, copy, cfg);
      finish(copy);
    } catch {
      finish(null);
    }
  })();
  return new Response(toVisitor, { status: res.status, statusText: res.statusText, headers: res.headers });
}

// For tests and the admin's peace of mind: nothing about who, only how much.
export function floodStats() {
  return { pages: pages.size, copies: copiesHeld(), bytes: heldBytes, addresses: addresses.size };
}

export function _reset() {
  pages.clear();
  addresses.clear();
  heldBytes = 0;
}
