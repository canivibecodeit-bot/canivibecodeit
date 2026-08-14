import { allApps, alternativesSitemapApps, productsSitemap, categoriesInUse, moatsInUse } from '../lib/apps.js';

export async function GET() {
  const base = 'https://canivibecodeit.com';
  // Staged rollout — swap to appsWithAlternativesPage() ~6-8 weeks after launch
  // so every alternatives page ends up in the sitemap.
  const altPages = alternativesSitemapApps();
  const urls = [
    `${base}/`,
    ...allApps().map((a) => `${base}/${a.slug}`),
    ...altPages.map((a) => `${base}/${a.slug}/alternatives`),
    ...(altPages.length > 0 ? [`${base}/alternatives`] : []),
    // Same staged rollout as the alternatives pages: top products first,
    // the rest joins with sitemap stage 2.
    ...productsSitemap().map((p) => `${base}/alternative/${p.slug}`),
    ...categoriesInUse().map((c) => `${base}/category/${c.slug}`),
    `${base}/categories`,
    ...moatsInUse().map((m) => `${base}/moat/${m.tag}`),
    `${base}/moats`,
    `${base}/stats`,
    `${base}/best-vibe-coding-tools`,
    `${base}/vibecode-this-site`,
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/xml' },
  });
}
