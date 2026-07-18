// Export dialog: flatten document → optional resample → encode → download.
import { $, makeCanvas, canvasToBlob, downloadBlob } from './util.js';
import { resample } from './resize.js';

let webpSupported = null;
async function checkWebp() {
  if (webpSupported !== null) return webpSupported;
  const b = await canvasToBlob(makeCanvas(2, 2), 'image/webp').catch(() => null);
  webpSupported = !!b && b.type === 'image/webp';
  return webpSupported;
}

const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

export function initExportDialog(doc, getBaseName) {
  const dlg = $('#dlg-export');
  const nameIn = $('#ex-name'), fmtSel = $('#ex-format');
  const qWrap = $('#ex-quality-wrap'), qIn = $('#ex-quality'), qVal = $('#ex-quality-val');
  const wIn = $('#ex-w'), hIn = $('#ex-h'), note = $('#ex-note');

  checkWebp().then(ok => {
    if (!ok) fmtSel.querySelector('option[value="image/webp"]').disabled = true;
  });

  function syncUI() {
    const fmt = fmtSel.value;
    qWrap.style.visibility = fmt === 'image/png' ? 'hidden' : 'visible';
    note.textContent = fmt === 'image/jpeg'
      ? 'JPEG has no transparency — transparent areas become white.'
      : '';
  }
  fmtSel.addEventListener('change', syncUI);
  qIn.addEventListener('input', () => { qVal.textContent = qIn.value; });

  let ar = 1;
  wIn.addEventListener('input', () => { if (wIn.value) hIn.value = Math.max(1, Math.round(wIn.value / ar)); });
  hIn.addEventListener('input', () => { if (hIn.value) wIn.value = Math.max(1, Math.round(hIn.value * ar)); });

  dlg.addEventListener('close', async () => {
    if (dlg.returnValue !== 'ok') return;
    const fmt = fmtSel.value;
    const w = Number(wIn.value) || doc.width;
    const h = Number(hIn.value) || doc.height;

    let flat = doc.flatten();
    if (w !== flat.width || h !== flat.height) flat = await resample(flat, w, h);
    if (fmt === 'image/jpeg') {
      const white = makeCanvas(flat.width, flat.height);
      const ctx = white.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, white.width, white.height);
      ctx.drawImage(flat, 0, 0);
      flat = white;
    }
    const quality = Number(qIn.value) / 100;
    const blob = await canvasToBlob(flat, fmt, quality);
    const name = (nameIn.value.trim() || 'image').replace(/\.(png|jpe?g|webp)$/i, '');
    downloadBlob(blob, `${name}.${EXT[blob.type] || 'png'}`);
  });

  return function open() {
    if (!doc.hasImage) return;
    ar = doc.width / doc.height;
    nameIn.value = getBaseName();
    wIn.value = doc.width;
    hIn.value = doc.height;
    syncUI();
    dlg.showModal();
  };
}
