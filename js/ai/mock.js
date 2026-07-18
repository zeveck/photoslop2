// Mock provider: free, offline stand-in for testing every AI flow.
// Deliberately mimics the real models' behavior of regenerating ALL pixels
// (slight global shift) so the client-side composite-back invariant is
// actually exercised in tests.
import { makeCanvas, canvasToBlob, blobToCanvas } from '../util.js';

const VARIANT_COLORS = ['#7c4dff', '#00bfa5', '#ff9100', '#ec407a', '#66bb6a', '#29b6f6'];

const delay = () => new Promise(r => setTimeout(r, 600 + Math.random() * 900));

export async function mockEdit({ imageBlob, maskBlob, width, height, n = 1, prompt = '' }) {
  const src = await blobToCanvas(imageBlob);
  const mask = maskBlob ? await blobToCanvas(maskBlob) : null;
  await delay();
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = makeCanvas(width, height);
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, width, height);
    // Global drift: real models never return byte-identical pixels.
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    ctx.fillRect(0, 0, width, height);
    // Fill the editable (transparent-in-mask) area with a variant pattern.
    const fill = makeCanvas(width, height);
    const fctx = fill.getContext('2d');
    fctx.fillStyle = VARIANT_COLORS[i % VARIANT_COLORS.length];
    fctx.fillRect(0, 0, width, height);
    fctx.strokeStyle = 'rgba(255,255,255,0.35)';
    fctx.lineWidth = 6;
    for (let x = -height; x < width; x += 24) {
      fctx.beginPath(); fctx.moveTo(x, 0); fctx.lineTo(x + height, height); fctx.stroke();
    }
    fctx.fillStyle = '#fff';
    fctx.font = `${Math.max(12, Math.round(height / 20))}px sans-serif`;
    fctx.fillText(`mock ${i + 1}: ${prompt.slice(0, 40)}`, 12, Math.round(height / 2));
    if (mask) {
      // editable where mask alpha == 0 → clip fill by inverted mask alpha
      const inv = makeCanvas(width, height);
      const ictx = inv.getContext('2d');
      ictx.fillStyle = '#000';
      ictx.fillRect(0, 0, width, height);
      ictx.globalCompositeOperation = 'destination-out';
      ictx.drawImage(mask, 0, 0, width, height);
      fctx.globalCompositeOperation = 'destination-in';
      fctx.drawImage(inv, 0, 0);
    }
    ctx.drawImage(fill, 0, 0);
    out.push(await canvasToBlob(c));
  }
  return out;
}

export async function mockGenerate({ prompt = '', width, height, n = 1, transparent = false }) {
  await delay();
  const out = [];
  for (let i = 0; i < n; i++) {
    const c = makeCanvas(width, height);
    const ctx = c.getContext('2d');
    const color = VARIANT_COLORS[i % VARIANT_COLORS.length];
    if (transparent) {
      // A solid blob on transparent background to exercise alpha handling.
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.ellipse(width / 2, height / 2, width * 0.35, height * 0.35, 0, 0, Math.PI * 2);
      ctx.fill();
    } else {
      const g = ctx.createLinearGradient(0, 0, width, height);
      g.addColorStop(0, color); g.addColorStop(1, '#222');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, width, height);
    }
    ctx.fillStyle = transparent ? '#fff' : '#eee';
    ctx.font = `${Math.max(14, Math.round(height / 16))}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`mock ${i + 1}`, width / 2, height / 2 - 10);
    ctx.font = `${Math.max(10, Math.round(height / 28))}px sans-serif`;
    ctx.fillText(prompt.slice(0, 50), width / 2, height / 2 + 20);
    out.push(await canvasToBlob(c));
  }
  return out;
}
