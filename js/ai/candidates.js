// Shared "pick a result" panel: thumbnails of AI variants; hover previews on
// the canvas, click commits, More requests additional variants.
import { $, h } from '../util.js';

let session = null;

export function showCandidates({ blobs, onPreview, onCommit, onMore, onDiscard }) {
  hideCandidates();
  session = { blobs: [], urls: [], onPreview, onCommit, onMore, onDiscard };
  const panel = $('#candidates-panel');
  panel.hidden = false;
  $('#candidates-body').replaceChildren();
  addCandidateBlobs(blobs);

  $('#btn-more-candidates').onclick = async (e) => {
    if (!session?.onMore) return;
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Generating…';
    try {
      const more = await session.onMore();
      if (more?.length) addCandidateBlobs(more);
    } finally {
      btn.disabled = false;
      btn.textContent = '＋ More options';
    }
  };
  $('#btn-cancel-candidates').onclick = () => {
    const cb = session?.onDiscard;
    hideCandidates();
    cb?.();
  };
  panel.onmouseleave = () => session?.onPreview?.(null);
}

export function addCandidateBlobs(blobs) {
  if (!session) return;
  const body = $('#candidates-body');
  for (const blob of blobs) {
    const i = session.blobs.length;
    session.blobs.push(blob);
    const url = URL.createObjectURL(blob);
    session.urls.push(url);
    body.append(h('button', {
      class: 'candidate',
      onmouseenter: () => session?.onPreview?.(i),
      onclick: () => {
        const cb = session?.onCommit;
        hideCandidates();
        cb?.(i);
      },
    }, h('img', { src: url }), h('span', { class: 'tag' }, `#${i + 1}`)));
  }
  $('#candidates-count').textContent = `(${session.blobs.length})`;
}

export function hideCandidates() {
  if (!session) return;
  for (const u of session.urls) URL.revokeObjectURL(u);
  session = null;
  $('#candidates-panel').hidden = true;
  $('#candidates-body').replaceChildren();
}

export function candidatesActive() { return !!session; }
