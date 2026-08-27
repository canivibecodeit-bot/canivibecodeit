// Live pot feed for The Build Games page: current pool total + bid count +
// fill fraction, polled ~30s so the vessel and figure move without a reload.
// Phase A returns the seed total; Phase B swaps to a SUM over active bids.
import { fillLevel, potFromBids, rankBids, seedBids } from '../../../lib/buildgames.js';
import { buildGamesLive } from '../../../lib/flags.js';
import { json } from '../../../lib/request.js';

export async function GET() {
  if (!buildGamesLive()) return new Response(null, { status: 404 });
  const bids = seedBids(); // Phase B: activeBids() from the DB
  const potCents = potFromBids(bids);
  const res = json({
    pot_cents: potCents,
    count: rankBids(bids).length,
    fill: Number(fillLevel(potCents).toFixed(4)),
  });
  res.headers.set('Cache-Control', 'public, max-age=15');
  return res;
}
