// Provider dispatch + cost estimates + session spend counter.
import { getSettings } from './keys.js';
import { openaiEdit, openaiGenerate, OPENAI_COST, GPT_IMAGE_2 } from './openai.js';
import { geminiGenerate, GEMINI_MODELS, GEMINI_COST, nearestAspect } from './gemini.js';
import { mockEdit, mockGenerate } from './mock.js';

export { GPT_IMAGE_2, GEMINI_MODELS, nearestAspect };

// Providers able to do mask-guided edits (heal/expand/fill).
export function maskProviders() {
  const s = getSettings();
  const out = [];
  if (s.openaiKey) out.push({ id: 'openai', label: 'OpenAI gpt-image-2' });
  out.push({ id: 'mock', label: 'Mock (free, fake)' });
  return s.mock ? out.reverse() : out;
}

// Providers able to do plain generation.
export function genProviders() {
  const s = getSettings();
  const out = [];
  if (s.openaiKey) out.push({ id: 'openai', label: 'OpenAI gpt-image' });
  if (s.geminiKey) out.push({ id: 'gemini-flash', label: 'Gemini 3.1 Flash' });
  if (s.geminiKey) out.push({ id: 'gemini-pro', label: 'Gemini 3 Pro' });
  out.push({ id: 'mock', label: 'Mock (free, fake)' });
  return s.mock ? out.reverse() : out;
}

export function estimateCost(provider, quality, n) {
  if (provider === 'openai') return (OPENAI_COST[quality] ?? 0.05) * n;
  if (provider === 'gemini-flash') return GEMINI_COST.flash * n;
  if (provider === 'gemini-pro') return GEMINI_COST.pro * n;
  return 0;
}

export async function edit({ provider, prompt, imageBlob, maskBlob, width, height, n, quality, model, inputFidelity, background }) {
  const s = getSettings();
  if (provider === 'openai') {
    return openaiEdit({ apiKey: s.openaiKey, prompt, imageBlob, maskBlob, width, height, n, quality, model, inputFidelity, background });
  }
  return mockEdit({ imageBlob, maskBlob, width, height, n, prompt });
}

export async function generate({ provider, prompt, width, height, n = 1, quality, transparent }) {
  const s = getSettings();
  if (provider === 'openai') {
    if (transparent) {
      // gpt-image-2 has no alpha support; gpt-image-1.5 does, at fixed sizes.
      const size = width > height ? { width: 1536, height: 1024 }
        : height > width ? { width: 1024, height: 1536 } : { width: 1024, height: 1024 };
      return openaiGenerate({ apiKey: s.openaiKey, prompt, ...size, n, quality, model: 'gpt-image-1.5', transparent: true });
    }
    return openaiGenerate({ apiKey: s.openaiKey, prompt, width, height, n, quality });
  }
  if (provider === 'gemini-flash' || provider === 'gemini-pro') {
    const model = provider === 'gemini-pro' ? GEMINI_MODELS.pro : GEMINI_MODELS.flash;
    // Gemini returns one image per request — fan out for variants.
    const jobs = Array.from({ length: n }, () => geminiGenerate({
      apiKey: s.geminiKey, prompt, model,
      aspectRatio: nearestAspect(width, height),
      imageSize: Math.max(width, height) > 1400 ? '2K' : '1K',
    }));
    return (await Promise.all(jobs)).flat();
  }
  return mockGenerate({ prompt, width, height, n, transparent });
}

// ---------- session spend counter ----------

let spendTotal = 0;

export function addSpend(usd) {
  spendTotal += usd;
  const el = document.getElementById('spend-counter');
  if (el) el.textContent = spendTotal > 0 ? `~$${spendTotal.toFixed(2)} spent` : '';
}
