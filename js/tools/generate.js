// Generate tool, two modes:
//  - Region: drag a rectangle, describe what should appear there → mask-guided
//    edit (same pipeline as heal: only the region changes).
//  - Asset: text-to-image (optionally transparent) inserted as a movable object.
import { h, makeCanvas, canvasToBlob, setStatus } from '../util.js';
import { runHeal, commitRegion } from '../ops/heal.js';
import { maskProviders, genProviders, estimateCost, generate } from '../ai/providers.js';
import { showCandidates, hideCandidates } from '../ai/candidates.js';
import { addHistory } from '../ai/history.js';

const FImage = fabric.FabricImage || fabric.Image;

export class GenerateTool {
  constructor(doc) {
    this.doc = doc;
    this.mode = 'region';
    this.quality = 'medium';
    this.n = 2;
    this.prompt = '';
    this.transparent = true;
    this.busy = false;
  }

  activate(ui) {
    this.ui = ui;
    const fc = this.doc.fc;
    fc.discardActiveObject();
    fc.selection = false;
    fc.skipTargetFind = true;
    fc.defaultCursor = 'crosshair';
    this._down = (o) => this._onDown(o);
    this._move = (o) => this._onMove(o);
    this._up = () => this._onUp();
    fc.on('mouse:down', this._down);
    fc.on('mouse:move', this._move);
    fc.on('mouse:up', this._up);
    this._buildUI();
  }

  deactivate() {
    const fc = this.doc.fc;
    fc.off('mouse:down', this._down);
    fc.off('mouse:move', this._move);
    fc.off('mouse:up', this._up);
    this._clearRegion();
    this._previewRegion(null);
    this._previewAsset(null);
    hideCandidates();
    fc.selection = true;
    fc.skipTargetFind = false;
    fc.defaultCursor = 'default';
  }

  // ---------- region drag ----------

  _onDown(opt) {
    if (this.mode !== 'region' || this.busy || opt.e.button !== 0) return;
    this.dragStart = this.doc.scenePoint(opt.e);
  }

  _onMove(opt) {
    if (!this.dragStart) return;
    this._drawRegionRect(this.dragStart, this.doc.scenePoint(opt.e));
  }

  _onUp() {
    this.dragStart = null;
  }

  _drawRegionRect(a, b) {
    if (this.regionRect) this.doc.fc.remove(this.regionRect);
    this.regionRect = new fabric.Rect({
      left: Math.min(a.x, b.x), top: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
      fill: 'rgba(176,124,255,0.25)', stroke: '#b07cff', strokeWidth: 1,
      strokeDashArray: [5, 3], strokeUniform: true,
      selectable: false, evented: false, psUI: true, excludeFromExport: true,
    });
    this.doc.fc.add(this.regionRect);
    this.doc.fc.requestRenderAll();
  }

  _clearRegion() {
    if (this.regionRect) {
      this.doc.fc.remove(this.regionRect);
      this.regionRect = null;
      this.doc.fc.requestRenderAll();
    }
  }

  // ---------- UI ----------

  _buildUI() {
    this.ui.setTitle('Generate');
    const modeBtns = [['region', '▭ In region'], ['asset', '✦ New asset']].map(([m, label]) =>
      h('button', {
        class: this.mode === m ? 'active' : '',
        onclick: (e) => {
          this.mode = m;
          if (m === 'asset') this._clearRegion();
          modeBtns.forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          this._buildUI();
        },
      }, label));

    this.promptIn = h('textarea', { rows: '3', placeholder: 'Describe what to generate…' }, this.prompt);
    this.promptIn.addEventListener('input', () => { this.prompt = this.promptIn.value; });

    const providers = this.mode === 'region' ? maskProviders() : genProviders();
    this.providerSel = h('select', { onchange: () => this._updateCost() },
      providers.map(p => h('option', { value: p.id }, p.label)));
    this.qualitySel = h('select', { onchange: () => { this.quality = this.qualitySel.value; this._updateCost(); } },
      ['low', 'medium', 'high'].map(q => h('option', { value: q, selected: q === this.quality }, q)));
    this.nSel = h('select', { onchange: () => { this.n = Number(this.nSel.value); this._updateCost(); } },
      [1, 2, 3, 4].map(v => h('option', { value: String(v), selected: v === this.n }, `${v} variant${v > 1 ? 's' : ''}`)));
    this.costLine = h('div', { class: 'cost-line' });
    this.errLine = h('div', { class: 'hint', style: 'color:var(--danger)' });
    this.genBtn = h('button', { class: 'primary', onclick: () => this.generate() }, '✦ Generate');

    const children = [
      h('div', { class: 'row' }, modeBtns),
      h('label', {}, 'Prompt'), this.promptIn,
      h('div', { class: 'field-row' }, h('label', {}, 'Provider'), this.providerSel),
      h('div', { class: 'field-row' }, h('label', {}, 'Quality'), this.qualitySel, this.nSel),
    ];
    if (this.mode === 'asset') {
      const tChk = h('input', { type: 'checkbox', checked: this.transparent,
        onchange: () => { this.transparent = tChk.checked; } });
      children.push(h('label', { class: 'chk' }, tChk, ' Transparent background'));
    }
    children.push(
      this.costLine, this.genBtn, this.errLine,
      h('p', { class: 'hint' }, this.mode === 'region'
        ? 'Drag a rectangle on the image, describe what should appear there, then Generate. Only the rectangle changes.'
        : 'Generates a standalone image and inserts it as a movable object.'),
    );
    this.ui.body.replaceChildren(...children);
    this._updateCost();
  }

