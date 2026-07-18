// Background removal tool: API-derived alpha mask on original pixels,
// with a restore/erase refine brush before committing.
import { h, setStatus } from '../util.js';
import { runBgRemove, applyKeepMask } from '../ops/bgremove.js';
import { maskProviders, estimateCost } from '../ai/providers.js';
import { addHistory } from '../ai/history.js';
import { canvasToBlob } from '../util.js';

const FImage = fabric.FabricImage || fabric.Image;

export class BgRemoveTool {
  constructor(doc) {
    this.doc = doc;
    this.quality = 'medium';
    this.brushSize = 40;
    this.brushMode = 'restore'; // restore | erase
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
    this._up = () => { this.painting = false; };
    fc.on('mouse:down', this._down);
    fc.on('mouse:move', this._move);
    fc.on('mouse:up', this._up);
    this._buildIdleUI();
  }

  deactivate() {
    const fc = this.doc.fc;
    fc.off('mouse:down', this._down);
    fc.off('mouse:move', this._move);
    fc.off('mouse:up', this._up);
    this._exitRefine(false);
    fc.selection = true;
    fc.skipTargetFind = false;
    fc.defaultCursor = 'default';
  }

  // ---------- UI states ----------

  _buildIdleUI() {
    this.ui.setTitle('Remove background');
    this.providerSel = h('select', { onchange: () => this._updateCost() },
      maskProviders().map(p => h('option', { value: p.id }, p.label)));
    this.qualitySel = h('select', { onchange: () => { this.quality = this.qualitySel.value; this._updateCost(); } },
      ['low', 'medium', 'high'].map(q => h('option', { value: q, selected: q === this.quality }, q)));
    this.costLine = h('div', { class: 'cost-line' });
    this.errLine = h('div', { class: 'hint', style: 'color:var(--danger)' });
    this.goBtn = h('button', { class: 'primary', onclick: () => this.run() }, '☒ Remove background');
    this.ui.body.replaceChildren(
      h('div', { class: 'field-row' }, h('label', {}, 'Provider'), this.providerSel),
      h('div', { class: 'field-row' }, h('label', {}, 'Quality'), this.qualitySel),
      this.costLine,
      this.goBtn,
      this.errLine,
      h('p', { class: 'hint' }, 'The AI only supplies the cut-out mask — the kept pixels are your originals, untouched. You can refine the edges before applying.'),
    );
    this._updateCost();
  }

  _buildRefineUI() {
    this.ui.setTitle('Refine cut-out');
    const modeBtns = [['restore', '↩ Restore'], ['erase', '✖ Erase']].map(([m, label]) =>
      h('button', {
        class: this.brushMode === m ? 'active' : '',
        onclick: (e) => {
          this.brushMode = m;
          modeBtns.forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
        },
      }, label));
    const sizeVal = h('span', {}, `${this.brushSize}px`);
    const sizeIn = h('input', { type: 'range', min: '5', max: '300', value: String(this.brushSize),
      oninput: () => { this.brushSize = Number(sizeIn.value); sizeVal.textContent = `${this.brushSize}px`; } });
    this.ui.body.replaceChildren(
      h('p', { class: 'hint' }, 'Paint to fix the mask: Restore brings original pixels back, Erase removes.'),
      h('div', { class: 'row' }, modeBtns),
      h('label', {}, 'Brush size ', sizeVal), sizeIn,
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => this.apply() }, 'Apply'),
        h('button', { class: 'secondary', onclick: () => { this._exitRefine(false); this._buildIdleUI(); } }, 'Cancel'),
      ),
      h('button', { class: 'secondary', onclick: () => { this._exitRefine(false); this.run(); } }, '↻ Regenerate mask'),
    );
  }

  _updateCost() {
    const cost = estimateCost(this.providerSel.value, this.quality, 1);
    this.costLine.textContent = cost > 0 ? `Estimated cost: ~$${cost.toFixed(3)}` : 'Free (mock provider)';
  }

  // ---------- pipeline ----------

  async run() {
    if (this.busy) return;
    this.busy = true;
    this.errLine.textContent = '';
    this.goBtn.disabled = true;
    this.goBtn.innerHTML = '<span class="spinner"></span>Removing…';
    setStatus('Computing background mask…');
    try {
      const provider = this.providerSel.value;
      this.mask = await runBgRemove({ doc: this.doc, provider, quality: this.quality });
      this._enterRefine();
      const previewBlob = await canvasToBlob(this.previewCanvas);
      addHistory({ op: 'bg-remove', prompt: '', provider, blobs: [previewBlob], cost: estimateCost(provider, this.quality, 1) });
      this._buildRefineUI();
      setStatus('Refine the mask, then Apply.');
    } catch (e) {
      console.error(e);
      this.errLine.textContent = e.message || String(e);
      setStatus('');
    } finally {
      this.busy = false;
      if (this.goBtn) { this.goBtn.disabled = false; this.goBtn.textContent = '☒ Remove background'; }
    }
  }

  _enterRefine() {
    this.previewCanvas = applyKeepMask(this.doc.baseCanvas, this.mask);
    this.previewObj = new FImage(this.previewCanvas, {
      left: 0, top: 0, selectable: false, evented: false,
      psUI: true, excludeFromExport: true, objectCaching: false,
    });
    this.doc.baseImage.visible = false;
    this.doc.fc.add(this.previewObj);
    this.doc.fc.requestRenderAll();
    this.refining = true;
  }

  _exitRefine(committed) {
    if (this.previewObj) {
      this.doc.fc.remove(this.previewObj);
      this.previewObj = null;
    }
    if (this.doc.baseImage) this.doc.baseImage.visible = true;
    this.refining = false;
    this.doc.fc.requestRenderAll();
    if (!committed) this.mask = null;
  }

  _refreshPreview() {
    const ctx = this.previewCanvas.getContext('2d');
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, this.previewCanvas.width, this.previewCanvas.height);
    ctx.drawImage(this.doc.baseCanvas, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(this.mask, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    this.doc.fc.requestRenderAll();
  }

  // ---------- refine painting ----------

  _onDown(opt) {
    if (!this.refining || this.busy || opt.e.button !== 0) return;
    this.painting = true;
    this.last = this.doc.scenePoint(opt.e);
    this._stroke(this.last, this.last);
  }

  _onMove(opt) {
    if (!this.painting) return;
    const p = this.doc.scenePoint(opt.e);
    this._stroke(this.last, p);
    this.last = p;
  }

  _stroke(from, to) {
    const ctx = this.mask.getContext('2d');
    ctx.globalCompositeOperation = this.brushMode === 'restore' ? 'source-over' : 'destination-out';
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = this.brushSize;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(to.x, to.y);
    ctx.stroke();
    ctx.globalCompositeOperation = 'source-over';
    this._refreshPreview();
  }

  // ---------- commit ----------

  async apply() {
    const base = this.doc.baseCanvas;
    const ctx = base.getContext('2d');
    ctx.clearRect(0, 0, base.width, base.height);
    ctx.drawImage(this.previewCanvas, 0, 0);
    this._exitRefine(true);
    this.doc.refreshBase();
    await this.doc.commit('remove background');
    this._buildIdleUI();
    setStatus('Background removed.');
  }
}
