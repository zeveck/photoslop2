// Shared helpers. No dependencies.

export const $ = (sel) => document.querySelector(sel);
export const $$ = (sel) => [...document.querySelectorAll(sel)];

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export function cloneCanvas(src) {
  const c = makeCanvas(src.width, src.height);
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

export function canvasToBlob(canvas, type = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(b => b ? resolve(b) : reject(new Error('toBlob failed')), type, quality);
  });
}

export async function blobToCanvas(blob) {
  const bmp = await createImageBitmap(blob);
  const c = makeCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

// Decode a user-supplied image file, honoring EXIF orientation.
export async function fileToCanvas(fileOrBlob) {
  const bmp = await createImageBitmap(fileOrBlob, { imageOrientation: 'from-image' });
  const c = makeCanvas(bmp.width, bmp.height);
  c.getContext('2d').drawImage(bmp, 0, 0);
  bmp.close();
  return c;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function dataURLtoBlob(dataURL) {
  const [head, b64] = dataURL.split(',');
  const mime = head.match(/data:(.*?);/)[1];
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function b64ToBlob(b64, mime = 'image/png') {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export async function blobToB64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// Largest axis-aligned rectangle with the same aspect ratio... no — largest
// axis-aligned rectangle fully inside a w×h rectangle rotated by `angle` radians.
export function rotatedRectWithMaxArea(w, h, angle) {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const sin = Math.abs(Math.sin(angle));
  const cos = Math.abs(Math.cos(angle));
  const sideLong = Math.max(w, h);
  const sideShort = Math.min(w, h);
  let wr, hr;
  if (sideShort <= 2 * sin * cos * sideLong || Math.abs(sin - cos) < 1e-10) {
    const x = 0.5 * sideShort;
    if (w >= h) { wr = x / sin; hr = x / cos; }
    else { wr = x / cos; hr = x / sin; }
  } else {
    const cos2 = cos * cos - sin * sin;
    wr = (w * cos - h * sin) / cos2;
    hr = (h * cos - w * sin) / cos2;
  }
  return { w: wr, h: hr };
}

export function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function setStatus(hint) {
  const el = document.getElementById('status-hint');
  if (el) el.textContent = hint || '';
}

// Build a small element tree: h('div', {class:'row'}, child1, 'text', ...)
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const ch of children.flat()) {
    if (ch == null) continue;
    el.append(ch.nodeType ? ch : document.createTextNode(ch));
  }
  return el;
}
