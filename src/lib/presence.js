/* "N people here right now" — in-process presence, no third party. Each HTML
   page render touches a hashed-IP key; the count is distinct keys seen in the
   last few minutes. Honest by construction (real visitors, short window) and
   deliberately cheap: one Map, pruned inline, resets on restart. The site
   runs as a single process, so this is exact — if that ever changes it
   degrades to per-instance counts, which is still honest per instance. */
import { createHash } from 'node:crypto';

const WINDOW_MS = 5 * 60 * 1000;
const seen = new Map(); // hash → last-seen ms

export function touchPresence(ip) {
  if (!ip || ip === 'unknown') return;
  const key = createHash('sha256').update(`presence:${ip}`).digest('hex').slice(0, 16);
  const now = Date.now();
  seen.set(key, now);
  // Amortised prune: keep the map bounded without a timer.
  if (seen.size > 5000) {
    for (const [k, t] of seen) if (now - t > WINDOW_MS) seen.delete(k);
  }
}

export function onlineCount(now = Date.now()) {
  let n = 0;
  for (const [k, t] of seen) {
    if (now - t > WINDOW_MS) seen.delete(k);
    else n += 1;
  }
  return n;
}
