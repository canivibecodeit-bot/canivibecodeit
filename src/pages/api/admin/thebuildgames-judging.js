/* The judging results for the operator. GET: JSON (or ?format=csv as a
   download) of every entry with each judge's score per category, the
   category totals, the overall total, the notes and each judge's progress.
   POST action=lock|unlock: the switch that makes the judge pages read-only.
   Same token as the admin consoles: the bg_admin cookie, an Authorization:
   Bearer header, or ?token= for a one-off query; failed attempts are rate
   limited per address. */
import { bgJudgingRows, bgJudgingUpsert, rateLimit } from '../../../lib/db.js';
import { clientIp, crossOrigin, json, readBody } from '../../../lib/request.js';
import { isAdmin } from '../../../lib/sponsors.js';
import { SCORE_CATEGORIES, computeResults, isLocked, judgeList, lockRow, resultsCsv } from '../../../lib/buildgames-judging.js';
import { shortlist, shortlistIsSample } from '../../../lib/buildgames-shortlist.js';

async function gate({ request, clientAddress, cookies, url }) {
  const bearer = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const token = cookies?.get('bg_admin')?.value || bearer || url.searchParams.get('token') || '';
  if (isAdmin(token)) return null;
  if (!(await rateLimit(`judgeadmin:${clientIp(request, clientAddress)}`, 10, 15 * 60 * 1000))) {
    return json({ error: 'slow down' }, 429);
  }
  return json({ error: 'not found' }, 404);
}

const privateHeaders = (res) => {
  res.headers.set('Cache-Control', 'private, no-store');
  res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return res;
};

export async function GET(ctx) {
  const denied = await gate(ctx);
  if (denied) return denied;
  const entries = shortlist();
  const rows = entries ? await bgJudgingRows() : [];
  const judges = judgeList();
  const data = entries ? computeResults(entries, rows, judges) : { results: [], progress: [] };

  if (ctx.url.searchParams.get('format') === 'csv') {
    const res = new Response(resultsCsv(data, judges), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="buildgames-judging.csv"',
      },
    });
    return privateHeaders(res);
  }

  return privateHeaders(
    json({
      generated_at: new Date().toISOString(),
      locked: isLocked(rows),
      sample: shortlistIsSample(),
      categories: SCORE_CATEGORIES.map((c) => c.key),
      judges: judges.map((j) => ({ slug: j.slug, name: j.name })),
      progress: data.progress,
      results: data.results,
      note: 'Sums only. Winners are the operator’s decision.',
    })
  );
}

export async function POST(ctx) {
  if (crossOrigin(ctx.request)) return json({ error: 'bad origin' }, 403);
  const denied = await gate(ctx);
  if (denied) return denied;
  let body;
  try {
    body = await readBody(ctx.request, { maxBytes: 4096 });
  } catch {
    return json({ error: 'bad request' }, 400);
  }
  const action = body?.action;
  if (action !== 'lock' && action !== 'unlock') return json({ error: 'unknown action' }, 400);
  await bgJudgingUpsert(lockRow(action === 'lock'));
  const wantsJson = (ctx.request.headers.get('content-type') || '').includes('application/json');
  if (wantsJson) return privateHeaders(json({ ok: true, locked: action === 'lock' }));
  const msg = action === 'lock' ? 'Judging locked. The judge pages are read-only.' : 'Judging unlocked.';
  return ctx.redirect(`/admin/thebuildgames/judging?msg=${encodeURIComponent(msg)}`, 303);
}
