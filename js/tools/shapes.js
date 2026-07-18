// Shapes tool: drag to draw rect / ellipse / line / arrow.
import { h } from '../util.js';

export class ShapeTool {
  constructor(doc) {
    this.doc = doc;
    this.kind = 'arrow';
    this.stroke = '#ff4444';
    this.fill = 'transparent';
    this.fillOn = false;
    this.strokeWidth = 6;
  }

  activate(ui) {
    const fc = this.doc.fc;
    fc.discardActiveObject();
    fc.selection = false;
    fc.skipTargetFind = true;
    fc.defaultCursor = 'crosshair';

    this._down = (opt) => this._start(opt);
    this._move = (opt) => this._drag(opt);
    this._up = () => this._end();
    fc.on('mouse:down', this._down);
    fc.on('mouse:move', this._move);
    fc.on('mouse:up', this._up);

    ui.setTitle('Shapes');
    const kinds = [['rect', '▭'], ['ellipse', '◯'], ['line', '╱'], ['arrow', '➔']];
    const btns = kinds.map(([k, icon]) => h('button', {
      class: this.kind === k ? 'active' : '',
      title: k,
      onclick: (e) => {
        this.kind = k;
        btns.forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
      },
    }, icon));
    const strokeIn = h('input', { type: 'color', value: this.stroke,
      oninput: () => { this.stroke = strokeIn.value; } });
    const fillIn = h('input', { type: 'color', value: '#ffcc00',
      oninput: () => { if (this.fillOn) this.fill = fillIn.value; } });
    const fillChk = h('input', { type: 'checkbox',
      onchange: () => { this.fillOn = fillChk.checked; this.fill = this.fillOn ? fillIn.value : 'transparent'; } });
    const swVal = h('span', {}, `${this.strokeWidth}px`);
    const swIn = h('input', { type: 'range', min: '1', max: '40', value: String(this.strokeWidth),
      oninput: () => { this.strokeWidth = Number(swIn.value); swVal.textContent = `${this.strokeWidth}px`; } });
    ui.body.replaceChildren(
      h('div', { class: 'shape-btns' }, btns),
      h('div', { class: 'field-row' }, h('label', {}, 'Stroke'), strokeIn),
      h('div', { class: 'field-row' }, h('label', { class: 'chk' }, fillChk, 'Fill'), fillIn),
      h('label', {}, 'Thickness ', swVal), swIn,
      h('p', { class: 'hint' }, 'Drag on the canvas to draw. Shift keeps squares/circles.'),
    );
  }

  _start(opt) {
    if (opt.e.button !== 0) return;
    const p = this.doc.scenePoint(opt.e);
    this.origin = p;
    this.obj = null;
  }

  _drag(opt) {
    if (!this.origin) return;
    const p = this.doc.scenePoint(opt.e);
    let x2 = p.x, y2 = p.y;
    if (opt.e.shiftKey && (this.kind === 'rect' || this.kind === 'ellipse')) {
      const dx = x2 - this.origin.x, dy = y2 - this.origin.y;
      const s = Math.max(Math.abs(dx), Math.abs(dy));
      x2 = this.origin.x + Math.sign(dx || 1) * s;
      y2 = this.origin.y + Math.sign(dy || 1) * s;
    }
    if (this.obj) this.doc.fc.remove(this.obj);
    this.obj = this._make(this.origin.x, this.origin.y, x2, y2);
    if (this.obj) {
      this.doc.fc.add(this.obj);
      this.doc.fc.requestRenderAll();
    }
  }

  _make(x1, y1, x2, y2) {
    const common = {
      stroke: this.stroke, strokeWidth: this.strokeWidth,
      fill: this.fill, strokeUniform: true, objectCaching: false,
    };
    const left = Math.min(x1, x2), top = Math.min(y1, y2);
    const w = Math.abs(x2 - x1), hgt = Math.abs(y2 - y1);
    switch (this.kind) {
      case 'rect':
        return new fabric.Rect({ ...common, left, top, width: w, height: hgt });
      case 'ellipse':
        return new fabric.Ellipse({ ...common, left, top, rx: w / 2, ry: hgt / 2 });
      case 'line':
        return new fabric.Line([x1, y1, x2, y2], { ...common, fill: this.stroke });
      case 'arrow':
        return this._makeArrow(x1, y1, x2, y2);
    }
  }

  // Solid arrow as a 7-point polygon from (x1,y1) to (x2,y2).
  _makeArrow(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 2) return null;
    const shaft = Math.max(2, this.strokeWidth);
    const headLen = Math.min(len * 0.6, shaft * 3.2 + 8);
    const headW = shaft * 2.6 + 4;
    const ux = dx / len, uy = dy / len;   // unit along
    const px = -uy, py = ux;              // unit perpendicular
    const bx = x2 - ux * headLen, by = y2 - uy * headLen; // head base
    const pts = [
      { x: x1 + px * shaft / 2, y: y1 + py * shaft / 2 },
      { x: bx + px * shaft / 2, y: by + py * shaft / 2 },
      { x: bx + px * headW / 2, y: by + py * headW / 2 },
      { x: x2, y: y2 },
      { x: bx - px * headW / 2, y: by - py * headW / 2 },
      { x: bx - px * shaft / 2, y: by - py * shaft / 2 },
      { x: x1 - px * shaft / 2, y: y1 - py * shaft / 2 },
    ];
    return new fabric.Polygon(pts, {
      fill: this.stroke, stroke: null, objectCaching: false,
    });
  }

  _end() {
    if (!this.origin) return;
    this.origin = null;
    if (this.obj) {
      const b = this.obj.getBoundingRect();
      if (b.width < 3 && b.height < 3) {
        this.doc.fc.remove(this.obj);
      } else {
        this.obj.setCoords();
        this.doc.commit('shape');
      }
      this.obj = null;
    }
  }

  deactivate() {
    const fc = this.doc.fc;
    fc.off('mouse:down', this._down);
    fc.off('mouse:move', this._move);
    fc.off('mouse:up', this._up);
    fc.selection = true;
    fc.skipTargetFind = false;
    fc.defaultCursor = 'default';
  }
}
