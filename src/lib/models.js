/* Model names for the submit form's datalist, seeded from the OpenRouter
   models API (no key needed) and cached in memory for a day. Free text is
   always allowed on top; the list is a convenience, not a gate. On any
   fetch failure the curated fallback below keeps the form usable. */

const FALLBACK = [
  'Opus 5',
  'Sonnet 5',
  'Fable 5',
  'Haiku 4.5',
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
