/* Server-side impression counting for sponsor placements.

   One impression = one page render carrying a sponsor's card (rails and tape
   are in every page's HTML), counted here on the server so the client ships
   zero extra bytes. Counts accumulate in memory and flush to the database in
   batches; a restart can drop at most the last unflushed batch, which for a
   counter measured in thousands is noise. Obvious bots are skipped so CTR
   stays meaningful. */

import { bumpImpressions } from './db.js';

const FLUSH_MS = 30 * 1000;
const FLUSH_MAX = 500;

export const BOT_RE =
  /bot|crawl|spider|slurp|headless|lighthouse|pingdom|monitor|preview|scrape|python-requests|curl|wget|facebookexternalhit/i;

let pending = new Map(); // "slot\tday" -> count
let hits = 0;
let lastFlush = Date.now();
let flushing = false;

const dayKey = (ts) => new Date(ts).toISOString().slice(0, 10);

export function recordImpressions(slotIds, userAgent) {
  if (!slotIds || slotIds.length === 0) return;
  if (!userAgent || BOT_RE.test(String(userAgent))) return;
  const now = Date.now();
  const day = dayKey(now);
  for (const id of slotIds) {
    const k = `${id}\t${day}`;
    pending.set(k, (pending.get(k) ?? 0) + 1);
  }
  hits += 1;
  if (hits >= FLUSH_MAX || now - lastFlush >= FLUSH_MS) void flush();
}

async function flush() {
  if (flushing || pending.size === 0) return;
  flushing = true;
  const batch = pending;
  pending = new Map();
  hits = 0;
  lastFlush = Date.now();
  try {
    const entries = [...batch].map(([k, count]) => {
      const [slot_id, day] = k.split('\t');
      return { slot_id, day, count };
    });
    await bumpImpressions(entries);
  } catch (err) {
    console.error(`impression flush failed: ${err?.message || err}`);
    // Put the batch back so a transient database error costs nothing.
    for (const [k, n] of batch) pending.set(k, (pending.get(k) ?? 0) + n);
  } finally {
    flushing = false;
  }
}
