/* The Build Games 2026: the results.

   Decided by the operator on 14 October 2026 from the judges' locked scores
   (three judges, 0 to 10 per category, one prize per builder). This module
   carries only what the results page publishes: the winner and the
   honourable mentions per category, the prize, and the entry count the
   game page showed when the window closed. Scores, the judges' notes and
   repo links stay private.

   Entries are referenced by entry key (the production entry id, as in
   src/data/buildgames-shortlist.json), never by name, so a renamed product
   can never move a prize. `resultsView` joins the keys with the shortlist
   and throws on a key it cannot find, so a broken reference fails the build
   and the tests rather than rendering a hole. Node-importable on purpose:
   scripts/generate-og.mjs reads it at build time. */

export const RESULTS = {
  year: 2026,
  // $800 per category, $2,400 in all.
  prizeCents: 80_000,
  fundCents: 240_000,
  // Entries received inside the build window (the figure the game page
  // showed when it closed).
  entryCount: 46,
  // In the order of CATEGORIES in lib/buildgames.js; `key` matches the
  // judging tool's SCORE_CATEGORIES.
  winners: [
    {
      key: 'replacement',
      category: 'Best Replacement',
      entry: 'bge_b9ysh6kzac',
      product: 'openheard',
      mentions: ['bge_4jef5232vz', 'bge_969k3fecfz', 'bge_hkqccvybpb'],
    },
    {
      key: 'creative',
      category: 'Most Creative',
      entry: 'bge_4jef5232vz',
      product: 'InMotion',
      mentions: ['bge_bewg2w6jrt', 'bge_969k3fecfz', 'bge_k8535tznqt'],
    },
    {
      key: 'polished',
      category: 'Most Polished',
      entry: 'bge_969k3fecfz',
      product: 'Excerpt',
      mentions: ['bge_zf7fq8w748', 'bge_fhmz8pxay2', 'bge_bewg2w6jrt'],
    },
  ],
  // Each finalist's overall total across the three categories, as a whole
  // number out of `totalMax`, highest first (the operator's published list).
  // Totals only: per-category scores are never published.
  totalMax: 90,
  totals: [
    ['bge_4jef5232vz', 62], // InMotion
    ['bge_b9ysh6kzac', 55], // openheard
    ['bge_969k3fecfz', 55], // Excerpt
    ['bge_zf7fq8w748', 52], // Bloombroke
    ['bge_hkqccvybpb', 50], // Framesmith
    ['bge_fhmz8pxay2', 49], // Nodoku
    ['bge_287wrcy2t8', 47], // Footnote
    ['bge_s87jeazb67', 46], // CaptionLab
    ['bge_bewg2w6jrt', 45], // Airmail (Paper Planes)
    ['bge_45vnk923sg', 42], // Tasu
    ['bge_k8535tznqt', 40], // OK RICH
    ['bge_mpewgdyjcg', 39], // UserTrack
    ['bge_4m9jcvknkv', 31], // Plinth
  ],
  // Builder names as they are printed on the results page. The entry form
  // kept whatever was typed (one in capitals, one in lower case); the
  // shortlist file stays as submitted, these override the display only.
  names: {
    bge_4jef5232vz: 'Noureddine Ratbaoui',
    bge_969k3fecfz: 'Aidan Tan',
  },
};

// Once the results are in the build they are announced: the game page,
// the builders page and the entry page switch their "winners by" copy
// to a link, and the results page renders.
export const winnersAnnounced = () => RESULTS.winners.length > 0;

// The line that closes the gap between the pool on the game page and the
// fund here (the Lead's sentence, 14 Oct 2026; the operator can reword).
export const FUND_NOTE =
  "The board raised $2,750. After Stripe's card and currency fees and the swing from dollars to pounds and back, a little over $2,500 arrived; that is three prizes of $800, with the rest covering the cost of sending them abroad.";

export const usd = (cents) => '$' + Math.round(cents / 100).toLocaleString('en-US');

/* The page's view of the results: every key resolved to its shortlist
   entry (lib/buildgames-shortlist.js), the finalists by total, highest
   first (ties keep the published order), each with its total and the
   category it won, if any. */
export function resultsView(entries) {
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('results: no shortlist');
  const byKey = new Map(entries.map((e) => [e.key, e]));
  const pick = (key) => {
    const e = byKey.get(key);
    if (!e) throw new Error(`results: unknown entry ${key}`);
    return { ...e, name: RESULTS.names[key] ?? e.name };
  };
  const winners = RESULTS.winners.map((w) => ({
    key: w.key,
    category: w.category,
    product: w.product,
    entry: pick(w.entry),
    mentions: w.mentions.map(pick),
  }));
  const wonBy = new Map(winners.map((w) => [w.entry.key, w]));
  const order = new Map(RESULTS.totals.map(([key], i) => [key, i]));
  const totalOf = (key) => {
    const row = RESULTS.totals.find(([k]) => k === key);
    if (!row) throw new Error(`results: no total for ${key}`);
    return row[1];
  };
  const finalists = entries
    .map((e) => ({ ...pick(e.key), total: totalOf(e.key), won: wonBy.get(e.key) ?? null }))
    .sort((a, b) => b.total - a.total || order.get(a.key) - order.get(b.key));
  return {
    year: RESULTS.year,
    prizeCents: RESULTS.prizeCents,
    fundCents: RESULTS.fundCents,
    entryCount: RESULTS.entryCount,
    totalMax: RESULTS.totalMax,
    winners,
    finalists,
  };
}
