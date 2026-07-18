// Heal tool: paint (or rect-drag) a repair mask, then AI-fill the masked
// area. Only masked pixels ever change (see ops/composite.js).
import { h, makeCanvas, canvasToBlob, setStatus } from '../util.js';
import { runHeal, commitRegion, DEFAULT_HEAL_PROMPT } from '../ops/heal.js';
import { maskProviders, estimateCost } from '../ai/providers.js';
import { showCandidates, addCandidateBlobs, hideCandidates } from '../ai/candidates.js';
import { addHistory } from '../ai/history.js';

const FImage = fabric.FabricImage || fabric.Image;
const MASK_COLOR = '#ff3c3c';

export class HealTool {
  constructor(doc) {
    this.doc = doc;
    this.mode = 'brush';
    this.size = 40;
    this.quality = 'medium';
    this.n = 2;
    this.prompt = DEFAULT_HEAL_PROMPT;
    this.busy = false;
    doc.addEventListener('change', () => this._syncMaskSize());
  }

  // ---------- lifecycle ----------

  activate(ui) {
    const fc = this.doc.fc;
    fc.discardActiveObject();
    fc.selection = false;
    fc.skipTargetFind = true;
    fc.defaultCursor = 'crosshair';
    this._syncMaskSize();
    this._addViz();
    this._down = (o) => this._onDown(o);
    this._move = (o) => this._onMove(o);
    this._up = () => this._onUp();
    fc.on('mouse:down', this._down);
    fc.on('mouse:move', this._move);
    fc.on('mouse:up', this._up);
    this._buildUI(ui);
  }

  deactivate() {
    const fc = this.doc.fc;
    fc.off('mouse:down', this._down);
    fc.off('mouse:move', this._move);
    fc.off('mouse:up', this._up);
    fc.selection = true;
    fc.skipTargetFind = false;
    fc.defaultCursor = 'default';
    this._preview(null);
    hideCandidates();
    this._removeViz();
  }

  _syncMaskSize() {
    if (!this.doc.hasImage) return;
    if (!this.maskCanvas || this.maskCanvas.width !== this.doc.width || this.maskCanvas.height !== this.doc.height) {
      this.maskCanvas = makeCanvas(this.doc.width, this.doc.height);
      if (this.viz) { this._removeViz(); this._addViz(); }
    }
  }

  _addViz() {
    if (this.viz) return;
    this.viz = new FImage(this.maskCanvas, {
      left: 0, top: 0, opacity: 0.45,
      selectable: false, evented: false,
      psUI: true, excludeFromExport: true, objectCaching: false,
    });
    this.doc.fc.add(this.viz);
    this.doc.fc.requestRenderAll();
  }

  _removeViz() {
    if (!this.viz) return;
    this.doc.fc.remove(this.viz);
    this.viz = null;
    this.doc.fc.requestRenderAll();
  }

  // ---------- mask painting ----------

  _onDown(opt) {
    if (this.busy || opt.e.button !== 0) return;
    const p = this.doc.scenePoint(opt.e);
    this.painting = true;
    this.last = p;
    if (this.mode === 'brush') this._dab(p, p);
    else this.rectStart = p;
  }

  _onMove(opt) {
    if (!this.painting) return;
    const p = this.doc.scenePoint(opt.e);
    if (this.mode === 'brush') {
      this._dab(this.last, p);
      this.last = p;
    } else {
      this._drawRectPreview(this.rectStart, p);
    }
  }

  _onUp() {
    if (!this.painting) return;
    this.painting = false;
    if (this.mode === 'rect' && this.rectPreview) {
      const r = this.rectPreview;
      const ctx = this.maskCanvas.getContext('2d');
      ctx.fillStyle = MASK_COLOR;
      ctx.fillRect(r.left, r.top, r.width, r.height);
      this.doc.fc.remove(r);
      this.rectPreview = null;
      this.doc.fc.requestRenderAll();
    }
  }

  _dab(from, to) {
    const ctx = this.maskCanvas.getContext('2d');
    ctx.strokeStyle = MASK_COLOR;
    ctx.fillStyle = MASK_COLOR;
    ctx.lineWidth = this.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    this.doc.fc.requestRenderAll();
  }

  _drawRectPreview(a, b) {
    if (this.rectPreview) this.doc.fc.remove(this.rectPreview);
    this.rectPreview = new fabric.Rect({
      left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
      fill: 'rgba(255,60,60,0.35)', stroke: MASK_COLOR, strokeWidth: 1,
      selectable: false, evented: false, psUI: true, excludeFromExport: true,
    });
    this.doc.fc.add(this.rectPreview);
    this.doc.fc.requestRenderAll();
  }