  _updateCost() {
    const cost = estimateCost(this.providerSel.value, this.quality, this.n);
    this.costLine.textContent = cost > 0 ? `Estimated cost: ~$${cost.toFixed(3)}` : 'Free (mock provider)';
  }

  // ---------- generate ----------

  async generate() {
    if (this.busy) return;
    if (!this.prompt.trim()) {
      this.errLine.textContent = 'Enter a prompt first.';
      return;
    }
    this.busy = true;
    this.errLine.textContent = '';
    this.genBtn.disabled = true;
    this.genBtn.innerHTML = '<span class="spinner"></span>Generating…';
    setStatus('Generating…');
    try {
      if (this.mode === 'region') await this._generateRegion();
      else await this._generateAsset();
      setStatus('Hover results to preview, click to apply.');
    } catch (e) {
      console.error(e);
      this.errLine.textContent = e.message || String(e);
      setStatus('');
    } finally {
      this.busy = false;
      this.genBtn.disabled = false;
      this.genBtn.textContent = '✦ Generate';
    }
  }

  async _generateRegion() {
    if (!this.regionRect) throw new Error('Drag a rectangle on the image first.');
    const r = this.regionRect;
    const mask = makeCanvas(this.doc.width, this.doc.height);
    const mctx = mask.getContext('2d');
    mctx.fillStyle = '#f00';
    mctx.fillRect(r.left, r.top, r.width * r.scaleX, r.height * r.scaleY);
    const params = {
      doc: this.doc, maskCanvas: mask,
      prompt: `Within the marked area, add: ${this.prompt}. Blend it naturally with the surrounding image.`,
      provider: this.providerSel.value, quality: this.quality, n: this.n,
    };
    const { region, composites, rawBlobs } = await runHeal(params);
    this.region = region;
    this.composites = composites;
    addHistory({ op: 'generate', prompt: this.prompt, provider: params.provider, blobs: rawBlobs, cost: estimateCost(params.provider, this.quality, this.n) });
    this.regionRect.visible = false;
    const thumbs = await Promise.all(composites.map(c => canvasToBlob(c)));
    showCandidates({
      blobs: thumbs,
      onPreview: (i) => this._previewRegion(i),
      onCommit: (i) => {
        this._previewRegion(null);
        commitRegion(this.doc, this.region, this.composites[i], 'generate in region');
        this._clearRegion();
      },
      onDiscard: () => {
        this._previewRegion(null);
        if (this.regionRect) { this.regionRect.visible = true; this.doc.fc.requestRenderAll(); }
      },
      onMore: async () => {
        const more = await runHeal(params);
        this.composites.push(...more.composites);
        addHistory({ op: 'generate', prompt: this.prompt, provider: params.provider, blobs: more.rawBlobs, cost: estimateCost(params.provider, this.quality, this.n) });
        return Promise.all(more.composites.map(c => canvasToBlob(c)));
      },
    });
    this._previewRegion(0);
  }

  _previewRegion(i) {
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

  async _generateAsset() {
    const provider = this.providerSel.value;
    const side = Math.max(512, Math.round(Math.min(this.doc.width, this.doc.height) * 0.75));
    const blobs = await generate({
      provider, prompt: this.prompt,
      width: side, height: side,
      n: this.n, quality: this.quality,
      transparent: this.transparent,
    });
    const { addSpend } = await import('../ai/providers.js');
    addSpend(estimateCost(provider, this.quality, this.n));
    addHistory({ op: 'asset', prompt: this.prompt, provider, blobs, cost: estimateCost(provider, this.quality, this.n) });
    this.assetUrls = blobs.map(b => URL.createObjectURL(b));
    showCandidates({
      blobs,
      onPreview: (i) => this._previewAsset(i),
      onCommit: (i) => this._commitAsset(i),
      onDiscard: () => this._previewAsset(null),
      onMore: async () => {
        const more = await generate({
          provider, prompt: this.prompt, width: side, height: side,
          n: this.n, quality: this.quality, transparent: this.transparent,
        });
        addHistory({ op: 'asset', prompt: this.prompt, provider, blobs: more, cost: estimateCost(provider, this.quality, this.n) });
        this.assetUrls.push(...more.map(b => URL.createObjectURL(b)));
        return more;
      },
    });
    this._previewAsset(0);
  }

  async _makeAssetImage(i) {
    const img = await FImage.fromURL(this.assetUrls[i]);
    const scale = Math.min(1,
      (this.doc.width * 0.5) / img.width,
      (this.doc.height * 0.5) / img.height);
    img.set({
      left: this.doc.width / 2 - (img.width * scale) / 2,
      top: this.doc.height / 2 - (img.height * scale) / 2,
      scaleX: scale, scaleY: scale,
    });
    return img;
  }

  async _previewAsset(i) {
    if (this.assetPreview) {
      this.doc.fc.remove(this.assetPreview);
      this.assetPreview = null;
    }
    if (i != null && this.assetUrls?.[i]) {
      const img = await this._makeAssetImage(i);
      img.set({ selectable: false, evented: false, psUI: true, excludeFromExport: true, opacity: 0.9 });
      this.assetPreview = img;
      this.doc.fc.add(img);
    }
    this.doc.fc.requestRenderAll();
  }

  async _commitAsset(i) {
    await this._previewAsset(null);
    const img = await this._makeAssetImage(i);
    img.set({ psAsset: true });
    this.doc.fc.add(img);
    this.doc.fc.requestRenderAll();
    await this.doc.commit('add asset');
    setStatus('Asset added — switch to Move (V) to position it.');
  }
}
