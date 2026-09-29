// The one counting redirect for every Attention Playbook house-ad placement
// (see lib/tap.js): GET /api/rec/tap?p=<placement>. HEAD is answered by the
// same handler, which redirects it and never counts it.
import { redirectToTap } from '../../../lib/tap.js';

const handle = ({ request, clientAddress, url }) =>
  redirectToTap({ request, clientAddress, placement: url.searchParams.get('p') ?? '' });

export const GET = handle;
export const HEAD = handle;
