// EditorDocument: owns the base bitmap (real pixels), the Fabric canvas
// (overlay objects + view), and the undo/redo stack.
//
// Invariant: the base bitmap in `baseCanvas` is the source of truth for
// pixels. Destructive ops rewrite it; AI ops composite into it. Overlay
// objects (text, shapes, strokes, assets) stay editable above it.

import { makeCanvas, cloneCanvas, canvasToBlob, blobToCanvas, clamp, rotatedRectWithMaxArea } from './util.js';

const FImage = fabric.FabricImage || fabric.Image;

// Fabric v7 defaults objects to center-origin; this app positions everything
// by top-left corner in document pixel coordinates.
fabric.FabricObject.ownDefaults.originX = 'left';
fabric.FabricObject.ownDefaults.originY = 'top';
const MAX_HISTORY = 30;
// Extra props to keep when serializing overlay objects for undo.
const SERIALIZE_PROPS = ['selectable', 'evented', 'psAsset'];

function makeCheckerPattern() {
  const t = makeCanvas(16, 16);
  const ctx = t.getContext('2d');
  ctx.fillStyle = '#3a3a3a'; ctx.fillRect(0, 0, 16, 16);
  ctx.fillStyle = '#4a4a4a'; ctx.fillRect(0, 0, 8, 8); ctx.fillRect(8, 8, 8, 8);
  return new fabric.Pattern({ source: t, repeat: 'repeat' });
}

export class EditorDocument extends EventTarget {
  constructor(canvasEl, containerEl) {
    super();
    this.containerEl = containerEl;
    this.fc = new fabric.Canvas(canvasEl, {
      selection: true,
      preserveObjectStacking: true,
      stopContextMenu: true,
      fireRightClick: false,
    });
    this.baseCanvas = null;   // offscreen canvas with the document's pixels
    this.baseImage = null;    // fabric wrapper for baseCanvas
    this.checkerRect = null;
    this._states = [];
    this._stateIndex = -1;
    this._baseBlob = null;    // cached PNG of baseCanvas for history sharing
    this._silent = false;

    // Track user-driven overlay edits for undo.
    const onUserEdit = () => { if (!this._silent) this.commit('edit'); };
    this.fc.on('object:modified', onUserEdit);
    this.fc.on('object:removed', (e) => {
      if (!this._silent && !e.target?.psUI && !e.target?.psBase) this.commit('delete');
    });

    new ResizeObserver(() => this._onContainerResize()).observe(containerEl);
    this._onContainerResize();
  }

  get width() { return this.baseCanvas ? this.baseCanvas.width : 0; }
  get height() { return this.baseCanvas ? this.baseCanvas.height : 0; }
  get hasImage() { return !!this.baseCanvas; }

  scenePoint(e) {
    return this.fc.getScenePoint ? this.fc.getScenePoint(e) : this.fc.getPointer(e);
  }

  // ---------- open / base management ----------

  async open(canvas) {
    this._silent = true;
    this.fc.clear();
    this.baseCanvas = canvas;
    this._baseBlob = null;
    this._installBaseObjects();
    this._silent = false;
    this._states = [];
    this._stateIndex = -1;
    await this.commit('open');
    this.fitToWindow();
    this._emit('change');
  }

  _installBaseObjects() {
    const w = this.baseCanvas.width, h = this.baseCanvas.height;
    this.checkerRect = new fabric.Rect({
      left: 0, top: 0, width: w, height: h,
      fill: makeCheckerPattern(),
      selectable: false, evented: false,
      excludeFromExport: true, psUI: true,
      objectCaching: false,
    });
    this.baseImage = new FImage(this.baseCanvas, {
      left: 0, top: 0,
      selectable: false, evented: false,
      psBase: true, objectCaching: false,
    });
    this.fc.add(this.checkerRect, this.baseImage);
    this.fc.sendObjectToBack(this.baseImage);
    this.fc.sendObjectToBack(this.checkerRect);
    this.fc.requestRenderAll();
  }

  // Call after mutating baseCanvas pixels in place (same dimensions).
  refreshBase() {
    this._baseBlob = null;
    if (this.baseImage) this.baseImage.dirty = true;
    this.fc.requestRenderAll();
  }

