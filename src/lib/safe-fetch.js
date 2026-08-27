/* SSRF-safe HTTPS fetch for attacker-supplied URLs (challenge entry pages and
   their og:images). The whole point of this module is that the address we
   VALIDATE is the address we CONNECT to — no resolve-then-connect gap a DNS
   rebind can slip through.

   How the pin works: node's https.request takes a `lookup` hook that the
   socket calls to turn the hostname into an address. Ours resolves, rejects
   the request if ANY answer is a private/reserved address, and hands back a
   vetted address. Because the socket connects to exactly what the hook
   returns (while still using the hostname for SNI and cert validation),
   there is no second, unchecked resolution to rebind against.

   Layers, not alternatives:
   - scheme/host/port screening happens in parsePublicUrl (caller's job) —
     https only, no credentials, no IP literals, and here we add a 443-only
     port rule;
   - the pinned lookup rejects loopback / RFC1918 / link-local / CGNAT /
     metadata / IPv6 ULA / v4-mapped equivalents, per hop;
   - redirects are walked by the caller, each Location re-screened before its
     own pinned connect;
   - reads are capped at a decoded-byte budget and the whole thing under a
     hard deadline. */
import https from 'node:https';
import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

function privateV4(ip) {
  const o = ip.split('.').map(Number);
  if (o.length !== 4 || o.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return true;
  return (
    o[0] === 0 || o[0] === 10 || o[0] === 127 ||
    (o[0] === 100 && o[1] >= 64 && o[1] <= 127) || // CGNAT
    (o[0] === 169 && o[1] === 254) ||              // link-local + cloud metadata
    (o[0] === 172 && o[1] >= 16 && o[1] <= 31) ||
    (o[0] === 192 && o[1] === 168) ||
    o[0] >= 224                                    // multicast + reserved
  );
}

export function privateAddress(ip) {
  if (isIP(ip) === 4) return privateV4(ip);
  const v6 = ip.toLowerCase().replace(/%.*$/, ''); // drop zone id
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return privateV4(mapped[1]);
  return (
    v6 === '::' || v6 === '::1' ||
    v6.startsWith('fc') || v6.startsWith('fd') || // ULA
    v6.startsWith('fe8') || v6.startsWith('fe9') ||
    v6.startsWith('fea') || v6.startsWith('feb') || // link-local
    v6.startsWith('ff') // multicast
  );
}

// The pinned lookup: resolve, reject if ANY resolved address is private
// (a mix of public and private answers is itself a rebind tell), hand back
// a single vetted address. Rejecting-if-any keeps a hostile resolver from
// hiding an internal address behind a public one across retries.
function pinnedLookup(hostname, options, callback) {
  dnsLookup(hostname, { all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses || addresses.length === 0) return callback(new Error('no address'));
    // Reject if ANY answer is private — a mix is itself a rebind tell.
    for (const a of addresses) {
      if (privateAddress(a.address)) {
        return callback(new Error(`blocked private address for ${hostname}`));
      }
    }
    // net.connect calls this with { all: true } and expects the array back;
    // other callers expect a single (address, family). Honor both — the
    // vetted set is what gets connected to either way.
    if (options && options.all) return callback(null, addresses);
    const family = options && options.family;
    const chosen = (family && addresses.find((a) => a.family === family)) || addresses[0];
    callback(null, chosen.address, chosen.family);
  });
}

/* One HTTPS GET, connection pinned, no redirect following. Resolves to
   { status, location, contentType, body } — body is a decoded Buffer (null
   for non-2xx or when skipBody). Rejects on any transport error, blocked
   address, timeout, or byte-cap trip that couldn't complete cleanly. */
function pinnedGet(url, { maxBytes, timeoutMs, headers, skipBody }) {
  return new Promise((resolve, reject) => {
    // Port policy: https default only. parsePublicUrl allows arbitrary ports
    // (e.g. evil.com:22); a contest entry page has no business on another.
    if (url.port && url.port !== '443') {
      return reject(new Error(`non-standard port ${url.port}`));
    }

    const req = https.request(
      url,
      {
        method: 'GET',
        lookup: pinnedLookup,
        servername: url.hostname, // SNI + cert validation stay on the name
        headers: { ...headers, Host: url.host },
        timeout: timeoutMs,
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const location = res.headers.location ?? null;
        const contentType = res.headers['content-type'] ?? '';

        if (skipBody || status < 200 || status >= 300) {
          res.destroy();
          return resolve({ status, location, contentType, body: null });
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            chunks.push(chunk.subarray(0, chunk.length - (size - maxBytes)));
            res.destroy(); // cap hit — stop reading, keep what we have
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ status, location, contentType, body: Buffer.concat(chunks) }));
        res.on('close', () => resolve({ status, location, contentType, body: Buffer.concat(chunks) }));
        res.on('error', reject);
      }
    );

    // Overall deadline (https `timeout` is idle-only): a slowloris that
    // dribbles bytes forever still dies here.
    const deadline = setTimeout(() => req.destroy(new Error('deadline')), timeoutMs);
    req.on('timeout', () => req.destroy(new Error('idle timeout')));
    req.on('error', (e) => { clearTimeout(deadline); reject(e); });
    req.on('close', () => clearTimeout(deadline));
    req.end();
  });
}

/* Walk a URL to its final destination, every hop pinned and pre-screened.
   `screen(nextUrl)` is the caller's per-hop URL policy (parsePublicUrl) — it
   returns a vetted URL object or null. Returns
   { finalUrl, status, contentType, body } or null on any refusal/error. */
export async function safeFetch(startUrl, { screen, maxBytes, timeoutMs, maxHops = 3, headers = {}, skipBody = false } = {}) {
  let current = startUrl;
  const started = Date.now();
  for (let hop = 0; hop <= maxHops; hop += 1) {
    const remaining = timeoutMs - (Date.now() - started);
    if (remaining <= 0) return null;
    let res;
    try {
      res = await pinnedGet(current, { maxBytes, timeoutMs: remaining, headers, skipBody });
    } catch {
      return null; // blocked address, transport error, timeout — all silent
    }
    if (res.status >= 300 && res.status < 400) {
      if (!res.location || hop === maxHops) return null;
      let nextRaw;
      try {
        nextRaw = new URL(res.location, current.href).href;
      } catch {
        return null;
      }
      const next = screen(nextRaw);
      if (!next) return null; // a hop that fails the policy ends the walk
      current = next;
      continue;
    }
    return { finalUrl: current, status: res.status, contentType: res.contentType, body: res.body };
  }
  return null;
}
