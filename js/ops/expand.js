// Generative expand: place the image on a larger canvas, ask the API to fill
// the new area, then stamp the original pixels back over their region.
import { makeCanvas, canvasToBlob, blobToCanvas } from '../util.js';
import { resample } from '../resize.js';
import { edit, estimateCost, addSpend } from '../ai/providers.js';
import { planApiSize } from './composite.js';

export const DEFAULT_EXPAND_PROMPT =
  'Extend the image beyond its current borders, continuing the scene naturally and seamlessly. Match the style, lighting, colors and perspective of the original.';

// Given the current doc size and a target aspect ratio, the minimal canvas
// that contains the doc unscaled.
export function sizeForAspect(docW, docH, aspect) {
  const docAR = docW / docH;
  if (aspect > docAR) return { w: Math.round(docH * aspect), h: docH };
  return { w: docW, h: Math.round(docW / aspect) };
}

// anchor: {ax, ay} each in {0, 0.5, 1} — where the original sits.
export async function runExpand({ doc, targetW, targetH, anchor = { ax: 0.5, ay: 0.5 }, prompt, provider, quality = 'medium', n = 2 }) {
  const docW = doc.width, docH = doc.height;
  if (targetW < docW || targetH < docH) throw new Error('Target must be at least the current image size.');
  if (targetW === docW && targetH === docH) throw new Error('Target equals current size — nothing to expand.');
  if (targetW / targetH > 3 || targetH / targetW > 3) throw new Error('Aspect ratio beyond 3:1 is not supported by the API.');
  const ox = Math.round((targetW - docW) * anchor.ax);
  const oy = Math.round((targetH - docH) * anchor.ay);

  // Staging canvas: original placed on transparency.
  const staged = makeCanvas(targetW, targetH);
  staged.getContext('2d').drawImage(doc.baseCanvas, ox, oy);

  // Mask: keep (opaque) the original, minus an overlap band on expanded sides
  // so the model can blend the seam; regenerate (transparent) everywhere else.
  const overlap = Math.max(16, Math.round(Math.min(docW, docH) * 0.03));
  const insetL = ox > 0 ? overlap : 0;
  const insetT = oy > 0 ? overlap : 0;
  const insetR = targetW - (ox + docW) > 0 ? overlap : 0;
  const insetB = targetH - (oy + docH) > 0 ? overlap : 0;
  const mask = makeCanvas(targetW, targetH);
  const mctx = mask.getContext('2d');
  mctx.fillStyle = '#000';
  mctx.fillRect(ox + insetL, oy + insetT, docW - insetL - insetR, docH - insetT - insetB);

  const api = planApiSize(targetW, targetH);
  const stagedApi = (api.w === targetW && api.h === targetH) ? staged : await resample(staged, api.w, api.h);
  const maskApi = makeCanvas(api.w, api.h);
  // Nearest-scale the mask and binarize.
  const mac = maskApi.getContext('2d');
  mac.drawImage(mask, 0, 0, api.w, api.h);
  const img = mac.getImageData(0, 0, api.w, api.h);
  for (let i = 3; i < img.data.length; i += 4) img.data[i] = img.data[i] > 127 ? 255 : 0;
  mac.putImageData(img, 0, 0);

  const blobs = await edit({
    provider,
    prompt: prompt || DEFAULT_EXPAND_PROMPT,
    imageBlob: await canvasToBlob(stagedApi),
    maskBlob: await canvasToBlob(maskApi),
    width: api.w, height: api.h,
    n, quality,
  });
  addSpend(estimateCost(provider, quality, n));

  // Feathered alpha for stamping the original back: fade over the overlap
  // band on expanded sides, hard edge on flush sides.
  const feather = makeCanvas(docW, docH);
  const fctx = feather.getContext('2d');
  const f = Math.min(overlap, 24);
  fctx.filter = `blur(${Math.round(f / 2)}px)`;
  fctx.fillStyle = '#fff';
  fctx.fillRect(insetL ? f : -f, insetT ? f : -f,
    docW - (insetL ? f : -f) - (insetR ? f : -f),
    docH - (insetT ? f : -f) - (insetB ? f : -f));
  fctx.filter = 'none';

  const variants = [];
  for (const b of blobs) {
    const rc = await blobToCanvas(b);
    const fitted = (rc.width === targetW && rc.height === targetH) ? rc : await resample(rc, targetW, targetH);
    // original clipped by feather mask, stamped over the API result
    const origMasked = makeCanvas(docW, docH);
    const octx = origMasked.getContext('2d');
    octx.drawImage(doc.baseCanvas, 0, 0);
    octx.globalCompositeOperation = 'destination-in';
    octx.drawImage(feather, 0, 0);
    const out = makeCanvas(targetW, targetH);
    const ctx = out.getContext('2d');
    ctx.drawImage(fitted, 0, 0);
    ctx.drawImage(origMasked, ox, oy);
    variants.push(out);
  }
  return { targetW, targetH, ox, oy, variants, rawBlobs: blobs };
}