  // Replace the base bitmap (possibly different dimensions).
  // transformOverlay: optional fn(obj) that repositions each overlay object.
  _setBaseCanvas(newCanvas, transformOverlay) {
    const overlays = this.overlayObjects();
    this._silent = true;
    if (this.baseImage) this.fc.remove(this.baseImage);
    if (this.checkerRect) this.fc.remove(this.checkerRect);
    this.baseCanvas = newCanvas;
    this._baseBlob = null;
    this._installBaseObjects();
    if (transformOverlay) {
      for (const o of overlays) { transformOverlay(o); o.setCoords(); }
    }
    this._silent = false;
    this.fc.requestRenderAll();
    this._emit('change');
  }

  overlayObjects() {
    return this.fc.getObjects().filter(o => !o.psBase && !o.psUI);
  }

  // ---------- destructive ops ----------

  async applyCrop(x, y, w, h) {
    x = Math.round(x); y = Math.round(y);
    w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
    const c = makeCanvas(w, h);
    c.getContext('2d').drawImage(this.baseCanvas, -x, -y);
    this._setBaseCanvas(c, (o) => {
      const p = o.getCenterPoint();
      o.setPositionByOrigin(new fabric.Point(p.x - x, p.y - y), 'center', 'center');
    });
    this.fitToWindow();
    await this.commit('crop');
  }

  async applyRotate90(dir) { // dir: 1 = CW, -1 = CCW
    const w = this.width, h = this.height;
    const c = makeCanvas(h, w);
    const ctx = c.getContext('2d');
    ctx.translate(h / 2, w / 2);
    ctx.rotate(dir * Math.PI / 2);
    ctx.drawImage(this.baseCanvas, -w / 2, -h / 2);
    this._setBaseCanvas(c, (o) => {
      const p = o.getCenterPoint();
      const np = dir === 1
        ? new fabric.Point(h - p.y, p.x)
        : new fabric.Point(p.y, w - p.x);
      o.setPositionByOrigin(np, 'center', 'center');
      o.angle = (o.angle + dir * 90) % 360;
    });
    this.fitToWindow();
    await this.commit(dir === 1 ? 'rotate 90° CW' : 'rotate 90° CCW');
  }

  async applyStraighten(angleDeg, cropToFit = true) {
    const rad = angleDeg * Math.PI / 180;
    const w = this.width, h = this.height;
    const sin = Math.abs(Math.sin(rad)), cos = Math.abs(Math.cos(rad));
    let outW, outH, offX, offY;
    if (cropToFit) {
      const r = rotatedRectWithMaxArea(w, h, rad);
      outW = Math.max(1, Math.floor(r.w)); outH = Math.max(1, Math.floor(r.h));
    } else {
      outW = Math.ceil(w * cos + h * sin); outH = Math.ceil(w * sin + h * cos);
    }
    const c = makeCanvas(outW, outH);
    const ctx = c.getContext('2d');
    ctx.translate(outW / 2, outH / 2);
    ctx.rotate(rad);
    ctx.drawImage(this.baseCanvas, -w / 2, -h / 2);
    const cx = w / 2, cy = h / 2;
    this._setBaseCanvas(c, (o) => {
      const p = o.getCenterPoint();
      // rotate around old center, then re-origin to new canvas center
      const dx = p.x - cx, dy = p.y - cy;
      const nx = dx * Math.cos(rad) - dy * Math.sin(rad) + outW / 2;
      const ny = dx * Math.sin(rad) + dy * Math.cos(rad) + outH / 2;
      o.setPositionByOrigin(new fabric.Point(nx, ny), 'center', 'center');
      o.angle = o.angle + angleDeg;
    });
    this.fitToWindow();
    await this.commit(`straighten ${angleDeg.toFixed(1)}°`);
  }

  // Replace base with an expanded canvas; the old document sits at (ox, oy).
  async applyExpand(newCanvas, ox, oy) {
    this._setBaseCanvas(newCanvas, (o) => {
      const p = o.getCenterPoint();
      o.setPositionByOrigin(new fabric.Point(p.x + ox, p.y + oy), 'center', 'center');
    });
    this.fitToWindow();
    await this.commit('generative expand');
  }

