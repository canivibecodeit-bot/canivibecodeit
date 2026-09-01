#!/usr/bin/env node
/* Ingest curated X posts into model_demos for a showcase.
   usage: node scripts/ingest-demos.mjs --model fable-5-1 --file urls.txt [--dry-run] [--keep-order|--reorder]
   One URL per line, line order = featured order. Failures are logged and
   skipped. Needs the app env (DATA_DIR / DATABASE_URL, R2_* for self-hosting):
   node --env-file=.env scripts/ingest-demos.mjs ... */
import { readFileSync } from 'node:fs';
import { ingestUrls } from '../src/lib/showcase.js';

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1];
};
const model = opt('--model');
const file = opt('--file');
const dryRun = args.includes('--dry-run');
// --keep-order: refresh media without touching featured_order (default for a one-line file)
const keepOrder = args.includes('--keep-order') ? true : args.includes('--reorder') ? false : null;
if (!model || !file) {
  console.error('usage: ingest-demos.mjs --model <slug> --file <urls.txt> [--dry-run]');
  process.exit(2);
}
const urls = readFileSync(file, 'utf8').split('\n');
const results = await ingestUrls({ model, urls, dryRun, keepOrder, log: (l) => console.log(l) });
const ok = results.filter((r) => r.ok).length;
console.log(`\n${dryRun ? 'dry run: ' : ''}${ok}/${results.length} ok`);
process.exit(ok === results.length ? 0 : 1);
