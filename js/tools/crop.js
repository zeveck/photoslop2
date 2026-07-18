// Crop tool: draggable/resizable crop rectangle with aspect-ratio presets,
// dimmed surround and rule-of-thirds grid.
import { h, clamp } from '../util.js';

const PRESETS = [
  ['Free', null], ['Original', 'orig'], ['1:1', 1],
  ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9],
  ['3:4', 3 / 4], ['2:3', 2 / 3], ['9:16', 9 / 16], ['5:4', 5 / 4],
];

export class CropTool {
  constructor(doc, { onDone }) {
    this.doc = doc;
    this.onDone = onDone; // switch back to move tool after apply/cancel
  }

  activate(ui) {
    const doc = this.doc, fc = doc.fc;
    fc.discardActiveObject();
    fc.selection = false;
    this._savedEvented = new Map();
    for (const o of doc.overlayObjects()) {
      this._savedEvented.set(o, o.evented);
      o.evented = false;
    }
    this.ar = null;
    this._buildRect();
    this._buildShades();
    ui.setTitle('Crop');
    const select = h('select', {
      onchange: () => {
        const v = select.value;
        this.ar = v === 'null' ? null : (v === 'orig' ? doc.width / doc.height : Number(v));
        this._applyAR();
      },
    }, PRESETS.map(([label, v]) => h('option', { value: String(v) }, label)));
    ui.body.replaceChildren(
      h('div', { class: 'field-row' }, h('label', {}, 'Aspect'), select),
      h('div', { class: 'row' },
        h('button', { class: 'primary', onclick: () => this.apply() }, 'Apply crop'),
        h('button', { class: 'secondary', onclick: () => this.onDone() }, 'Cancel'),
      ),
      h('p', { class: 'hint' }, 'Drag inside to move, handles to resize. Enter applies, Esc cancels.'),
    );
  }

  _buildRect() {
    const doc = this.doc, fc = this.doc.fc;
    const w = doc.width * 0.9, hgt = doc.height * 0.9;
    this.rect = new fabric.Rect({
      left: (doc.width - w) / 2, top: (doc.height - hgt) / 2,
      width: w, height: hgt,
      fill: 'rgba(0,0,0,0)',
      stroke: '#4f8cff', strokeWidth: 1, strokeUniform: true,
      cornerColor: '#4f8cff', cornerStyle: 'rect', transparentCorners: false,
      lockRotation: true,
      psUI: true, excludeFromExport: true,
      objectCaching: false,
    });
    this.rect.setControlsVisibility({ mtr: false });
    fc.add(this.rect);
    fc.setActiveObject(this.rect);
    const update = () => this._updateShades();
    this.rect.on('moving', () => { this._clampMove(); update(); });
    this.rect.on('scaling', update);
    this.rect.on('modified', () => { this._normalize(); update(); });
    fc.on('selection:cleared', this._reselect = () => {
      if (this.rect && fc.getObjects().includes(this.rect)) fc.setActiveObject(this.rect);
    });
    fc.requestRenderAll();
  }

  _buildShades() {
    const fc = this.doc.fc;
    const mk = () => new fabric.Rect({
      fill: 'rgba(0,0,0,0.55)', selectable: false, evented: false,
      psUI: true, excludeFromExport: true, objectCaching: false,
    });
    this.shades = [mk(), mk(), mk(), mk()];
    this.gridLines = [0, 1, 2, 3].map(() => new fabric.Line([0, 0, 0, 0], {
      stroke: 'rgba(255,255,255,0.45)', strokeWidth: 1, strokeUniform: true,
      selectable: false, evented: false, psUI: true, excludeFromExport: true,
    }));
    for (const s of [...this.shades, ...this.gridLines]) fc.add(s);
    this._updateShades();
  }

  _bounds() {
    const r = this.rect;
    return {
      x: r.left, y: r.top,
      w: r.width * r.scaleX, h: r.height * r.scaleY,
    };
  }

