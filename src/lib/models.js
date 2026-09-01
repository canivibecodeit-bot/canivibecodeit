/* Model names for the submit form's datalist, seeded from the OpenRouter
   models API (no key needed) and cached in memory for a day. Free text is
   always allowed on top; the list is a convenience, not a gate. On any
   fetch failure the curated fallback below keeps the form usable. */

const FALLBACK = [
  'Claude Opus 5',
  'Claude Sonnet 5',
  'Claude Fable 5.1',
  'Claude Fable 5',
  'Claude Haiku 4.5',
  'GPT-5.2',
  'GPT-5.2-Codex',
  'Gemini 3 Pro',
  'Gemini 3 Flash',
  'DeepSeek V4',
  'Kimi K2',
  'Qwen3 Coder',
  'GLM-5',
];

const TTL_MS = 24 * 60 * 60 * 1000;
let cache = { at: 0, list: null };
let inflight = null;

async function fetchModels() {
  const res = await fetch('https://openrouter.ai/api/v1/models', {
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`openrouter models HTTP ${res.status}`);
  const body = await res.json();
  const names = (body?.data ?? [])
    .map((m) => (typeof m?.name === 'string' ? m.name : null))
    .filter(Boolean)
    // "Anthropic: Claude Opus 5" → "Claude Opus 5"; keep it typeable.
    .map((n) => n.replace(/^[^:]{2,24}:\s*/, '').trim())
    .filter((n) => n.length >= 2 && n.length <= 60 && !/free|preview \(/i.test(n));
  const unique = [...new Set(names)].sort((a, b) => a.localeCompare(b));
  if (unique.length < 20) throw new Error('openrouter models list implausibly small');
  return unique;
}

export async function modelNames() {
  const now = Date.now();
  if (cache.list && now - cache.at < TTL_MS) return cache.list;
  if (!inflight) {
    inflight = fetchModels()
      .then((list) => {
        cache = { at: Date.now(), list };
        return list;
      })
      .catch(() => cache.list ?? FALLBACK)
      .finally(() => {
        inflight = null;
      });
  }
  // First render after a cold start waits at most the 8s fetch timeout; every
  // later render hits the cache.
  return inflight;
}

/* ---------- model showcases (/built-with/<slug>) ---------- */

/* The registry behind /built-with. One entry per showcased model; the slug
   is the URL and the key every demo and build is grouped under. */
export const SHOWCASE_MODELS = [
  {
    slug: 'fable-5-1',
    name: 'Fable 5.1',
    label: 'Claude Fable 5.1',
    vendor: 'Anthropic',
    releasedAt: '2026-09-01',
    // Static share card for this launch; models without one fall back to
    // the satori card the build renders at /og/built-with-<slug>.png.
    ogImage: '/og-built-with-fable-5-1.png',
  },
];

/* Canonical slug for any spelling a maker might type: 'Fable 5.1',
   'Claude Fable 5.1', 'claude-fable-5.1', 'Anthropic: Claude Fable 5.1' all
   become 'fable-5-1'. Vendor and family prefixes are dropped, everything
   non-alphanumeric collapses to one dash. */
export function modelSlug(raw) {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/^[^:]{2,24}:\s*/, '')
    .replace(/^(anthropic|openai|google|meta|claude)[\s-]+/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function showcaseModel(slugOrName) {
  const slug = modelSlug(slugOrName);
  return SHOWCASE_MODELS.find((m) => m.slug === slug) ?? null;
}
