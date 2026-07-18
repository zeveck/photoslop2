// Generative expand tool: pick a target aspect/size and anchor, preview the
// larger canvas, generate variants, choose one.
import { h, canvasToBlob, setStatus } from '../util.js';
import { runExpand, sizeForAspect, DEFAULT_EXPAND_PROMPT } from '../ops/expand.js';
import { maskProviders, estimateCost } from '../ai/providers.js';
import { showCandidates, hideCandidates } from '../ai/candidates.js';
import { addHistory } from '../ai/history.js';

const FImage = fabric.FabricImage || fabric.Image;

const ASPECTS = [
  ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['21:9', 21 / 9],
  ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16], ['Custom', null],
];

export class ExpandTool {
  constructor(doc) {
    this.doc = doc;
    this.quality = 'medium';
    this.n = 2;
    this.prompt = DEFAULT_EXPAND_PROMPT;
    this.anchor = { ax: 0.5, ay: 0.5 };
    this.busy = false;
  }

  activate(ui) {
    const fc = this.doc.fc;
    fc.discardActiveObject();
    fc.selection = false;
    fc.skipTargetFind = true;
    this._buildUI(ui);
    this._applyAspect(16 / 9);
  }

  deactivate() {
    this._preview(null);
    this._outline(false);
    hideCandidates();
    this.doc.fc.selection = true;
    this.doc.fc.skipTargetFind = false;
  }

  _buildUI(ui) {
    ui.setTitle('Generative expand');
    const aspectSel = h('select', {
      onchange: () => {
        const v = aspectSel.value;
        if (v !== 'null') this._applyAspect(Number(v));
      },
    }, ASPECTS.map(([label, v]) => h('option', { value: String(v), selected: label === '16:9' }, label)));

    this.wIn = h('input', { type: 'number', min: '1', max: '3840',
      oninput: () => this._outline(true) });
    this.hIn = h('input', { type: 'number', min: '1', max: '3840',
      oninput: () => this._outline(true) });

    // 3×3 anchor grid
    const anchorBtns = [];
    const grid = h('div', { style: 'display:grid;grid-template-columns:repeat(3,26px);gap:2px' });
    for (const ay of [0, 0.5, 1]) {
      for (const ax of [0, 0.5, 1]) {
        const b = h('button', {
          style: 'width:26px;height:26px;padding:0',
          class: (this.anchor.ax === ax && this.anchor.ay === ay) ? 'active' : '',
          title: 'Where the original image sits in the expanded canvas',
          onclick: (e) => {
            this.anchor = { ax, ay };
            anchorBtns.forEach(x => x.classList.remove('active'));
            e.currentTarget.classList.add('active');
            this._outline(true);
          },
        }, '·');
        anchorBtns.push(b);
        grid.append(b);
      }
    }

    this.promptIn = h('textarea', { rows: '3' }, this.prompt);
    this.promptIn.addEventListener('input', () => { this.prompt = this.promptIn.value; });
    this.providerSel = h('select', { onchange: () => this._updateCost() },
      maskProviders().map(p => h('option', { value: p.id }, p.label)));
    this.qualitySel = h('select', { onchange: () => { this.quality = this.qualitySel.value; this._updateCost(); } },
      ['low', 'medium', 'high'].map(q => h('option', { value: q, selected: q === this.quality }, q)));
    this.nSel = h('select', { onchange: () => { this.n = Number(this.nSel.value); this._updateCost(); } },
      [1, 2, 3, 4].map(v => h('option', { value: String(v), selected: v === this.n }, `${v} variant${v > 1 ? 's' : ''}`)));
    this.costLine = h('div', { class: 'cost-line' });
    this.errLine = h('div', { class: 'hint', style: 'color:var(--danger)' });
    this.genBtn = h('button', { class: 'primary', onclick: () => this.generate() }, '⇲ Expand');

    ui.body.replaceChildren(
      h('div', { class: 'field-row' }, h('label', {}, 'Aspect'), aspectSel),
      h('div', { class: 'field-row' }, h('label', {}, 'W'), this.wIn, h('label', {}, 'H'), this.hIn),
      h('div', { class: 'field-row' }, h('label', {}, 'Anchor'), grid),
      h('label', {}, 'Instructions'), this.promptIn,
      h('div', { class: 'field-row' }, h('label', {}, 'Provider'), this.providerSel),
      h('div', { class: 'field-row' }, h('label', {}, 'Quality'), this.qualitySel, this.nSel),
      this.costLine,
      this.genBtn,
      this.errLine,
      h('p', { class: 'hint' }, 'The new area is generated; your original pixels are stamped back unchanged.'),
    );
    this._updateCost();
  }

