// Heal pipeline: mask → context region → API edit → composite-back variants.
import { canvasToBlob, blobToCanvas } from '../util.js';
import { resample } from '../resize.js';
import { edit, estimateCost, addSpend } from '../ai/providers.js';
import { maskBBox, contextRegion, planApiSize, extractRegion, makeApiMask, compositeMasked, fitResultToRegion } from './composite.js';

export const DEFAULT_HEAL_PROMPT =
  'Remove the marked area and fill it in seamlessly to match the surrounding image. Keep everything else exactly the same.';

// Returns { region, composites: [canvas], rawBlobs } or throws.
export async function runHeal({ doc, maskCanvas, prompt, provider, quality = 'medium', n = 2 }) {
  const bbox = maskBBox(maskCanvas);
  if (!bbox) throw new Error('Paint over the area to heal first.');
  const region = contextRegion(bbox, doc.width, doc.height);
  const original = extractRegion(doc.baseCanvas, region);
  const api = planApiSize(region.w, region.h);

  const upscaled = (api.w === region.w && api.h === region.h)
    ? original : await resample(original, api.w, api.h);
  const apiMask = makeApiMask(maskCanvas, region, api.w, api.h);

  const blobs = await edit({
    provider,
    prompt: prompt || DEFAULT_HEAL_PROMPT,
    imageBlob: await canvasToBlob(upscaled),
    maskBlob: await canvasToBlob(apiMask),
    width: api.w, height: api.h,
    n, quality,
  });
  addSpend(estimateCost(provider, quality, n));

  const composites = [];
  for (const b of blobs) {
    const rc = await blobToCanvas(b);
    const fitted = await fitResultToRegion(rc, region);
    composites.push(compositeMasked(original, fitted, maskCanvas, region));
  }
  return { region, composites, rawBlobs: blobs };
}

// Stamp a chosen composite into the document's base pixels.
export function commitRegion(doc, region, canvas, label) {
  const ctx = doc.baseCanvas.getContext('2d');
  ctx.clearRect(region.x, region.y, region.w, region.h);
  ctx.drawImage(canvas, region.x, region.y);
  doc.refreshBase();
  doc.commit(label);
}
