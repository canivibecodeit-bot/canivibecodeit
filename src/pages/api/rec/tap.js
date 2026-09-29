// The one counting redirect for every Attention Playbook house-ad placement
// (see lib/tap.js): GET /api/rec/tap?p=<placement>.
import { redirectToTap } from '../../../lib/tap.js';

export async function GET({ request, clientAddress, url }) {
  return redirectToTap({ request, clientAddress, placement: url.searchParams.get('p') ?? '' });
}