  _clampMove() {
    const doc = this.doc, b = this._bounds();
    this.rect.left = clamp(this.rect.left, 0, Math.max(0, doc.width - b.w));
    this.rect.top = clamp(this.rect.top, 0, Math.max(0, doc.height - b.h));
  }

  // After a scale gesture: bake scale into width/height and clamp into doc.
  _normalize() {
    const doc = this.doc, r = this.rect;
    let { x, y, w, h } = this._bounds();
    x = clamp(x, 0, doc.width - 1); y = clamp(y, 0, doc.height - 1);
    w = clamp(w, 8, doc.width - x); h = clamp(h, 8, doc.height - y);
    if (this.ar) {
      if (w / h > this.ar) w = h * this.ar; else h = w / this.ar;
    }
    r.set({ left: x, top: y, width: w, height: h, scaleX: 1, scaleY: 1 });
    r.setCoords();
    this.doc.fc.requestRenderAll();
  }

  _applyAR() {
    const doc = this.doc, r = this.rect;
    if (this.ar) {
      let w = doc.width * 0.9, h = w / this.ar;
      if (h > doc.height * 0.9) { h = doc.height * 0.9; w = h * this.ar; }
      r.set({
        left: (doc.width - w) / 2, top: (doc.height - h) / 2,
        width: w, height: h, scaleX: 1, scaleY: 1,
      });
      r.setControlsVisibility({ ml: false, mr: false, mt: false, mb: false, mtr: false });
      this.doc.fc.uniformScaling = true;
    } else {
      r.setControlsVisibility({ ml: true, mr: true, mt: true, mb: true, mtr: false });
      this.doc.fc.uniformScaling = false;
    }
    r.setCoords();
    this._updateShades();
    this.doc.fc.requestRenderAll();
  }

  _updateShades() {
    const doc = this.doc, b = this._bounds();
    const W = doc.width, H = doc.height;
    const [top, bottom, left, right] = this.shades;
    top.set({ left: 0, top: 0, width: W, height: Math.max(0, b.y) });
    bottom.set({ left: 0, top: b.y + b.h, width: W, height: Math.max(0, H - b.y - b.h) });
    left.set({ left: 0, top: b.y, width: Math.max(0, b.x), height: b.h });
    right.set({ left: b.x + b.w, top: b.y, width: Math.max(0, W - b.x - b.w), height: b.h });
    const [v1, v2, h1, h2] = this.gridLines;
    v1.set({ x1: b.x + b.w / 3, y1: b.y, x2: b.x + b.w / 3, y2: b.y + b.h });
    v2.set({ x1: b.x + 2 * b.w / 3, y1: b.y, x2: b.x + 2 * b.w / 3, y2: b.y + b.h });
    h1.set({ x1: b.x, y1: b.y + b.h / 3, x2: b.x + b.w, y2: b.y + b.h / 3 });
    h2.set({ x1: b.x, y1: b.y + 2 * b.h / 3, x2: b.x + b.w, y2: b.y + 2 * b.h / 3 });
    this.doc.fc.requestRenderAll();
  }

  async apply() {
    this._normalize();
    const b = this._bounds();
    this._teardown();
    await this.doc.applyCrop(b.x, b.y, b.w, b.h);
    this.onDone();
  }

  onKey(e) {
    if (e.key === 'Enter') { this.apply(); return true; }
    if (e.key === 'Escape') { this.onDone(); return true; }
    return false;
  }

  _teardown() {
    const fc = this.doc.fc;
    fc.off('selection:cleared', this._reselect);
    fc.discardActiveObject();
    fc.remove(this.rect, ...this.shades, ...this.gridLines);
    for (const [o, evented] of this._savedEvented) o.evented = evented;
    this._savedEvented.clear();
    fc.uniformScaling = true;
    fc.requestRenderAll();
  }

  deactivate() {
    if (this.rect) this._teardown();
    this.rect = null;
  }
}