  // newCanvas produced elsewhere (e.g. pica resample)
  async applyResize(newCanvas) {
    const sx = newCanvas.width / this.width, sy = newCanvas.height / this.height;
    this._setBaseCanvas(newCanvas, (o) => {
      const p = o.getCenterPoint();
      o.setPositionByOrigin(new fabric.Point(p.x * sx, p.y * sy), 'center', 'center');
      o.scaleX *= sx; o.scaleY *= sy;
    });
    this.fitToWindow();
    await this.commit('resize');
  }

  // ---------- view ----------

  _onContainerResize() {
    const r = this.containerEl.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.fc.setDimensions({ width: r.width, height: r.height });
    if (this.hasImage) this.fc.requestRenderAll();
  }

  get zoom() { return this.fc.getZoom(); }

  setZoom(z, aroundViewportPoint) {
    z = clamp(z, 0.02, 32);
    const p = aroundViewportPoint ||
      new fabric.Point(this.fc.getWidth() / 2, this.fc.getHeight() / 2);
    this.fc.zoomToPoint(p, z);
    this._emit('zoom');
  }

  fitToWindow() {
    if (!this.hasImage) return;
    const cw = this.fc.getWidth(), ch = this.fc.getHeight();
    const z = Math.min(cw / this.width, ch / this.height, 1) * 0.98;
    const vpt = [z, 0, 0, z,
      (cw - this.width * z) / 2,
      (ch - this.height * z) / 2];
    this.fc.setViewportTransform(vpt);
    this._emit('zoom');
  }

  panBy(dx, dy) {
    const vpt = this.fc.viewportTransform.slice();
    vpt[4] += dx; vpt[5] += dy;
    this.fc.setViewportTransform(vpt);
  }

  // ---------- undo / redo ----------

  async commit(label) {
    if (this._silent || !this.hasImage) return;
    if (!this._baseBlob) this._baseBlob = await canvasToBlob(this.baseCanvas);
    const overlays = this.overlayObjects().map(o => o.toObject(SERIALIZE_PROPS));
    this._states.length = this._stateIndex + 1;
    this._states.push({
      baseBlob: this._baseBlob,
      w: this.width, h: this.height,
      overlays, label,
    });
    if (this._states.length > MAX_HISTORY) this._states.shift();
    this._stateIndex = this._states.length - 1;
    this._emit('history');
  }

  get canUndo() { return this._stateIndex > 0; }
  get canRedo() { return this._stateIndex < this._states.length - 1; }

  async undo() { if (this.canUndo) await this._restore(this._stateIndex - 1); }
  async redo() { if (this.canRedo) await this._restore(this._stateIndex + 1); }

  async _restore(index) {
    const s = this._states[index];
    if (!s) return;
    this._stateIndex = index;
    this._silent = true;
    try {
      const sizeChanged = s.w !== this.width || s.h !== this.height;
      const base = await blobToCanvas(s.baseBlob);
      this.fc.remove(...this.fc.getObjects());
      this.baseCanvas = base;
      this._baseBlob = s.baseBlob;
      this._installBaseObjects();
      if (s.overlays.length) {
        const objs = await fabric.util.enlivenObjects(s.overlays);
        for (const o of objs) this.fc.add(o);
      }
      this.fc.discardActiveObject();
      this.fc.requestRenderAll();
      if (sizeChanged) this.fitToWindow();
    } finally {
      this._silent = false;
    }
    this._emit('change');
    this._emit('history');
  }

  // ---------- export ----------

  // Flatten document (base + overlays, minus UI objects) to a canvas.
  // toCanvasElement crops in viewport coordinates and ignores
  // excludeFromExport, so neutralize the viewport and hide UI objects for
  // the duration of the export render.
  flatten() {
    const prevVpt = this.fc.viewportTransform.slice();
    const hidden = this.fc.getObjects().filter(o => (o.psUI || o.excludeFromExport) && o.visible);
    for (const o of hidden) o.visible = false;
    this.fc.setViewportTransform([1, 0, 0, 1, 0, 0]);
    try {
      return this.fc.toCanvasElement(1, {
        left: 0, top: 0, width: this.width, height: this.height,
      });
    } finally {
      this.fc.setViewportTransform(prevVpt);
      for (const o of hidden) o.visible = true;
      this.fc.requestRenderAll();
    }
  }

  _emit(type) { this.dispatchEvent(new Event(type)); }
}
