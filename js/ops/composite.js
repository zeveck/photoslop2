// Region extraction, API-size planning, mask building and composite-back.
//
// THE INVARIANT: API results are never applied wholesale. We extract a region,
// send it (with a mask) to the API, then stamp back ONLY the masked pixels —
// everything outside the mask stays byte-identical to the original.
import { makeCanvas, cloneCanvas, clamp } from '../util.js';
import { resample } from '../resize.js';
import { GPT_IMAGE_2 } from '../ai/openai.js';

// Bounding box of painted (alpha > 0) pixels in a mask canvas. null if empty.
export function maskBBox(maskCanvas) {
  const { width: w, height: h } = maskCanvas;
  const data = maskCanvas.getContext('2d').getImageData(0, 0, w, h).data;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 0) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

// Grow a mask bbox into a context region: padded, preferring at least
// `minSide` px on each axis, clamped to the document.
export function contextRegion(bbox, docW, docH, minSide = 512) {
  const pad = Math.max(64, Math.round(Math.max(bbox.w, bbox.h) * 0.4));
  let x0 = bbox.x - pad, y0 = bbox.y - pad;
  let x1 = bbox.x + bbox.w + pad, y1 = bbox.y + bbox.h + pad;
  const growTo = (lo, hi, target, max) => {
    const need = target - (hi - lo);
    if (need > 0) {
      lo -= need / 2; hi += need / 2;
    }
    if (lo < 0) { hi -= lo; lo = 0; }
    if (hi > max) { lo -= hi - max; hi = max; }
    return [Math.max(0, Math.round(lo)), Math.min(max, Math.round(hi))];
  };
  [x0, x1] = growTo(x0, x1, Math.min(minSide, docW), docW);
  [y0, y1] = growTo(y0, y1, Math.min(minSide, docH), docH);
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Pick API dimensions for a region: multiples of 16, within min/max pixels
// and max edge. Returns {w, h}.
export function planApiSize(w, h, C = GPT_IMAGE_2) {
  let scale = Math.max(1, Math.sqrt(C.minPixels / (w * h)));
  scale = Math.min(scale, C.maxEdge / Math.max(w, h), Math.sqrt(C.maxPixels / (w * h)));
  const snap = (v) => clamp(Math.round(v / C.sizeMultiple) * C.sizeMultiple, C.sizeMultiple, C.maxEdge);
  let sw = snap(w * scale), sh = snap(h * scale);
  // Rounding down can drop below the pixel floor — bump the larger axis up.
  while (sw * sh < C.minPixels) {
    if (sw >= sh) sw += C.sizeMultiple; else sh += C.sizeMultiple;
  }
  return { w: sw, h: sh };
}

export function extractRegion(srcCanvas, r) {
  const c = makeCanvas(r.w, r.h);
  c.getContext('2d').drawImage(srcCanvas, -r.x, -r.y);
  return c;
}

// Build the API mask PNG at (outW, outH): fully opaque where pixels must be
// kept, fully transparent where the model should regenerate.
export function makeApiMask(maskCanvas, region, outW, outH) {
  const c = makeCanvas(outW, outH);
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, outW, outH);
  ctx.globalCompositeOperation = 'destination-out';
  ctx.drawImage(maskCanvas,
    region.x, region.y, region.w, region.h,
    0, 0, outW, outH);
  // Binarize: scaling produced soft edges; the API mask should be hard.
  const img = ctx.getImageData(0, 0, outW, outH);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] > 127 ? 255 : 0;
  ctx.globalCompositeOperation = 'source-over';
  ctx.putImageData(img, 0, 0);
  return c;
}

// Composite an API result over the original region, clipped to a feathered
// version of the painted mask. originalRegion is untouched outside the mask.
export function compositeMasked(originalRegion, resultRegion, maskCanvas, region, featherPx = 3) {
  const { w, h } = region;
  const feathered = makeCanvas(w, h);
  const fctx = feathered.getContext('2d');
  fctx.filter = `blur(${featherPx}px)`;
  fctx.drawImage(maskCanvas, region.x, region.y, w, h, 0, 0, w, h);
  fctx.filter = 'none';

  const clipped = makeCanvas(w, h);
  const cctx = clipped.getContext('2d');
  cctx.drawImage(resultRegion, 0, 0, w, h);
  cctx.globalCompositeOperation = 'destination-in';
  cctx.drawImage(feathered, 0, 0);

  const out = cloneCanvas(originalRegion);
  out.getContext('2d').drawImage(clipped, 0, 0);
  return out;
}

// Downscale an API result back to region size.
export async function fitResultToRegion(resultCanvas, region) {
  if (resultCanvas.width === region.w && resultCanvas.height === region.h) return resultCanvas;
  return resample(resultCanvas, region.w, region.h);
}
