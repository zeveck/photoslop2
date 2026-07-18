// OpenAI Images API client (browser fetch, user's own key).
// Edits endpoint is the only mask-capable imagegen API — the engine behind
// heal, generative expand and in-context fill.
import { apiFetch } from './net.js';
import { b64ToBlob } from '../util.js';

const BASE = 'https://api.openai.com/v1';

// Constraints for gpt-image-2 flexible sizing.
export const GPT_IMAGE_2 = {
  model: 'gpt-image-2',
  minPixels: 655_360,
  maxPixels: 8_294_400,
  maxEdge: 3840,
  sizeMultiple: 16,
  maxAspect: 3,
};

// Rough per-image cost by quality (USD), for estimates only.
export const OPENAI_COST = { low: 0.012, medium: 0.05, high: 0.2 };

function parseImages(json) {
  if (!json.data?.length) throw new Error('OpenAI returned no images');
  return json.data.map(d => b64ToBlob(d.b64_json, 'image/png'));
}

// Mask-guided edit. imageBlob and maskBlob must be equal-sized PNGs;
// transparent mask pixels mark the region to regenerate.
export async function openaiEdit({ apiKey, prompt, imageBlob, maskBlob, width, height, n = 1, quality = 'medium', model = GPT_IMAGE_2.model, inputFidelity, background }) {
  const form = new FormData();
  form.append('model', model);
  form.append('prompt', prompt);
  form.append('image', imageBlob, 'image.png');
  if (maskBlob) form.append('mask', maskBlob, 'mask.png');
  form.append('size', `${width}x${height}`);
  form.append('n', String(n));
  form.append('quality', quality);
  form.append('output_format', 'png');
  if (inputFidelity) form.append('input_fidelity', inputFidelity);
  if (background) form.append('background', background);
  const res = await apiFetch(`${BASE}/images/edits`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });
  return parseImages(await res.json());
}

// Plain text-to-image generation (asset mode).
export async function openaiGenerate({ apiKey, prompt, width, height, n = 1, quality = 'medium', model = GPT_IMAGE_2.model, transparent = false }) {
  const body = {
    model, prompt,
    size: `${width}x${height}`,
    n, quality,
    output_format: 'png',
  };
  if (transparent) body.background = 'transparent';
  const res = await apiFetch(`${BASE}/images/generations`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return parseImages(await res.json());
}