  clearMask() {
    this.maskCanvas?.getContext('2d').clearRect(0, 0, this.maskCanvas.width, this.maskCanvas.height);
    this.doc.fc.requestRenderAll();
  }

  // ---------- UI ----------

  _buildUI(ui) {
    ui.setTitle('Heal');
    const modeBtns = ['brush', 'rect'].map(m => h('button', {
      class: this.mode === m ? 'active' : '',
      onclick: (e) => {
        this.mode = m;
        modeBtns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    }, m === 'brush' ? '🖌 Brush' : '▭ Rect'));

    const sizeVal = h('span', {}, `${this.size}px`);
    const sizeIn = h('input', { type: 'range', min: '5', max: '300', value: String(this.size),
      oninput: () => { this.size = Number(sizeIn.value); sizeVal.textContent = `${this.size}px`; } });

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
    this.genBtn = h('button', { class: 'primary', onclick: () => this.generate() }, '✦ Generate fill');

    ui.body.replaceChildren(
      h('div', { class: 'row' }, modeBtns),
      h('label', {}, 'Brush size ', sizeVal), sizeIn,
      h('button', { class: 'secondary', onclick: () => this.clearMask() }, 'Clear mask'),
      h('label', {}, 'Instructions'), this.promptIn,
      h('div', { class: 'field-row' }, h('label', {}, 'Provider'), this.providerSel),
      h('div', { class: 'field-row' }, h('label', {}, 'Quality'), this.qualitySel, this.nSel),
      this.costLine,
      this.genBtn,
      this.errLine,
      h('p', { class: 'hint' }, 'Paint over blemishes/objects to remove, then Generate. Pixels outside the painted mask are never touched.'),
    );
    this._updateCost();
  }

  _updateCost() {
    const cost = estimateCost(this.providerSel.value, this.quality, this.n);
    this.costLine.textContent = cost > 0 ? `Estimated cost: ~$${cost.toFixed(3)}` : 'Free (mock provider)';
  }

  // ---------- generate / preview / commit ----------

  async generate() {
    if (this.busy) return;
    this.busy = true;
    this.errLine.textContent = '';
    this.genBtn.disabled = true;
    this.genBtn.innerHTML = '<span class="spinner"></span>Generating…';
    setStatus('Generating heal variants…');
    try {
      const params = {
        doc: this.doc, maskCanvas: this.maskCanvas,
        prompt: this.prompt, provider: this.providerSel.value,
        quality: this.quality, n: this.n,
      };
      const { region, composites, rawBlobs } = await runHeal(params);
      this.region = region;
      this.composites = composites;
      addHistory({
        op: 'heal', prompt: this.prompt, provider: params.provider,
        blobs: rawBlobs, cost: estimateCost(params.provider, this.quality, this.n),
      });
      if (this.viz) this.viz.visible = false;
      const thumbBlobs = await Promise.all(composites.map(c => canvasToBlob(c)));
      showCandidates({
        blobs: thumbBlobs,
        onPreview: (i) => this._preview(i),
        onCommit: (i) => this._commit(i),
        onDiscard: () => {
          this._preview(null);
          if (this.viz) { this.viz.visible = true; this.doc.fc.requestRenderAll(); }
        },
        onMore: async () => {
          const { composites: more, rawBlobs: moreRaw } = await runHeal(params);
          this.composites.push(...more);
          addHistory({ op: 'heal', prompt: this.prompt, provider: params.provider, blobs: moreRaw, cost: estimateCost(params.provider, this.quality, this.n) });
          return Promise.all(more.map(c => canvasToBlob(c)));
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
      this.genBtn.textContent = '✦ Generate fill';
    }
  }

  _preview(i) {
    if (this.previewObj) {
      this.doc.fc.remove(this.previewObj);
      this.previewObj = null;
    }
    if (i != null && this.composites?.[i]) {
      this.previewObj = new FImage(this.composites[i], {
        left: this.region.x, top: this.region.y,
        selectable: false, evented: false,
        psUI: true, excludeFromExport: true, objectCaching: false,
      });
      this.doc.fc.add(this.previewObj);
    }
    this.doc.fc.requestRenderAll();
  }

  _commit(i) {
    this._preview(null);
    commitRegion(this.doc, this.region, this.composites[i], 'heal');
    this.clearMask();
    if (this.viz) { this.viz.visible = true; this.doc.fc.requestRenderAll(); }
    setStatus('Heal applied.');
  }
}
