/* Google Safe Browsing v4 lookup. Key unset = the check is simply off (the
   mirror runs without it; production sets GOOGLE_SAFEBROWSING_KEY) — same
   off-until-configured contract as every other external service here.

   Policy: fail OPEN on API errors. A Safe Browsing blip must not hold a
   legitimate entry hostage; the daily recheck re-covers anything a downtime
   window let through. A positive MATCH is the only thing that holds. */

const THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'POTENTIALLY_HARMFUL_APPLICATION',
];

export const safeBrowsingOn = () => !!process.env.GOOGLE_SAFEBROWSING_KEY;

/* Check up to 500 URLs (the API's own batch cap) in one request.
   Returns Map<url, threatType[]> containing ONLY urls with matches.
   Empty map = all clean (or the check is off / errored — fail open). */
export async function checkUrls(urls) {
  const matches = new Map();
  const key = process.env.GOOGLE_SAFEBROWSING_KEY;
  if (!key || urls.length === 0) return matches;
  try {
    const res = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${encodeURIComponent(key)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(8000),
        body: JSON.stringify({
          client: { clientId: 'canivibecodeit', clientVersion: '1.0' },
          threatInfo: {
            threatTypes: THREAT_TYPES,
            platformTypes: ['ANY_PLATFORM'],
            threatEntryTypes: ['URL'],
            threatEntries: urls.slice(0, 500).map((url) => ({ url })),
          },
        }),
      }
    );
    if (!res.ok) {
      console.error(`safe browsing lookup → ${res.status}`);
      return matches;
    }
    const data = await res.json();
    for (const m of data.matches ?? []) {
      const url = m.threat?.url;
      if (!url) continue;
      if (!matches.has(url)) matches.set(url, []);
      matches.get(url).push(m.threatType);
    }
  } catch (err) {
    console.error(`safe browsing lookup failed: ${err.message}`);
  }
  return matches;
}

// Single-URL convenience for the submit path.
export async function checkUrl(url) {
  const m = await checkUrls([url]);
  return m.get(url) ?? null; // null = clean (or check off), array = threats
}
