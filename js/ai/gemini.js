// Gemini (Nano Banana) client. No mask support — instruction-based edits and
// text-to-image only. Used for asset generation and whole-image edits.
import { apiFetch } from './net.js';
import { b64ToBlob, blobToB64 } from '../util.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

export const GEMINI_MODELS = {
  flash: 'gemini-3.1-flash-image',
  pro: 'gemini-3-pro-image',
};

// Rough per-image cost (USD, 1K–2K outputs), for estimates only.
export const GEMINI_COST = { flash: 0.07, pro: 0.14 };

const ASPECTS = ['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'];

export function nearestAspect(w, h) {
  const r = w / h;
  let best = ASPECTS[0], bestDiff = Infinity;
  for (const a of ASPECTS) {
    const [aw, ah] = a.split(':').map(Number);
    const diff = Math.abs(Math.log(r / (aw / ah)));
    if (diff < bestDiff) { bestDiff = diff; best = a; }
  }
  return best;
}

export async function geminiGenerate({ apiKey, prompt, images = [], model = GEMINI_MODELS.flash, aspectRatio = '1:1', imageSize = '1K' }) {
  const parts = [];
  for (const blob of images) {
    parts.push({ inlineData: { mimeType: blob.type || 'image/png', data: await blobToB64(blob) } });
  }
  parts.push({ text: prompt });
  const body = {
    contents: [{ parts }],
    generationConfig: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio, imageSize },
    },
  };
  const res = await apiFetch(`${BASE}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const cand = json.candidates?.[0];
  const imgPart = cand?.content?.parts?.find(p => p.inlineData);
  if (!imgPart) {
    const reason = cand?.finishReason || json.promptFeedback?.blockReason || 'no image returned';
    throw new Error(`Gemini: ${reason}`);
  }
  return [b64ToBlob(imgPart.inlineData.data, imgPart.inlineData.mimeType || 'image/png')];
}