  _applyAspect(aspect) {
    const s = sizeForAspect(this.doc.width, this.doc.height, aspect);
    this.wIn.value = s.w;
    this.hIn.value = s.h;
    this._outline(true);
  }

  _updateCost() {
    const cost = estimateCost(this.providerSel.value, this.quality, this.n);
    this.costLine.textContent = cost > 0 ? `Estimated cost: ~$${cost.toFixed(3)}` : 'Free (mock provider)';
  }

  _target() {
    return {
      w: Math.max(this.doc.width, Number(this.wIn.value) || this.doc.width),
      h: Math.max(this.doc.height, Number(this.hIn.value) || this.doc.height),
    };
  }

  // Dashed outline showing the target canvas relative to the document.
  _outline(show) {
    if (this.outlineObj) {
      this.doc.fc.remove(this.outlineObj);
      this.outlineObj = null;
    }
    if (show) {
      const t = this._target();
      const ox = Math.round((t.w - this.doc.width) * this.anchor.ax);
      const oy = Math.round((t.h - this.doc.height) * this.anchor.ay);
      this.outlineObj = new fabric.Rect({
        left: -ox, top: -oy, width: t.w, height: t.h,
        fill: 'rgba(79,140,255,0.08)', stroke: '#4f8cff', strokeWidth: 1,
        strokeDashArray: [6, 4], strokeUniform: true,
        selectable: false, evented: false, psUI: true, excludeFromExport: true,
        objectCaching: false,
      });
      this.doc.fc.add(this.outlineObj);
    }
    this.doc.fc.requestRenderAll();
  }

  async generate() {
    if (this.busy) return;
    this.busy = true;
    this.errLine.textContent = '';
    this.genBtn.disabled = true;
    this.genBtn.innerHTML = '<span class="spinner"></span>Generating…';
    setStatus('Generating expansion variants…');
    try {
      const t = this._target();
      const params = {
        doc: this.doc, targetW: t.w, targetH: t.h, anchor: this.anchor,
        prompt: this.prompt, provider: this.providerSel.value,
        quality: this.quality, n: this.n,
      };
      const res = await runExpand(params);
      this.result = res;
      addHistory({ op: 'expand', prompt: this.prompt, provider: params.provider, blobs: res.rawBlobs, cost: estimateCost(params.provider, this.quality, this.n) });
      this._outline(false);
      const thumbs = await Promise.all(res.variants.map(c => canvasToBlob(c)));
      showCandidates({
        blobs: thumbs,
        onPreview: (i) => this._preview(i),
        onCommit: (i) => this._commit(i),
        onDiscard: () => { this._preview(null); this._outline(true); },
        onMore: async () => {
          const more = await runExpand(params);
          this.result.variants.push(...more.variants);
          addHistory({ op: 'expand', prompt: this.prompt, provider: params.provider, blobs: more.rawBlobs, cost: estimateCost(params.provider, this.quality, this.n) });
          return Promise.all(more.variants.map(c => canvasToBlob(c)));
        },
      });
      this._preview(0);
      setStatus('Hover results to preview, click to apply.');
    } catch (e) {
      console.error(e);
      this.errLine.textContent = e.message || String(e);
      setStatus('');
    } finally {
      this.busy = false;
      this.genBtn.disabled = false;
      this.genBtn.textContent = '⇲ Expand';
    }
  }

  _preview(i) {
    if (this.previewObj) {
      this.doc.fc.remove(this.previewObj);
      this.previewObj = null;
    }
    if (i != null && this.result?.variants[i]) {
      this.previewObj = new FImage(this.result.variants[i], {
        left: -this.result.ox, top: -this.result.oy,
        selectable: false, evented: false,
        psUI: true, excludeFromExport: true, objectCaching: false,
      });
      this.doc.fc.add(this.previewObj);
    }
    this.doc.fc.requestRenderAll();
  }

  async _commit(i) {
    this._preview(null);
    const { variants, ox, oy } = this.result;
    await this.doc.applyExpand(variants[i], ox, oy);
    this._outline(true);
    setStatus('Expand applied.');
  }
}
