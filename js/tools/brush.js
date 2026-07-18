// Freehand brush: Fabric PencilBrush. Strokes become overlay objects
// (selectable/deletable with the Move tool).
import { h } from '../util.js';

export class BrushTool {
  constructor(doc) {
    this.doc = doc;
    this.color = '#ff4444';
    this.size = 8;
    this.opacity = 100;
  }

  activate(ui) {
    const fc = this.doc.fc;
    fc.discardActiveObject();
    this.brush = new fabric.PencilBrush(fc);
    fc.freeDrawingBrush = this.brush;
    fc.isDrawingMode = true;
    this._applyBrush();
    this._onPath = () => this.doc.commit('brush stroke');
    fc.on('path:created', this._onPath);

    ui.setTitle('Brush');
    const colorIn = h('input', { type: 'color', value: this.color,
      oninput: () => { this.color = colorIn.value; this._applyBrush(); } });
    const sizeVal = h('span', {}, `${this.size}px`);
    const sizeIn = h('input', { type: 'range', min: '1', max: '200', value: String(this.size),
      oninput: () => { this.size = Number(sizeIn.value); sizeVal.textContent = `${this.size}px`; this._applyBrush(); } });
    const opVal = h('span', {}, `${this.opacity}%`);
    const opIn = h('input', { type: 'range', min: '1', max: '100', value: String(this.opacity),
      oninput: () => { this.opacity = Number(opIn.value); opVal.textContent = `${this.opacity}%`; this._applyBrush(); } });
    ui.body.replaceChildren(
      h('div', { class: 'field-row' }, h('label', {}, 'Color'), colorIn),
      h('label', {}, 'Size ', sizeVal), sizeIn,
      h('label', {}, 'Opacity ', opVal), opIn,
      h('p', { class: 'hint' }, 'Strokes are objects — switch to Move (V) to reposition or delete them.'),
    );
  }

  _applyBrush() {
    const a = this.opacity / 100;
    const r = parseInt(this.color.slice(1, 3), 16);
    const g = parseInt(this.color.slice(3, 5), 16);
    const b = parseInt(this.color.slice(5, 7), 16);
    this.brush.color = `rgba(${r},${g},${b},${a})`;
    this.brush.width = this.size;
  }

  deactivate() {
    const fc = this.doc.fc;
    fc.isDrawingMode = false;
    fc.off('path:created', this._onPath);
  }
}
