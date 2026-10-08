/* The judging shortlist, from the repo. The real list is
   src/data/buildgames-shortlist.json (an array of {rank, entryId?, name,
   handle, demoUrl, repoUrl, blurb, oneLine, ...}); it is picked up at build
   time through a glob, so its absence is not an error: the judging pages
   simply 404 until it lands. For development the mirror can run on the
   sample file with BUILDGAMES_JUDGING_SAMPLE=1; production never sets that,
   so placeholder rows can never reach a judge. */
import { normaliseShortlist } from './buildgames-judging.js';
import sample from '../data/buildgames-shortlist.sample.json';

const files = import.meta.glob('../data/buildgames-shortlist.json', { eager: true, import: 'default' });
const real = files['../data/buildgames-shortlist.json'] ?? null;

let cache;

// The normalised shortlist, or null when judging is not available.
export function shortlist() {
  if (cache !== undefined) return cache;
  if (real) cache = normaliseShortlist(real);
  else if (['1', 'true'].includes(process.env.BUILDGAMES_JUDGING_SAMPLE ?? '')) cache = normaliseShortlist(sample);
  else cache = null;
  return cache;
}

export const shortlistIsSample = () => !real;
