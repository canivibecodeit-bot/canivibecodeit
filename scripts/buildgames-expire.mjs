/* Release abandoned Build Games identities: a sponsor row whose FIRST payment
   never cleared within IDENTITY_TTL_MS (default 48h) is deleted, so an
   abandoned checkout can't squat a brand's link + tagline forever. Only ever
   touches rows where nothing has cleared (first_cleared_at IS NULL) and that
   are not 'removed' — a funded or admin-removed identity is never dropped.

   Idempotent and run-anywhere (Railway cron via DATABASE_URL, the VPS via
   DATABASE_PUBLIC_URL, the mirror via --sqlite). Modes:
     --dry      report what would be released, delete nothing
     --sqlite   use the local sqlite database instead of Postgres */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const USE_SQLITE = process.argv.includes('--sqlite');

try {
  for (const line of readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {
  /* no .env is fine — cron has the real environment */
}

if (USE_SQLITE) delete process.env.DATABASE_URL;
else if (!process.env.DATABASE_URL && process.env.DATABASE_PUBLIC_URL) process.env.DATABASE_URL = process.env.DATABASE_PUBLIC_URL;

const { bgExpiredUnfunded, releaseBgSponsor } = await import('../src/lib/db.js');
const { IDENTITY_TTL_MS } = await import('../src/lib/buildgames.js');

const cutoff = Date.now() - IDENTITY_TTL_MS;
const rows = await bgExpiredUnfunded(cutoff);
if (rows.length === 0) {
  console.log('buildgames-expire: nothing to release.');
  process.exit(0);
}

let released = 0;
for (const s of rows) {
  console.log(`  ${DRY ? 'would release' : 'release'} ${s.id} ${s.link} (created ${new Date(s.created_at).toISOString()})`);
  if (!DRY && (await releaseBgSponsor(s.id))) released += 1;
}
console.log(`buildgames-expire: ${DRY ? rows.length + ' releasable (dry)' : released + ' released'} of ${rows.length} unfunded past TTL.`);
process.exit(0);
