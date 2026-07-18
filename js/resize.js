// Resize dialog: high-quality resample of the whole document via pica.
import { $, makeCanvas } from './util.js';

const picaInstance = window.pica ? window.pica() : null;

export async function resample(srcCanvas, w, h) {
  const dest = makeCanvas(w, h);
  if (picaInstance && (w < srcCanvas.width || h < srcCanvas.height)) {
    await picaInstance.resize(srcCanvas, dest, { filter: 'mks2013' });
  } else {
    // Upscales (or missing pica): browser bilinear is fine.
    const ctx = dest.getContext('2d');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcCanvas, 0, 0, w, h);
  }
  return dest;
}

export function initResizeDialog(doc) {
  const dlg = $('#dlg-resize');
  const wIn = $('#rs-w'), hIn = $('#rs-h'), lock = $('#rs-lock'), pctIn = $('#rs-pct');
  let ar = 1;

  wIn.addEventListener('input', () => {
    if (lock.checked && wIn.value) hIn.value = Math.max(1, Math.round(wIn.value / ar));
    pctIn.value = Math.round((wIn.value / doc.width) * 100) || '';
  });
  hIn.addEventListener('input', () => {
    if (lock.checked && hIn.value) wIn.value = Math.max(1, Math.round(hIn.value * ar));
    pctIn.value = Math.round((wIn.value / doc.width) * 100) || '';
  });
  pctIn.addEventListener('input', () => {
    const p = Number(pctIn.value);
    if (p > 0) {
      wIn.value = Math.max(1, Math.round(doc.width * p / 100));
      hIn.value = Math.max(1, Math.round(doc.height * p / 100));
    }
  });

  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const w = Number(wIn.value), h = Number(hIn.value);
    if (!w || !h || (w === doc.width && h === doc.height)) return;
    const dest = await resample(doc.baseCanvas, w, h);
    await doc.applyResize(dest);
  });

  return function open() {
    if (!doc.hasImage) return;
    ar = doc.width / doc.height;
    wIn.value = doc.width;
    hIn.value = doc.height;
    pctIn.value = 100;
    dlg.showModal();
  };
}
