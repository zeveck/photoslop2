// Background removal: ask the API for a transparent-background version, but
// use ONLY its alpha channel as a mask applied to the original pixels.
// The subject's pixels are always the untouched originals.
import { makeCanvas, canvasToBlob, blobToCanvas } from '../util.js';
import { resample } from '../resize.js';
import { edit, estimateCost, addSpend } from '../ai/providers.js';

export const BG_REMOVE_PROMPT =
  'Keep the main subject exactly as it is, pixel for pixel, and make the entire background fully transparent. Do not modify, restyle or move the subject in any way.';

// gpt-image-1.5 fixed sizes (transparency-capable model).
const SIZES_15 = [
  { w: 1024, h: 1024 }, { w: 1536, h: 1024 }, { w: 1024, h: 1536 },
];

function nearestSize(w, h) {
  const r = w / h;
  let best = SIZES_15[0], diff = Infinity;
  for (const s of SIZES_15) {
    const d = Math.abs(Math.log(r / (s.w / s.h)));
    if (d < diff) { diff = d; best = s; }
  }
  return best;
}

// Returns a doc-sized canvas whose ALPHA channel is the keep-mask.
export async function runBgRemove({ doc, provider, quality = 'medium' }) {
  const docW = doc.width, docH = doc.height;
  let resultCanvas;
  if (provider === 'openai') {
    const size = nearestSize(docW, docH);
    const stretched = await resample(doc.baseCanvas, size.w, size.h);
    const blobs = await edit({
      provider: 'openai',
      model: 'gpt-image-1.5',
      prompt: BG_REMOVE_PROMPT,
      imageBlob: await canvasToBlob(stretched),
      width: size.w, height: size.h,
      n: 1, quality,
      inputFidelity: 'high',
      background: 'transparent',
    });
    addSpend(estimateCost('openai', quality, 1));
    resultCanvas = await blobToCanvas(blobs[0]);
  } else {
    // Mock: soft-edged ellipse "subject" in the center.
    resultCanvas = makeCanvas(docW, docH);
    const ctx = resultCanvas.getContext('2d');
    const g = ctx.createRadialGradient(docW / 2, docH / 2, Math.min(docW, docH) * 0.28,
      docW / 2, docH / 2, Math.min(docW, docH) * 0.34);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, docW, docH);
    await new Promise(r => setTimeout(r, 800));
  }

  // Stretch the result's alpha back onto document geometry.
  const fitted = (resultCanvas.width === docW && resultCanvas.height === docH)
    ? resultCanvas : await resample(resultCanvas, docW, docH);
  const mask = makeCanvas(docW, docH);
  const mctx = mask.getContext('2d');
  const src = fitted.getContext('2d').getImageData(0, 0, docW, docH);
  const out = mctx.createImageData(docW, docH);
  for (let i = 0; i < src.data.length; i += 4) {
    out.data[i] = 255; out.data[i + 1] = 255; out.data[i + 2] = 255;
    // Suppress near-zero noise, keep soft edges.
    const a = src.data[i + 3];
    out.data[i + 3] = a < 16 ? 0 : a;
  }
  mctx.putImageData(out, 0, 0);
  return mask;
}

// original pixels, alpha'd by mask.
export function applyKeepMask(baseCanvas, maskCanvas) {
  const c = makeCanvas(baseCanvas.width, baseCanvas.height);
  const ctx = c.getContext('2d');
  ctx.drawImage(baseCanvas, 0, 0);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(maskCanvas, 0, 0);
  return c;
}
