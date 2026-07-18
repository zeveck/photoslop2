// Session AI history: every AI call logged with thumbnails.
// Click a thumbnail to download that result.
import { $, h, downloadBlob } from '../util.js';

let count = 0;

export function addHistory({ op, prompt, provider, blobs, cost = 0 }) {
  const body = $('#history-body');
  if (count === 0) body.replaceChildren();
  count++;
  const thumbs = blobs.slice(0, 4).map((blob, i) => h('img', {
    src: URL.createObjectURL(blob),
    title: `Click to download result ${i + 1}`,
    style: 'cursor:pointer',
    onclick: () => downloadBlob(blob, `${op}-${count}-${i + 1}.png`),
  }));
  body.prepend(h('div', { class: 'history-item', title: prompt || '' },
    h('div', {},
      h('div', {}, `${op} · ${provider}${cost ? ` · ~$${cost.toFixed(2)}` : ''}`),
      h('div', { class: 'row' }, thumbs)),
  ));
}
