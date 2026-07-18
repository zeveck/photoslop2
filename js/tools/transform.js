// Transform tool: 90° rotations and a fine straighten slider with live
// viewport preview (pixels are only rewritten on Apply).
import { h } from '../util.js';

export class TransformTool {
  constructor(doc) { this.doc = doc; }

  activate(ui) {
    const doc = this.doc;
    doc.fc.discardActiveObject();
    doc.fc.selection = false;
    doc.fc.skipTargetFind = true;
    this._vpt0 = doc.fc.viewportTransform.slice();
    this.angle = 0;

    ui.setTitle('Rotate / Straighten');
    const angleVal = h('span', {}, '0.0°');
    const slider = h('input', {
      type: 'range', min: '-15', max: '15', step: '0.1', value: '0',
      oninput: () => {
        this.angle = Number(slider.value);
        angleVal.textContent = `${this.angle.toFixed(1)}°`;
        this._preview();
      },
    });
    this.cropChk = h('input', { type: 'checkbox', checked: true });
    ui.body.replaceChildren(
      h('div', { class: 'row' },
        h('button', { onclick: () => this._rotate(-1) }, '⟲ 90° CCW'),
        h('button', { onclick: () => this._rotate(1) }, '⟳ 90° CW'),
      ),
      h('label', {}, 'Straighten ', angleVal),
      slider,
      h('label', { class: 'chk' }, this.cropChk, ' Crop to avoid transparent corners'),
      h('div', { class: 'row' },
        h('button', {
          class: 'primary',
          onclick: async () => {
            if (Math.abs(this.angle) < 0.05) return;
            this._resetPreview();
            await this.doc.applyStraighten(this.angle, this.cropChk.checked);
            slider.value = '0'; this.angle = 0; angleVal.textContent = '0.0°';
            this._vpt0 = this.doc.fc.viewportTransform.slice();
          },
        }, 'Apply straighten'),
        h('button', {
          class: 'secondary',
          onclick: () => { slider.value = '0'; this.angle = 0; angleVal.textContent = '0.0°'; this._resetPreview(); },
        }, 'Reset'),
      ),
      h('p', { class: 'hint' }, 'Slider previews live; Apply rewrites pixels.'),
    );
  }

  async _rotate(dir) {
    this._resetPreview();
    await this.doc.applyRotate90(dir);
    this._vpt0 = this.doc.fc.viewportTransform.slice();
  }

  // Preview by rotating the viewport around the visible center.
  _preview() {
    const fc = this.doc.fc;
    const rad = this.angle * Math.PI / 180;
    const cx = fc.getWidth() / 2, cy = fc.getHeight() / 2;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    // T(c) · R · T(-c) composed with the original viewport transform
    const rot = [cos, sin, -sin, cos,
      cx - cos * cx + sin * cy,
      cy - sin * cx - cos * cy];
    const m = fabric.util.multiplyTransformMatrices(rot, this._vpt0);
    fc.setViewportTransform(m);
  }

  _resetPreview() {
    this.doc.fc.setViewportTransform(this._vpt0.slice());
  }

  deactivate() {
    this._resetPreview();
    this.doc.fc.skipTargetFind = false;
    this.doc.fc.selection = true;
  }
}
