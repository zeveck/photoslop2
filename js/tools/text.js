// Text tool: click to place an editable Textbox; web fonts loaded on demand,
// local fonts via queryLocalFonts() where available (Chromium).
import { h } from '../util.js';

const SYSTEM_FONTS = ['Arial', 'Georgia', 'Times New Roman', 'Courier New', 'Verdana', 'Impact', 'Comic Sans MS'];
const GOOGLE_FONTS = ['Roboto', 'Open Sans', 'Lato', 'Montserrat', 'Oswald', 'Bebas Neue',
  'Playfair Display', 'Merriweather', 'Dancing Script', 'Pacifico', 'Caveat', 'Lobster'];

const loadedGoogleFonts = new Set();

async function ensureFont(family) {
  if (SYSTEM_FONTS.includes(family) || loadedGoogleFonts.has(family)) return;
  if (GOOGLE_FONTS.includes(family)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@400;700&display=swap`;
    document.head.appendChild(link);
    try {
      await document.fonts.load(`16px "${family}"`);
      await document.fonts.load(`bold 16px "${family}"`);
    } catch { /* render with fallback if load fails */ }
    loadedGoogleFonts.add(family);
  }
  // Local fonts need no loading — the browser already has them.
}

export class TextTool {
  constructor(doc) {
    this.doc = doc;
    this.font = 'Arial';
    this.size = 48;
    this.color = '#ffffff';
    this.bold = false;
    this.italic = false;
    this.localFonts = [];
  }

  activate(ui) {
    const fc = this.doc.fc;
    fc.selection = false;
    fc.skipTargetFind = false;   // allow clicking existing text
    fc.defaultCursor = 'text';
    this._down = (opt) => {
      if (opt.e.button !== 0) return;
      if (opt.target) return;                     // clicked an object — let fabric select it
      const active = fc.getActiveObject();
      if (active) { fc.discardActiveObject(); fc.requestRenderAll(); return; }
      this._placeText(this.doc.scenePoint(opt.e));
    };
    fc.on('mouse:down', this._down);
    this._buildUI(ui);
  }

  _buildUI(ui) {
    ui.setTitle('Text');
    this.fontSelect = h('select', {
      onchange: async () => {
        this.font = this.fontSelect.value;
        await ensureFont(this.font);
        this._applyToActive({ fontFamily: this.font });
      },
    });
    this._fillFontSelect();
    const sizeIn = h('input', { type: 'number', min: '6', max: '600', value: String(this.size),
      oninput: () => { this.size = Number(sizeIn.value) || 48; this._applyToActive({ fontSize: this.size }); } });
    const colorIn = h('input', { type: 'color', value: this.color,
      oninput: () => { this.color = colorIn.value; this._applyToActive({ fill: this.color }); } });
    const boldBtn = h('button', { style: 'font-weight:bold', class: this.bold ? 'active' : '',
      onclick: () => { this.bold = !this.bold; boldBtn.classList.toggle('active', this.bold);
        this._applyToActive({ fontWeight: this.bold ? 'bold' : 'normal' }); } }, 'B');
    const italicBtn = h('button', { style: 'font-style:italic', class: this.italic ? 'active' : '',
      onclick: () => { this.italic = !this.italic; italicBtn.classList.toggle('active', this.italic);
        this._applyToActive({ fontStyle: this.italic ? 'italic' : 'normal' }); } }, 'I');
    const children = [
      h('div', { class: 'field-row' }, h('label', {}, 'Font'), this.fontSelect),
      h('div', { class: 'field-row' }, h('label', {}, 'Size'), sizeIn, h('label', {}, 'Color'), colorIn),
      h('div', { class: 'row' }, boldBtn, italicBtn),
    ];
    if ('queryLocalFonts' in window && !this.localFonts.length) {
      children.push(h('button', {
        onclick: async (e) => {
          try {
            const fonts = await window.queryLocalFonts();
            this.localFonts = [...new Set(fonts.map(f => f.family))].sort();
            this._fillFontSelect();
            e.currentTarget.remove();
          } catch (err) { console.warn('queryLocalFonts:', err); }
        },
      }, 'Load this computer’s fonts…'));
    }
    children.push(h('p', { class: 'hint' }, 'Click the canvas to add text. Double-click existing text to edit.'));
    ui.body.replaceChildren(...children);
  }

  _fillFontSelect() {
    const groups = [
      ['System', SYSTEM_FONTS],
      ['Web fonts', GOOGLE_FONTS],
      ...(this.localFonts.length ? [['Local fonts', this.localFonts]] : []),
    ];
    this.fontSelect.replaceChildren(...groups.map(([label, fonts]) =>
      h('optgroup', { label }, fonts.map(f =>
        h('option', { value: f, selected: f === this.font }, f)))));
  }

  async _placeText(p) {
    await ensureFont(this.font);
    const fc = this.doc.fc;
    const tb = new fabric.Textbox('Text', {
      left: p.x, top: p.y - this.size / 2,
      width: Math.max(120, this.size * 4),
      fontFamily: this.font, fontSize: this.size, fill: this.color,
      fontWeight: this.bold ? 'bold' : 'normal',
      fontStyle: this.italic ? 'italic' : 'normal',
    });
    fc.add(tb);
    fc.setActiveObject(tb);
    tb.enterEditing();
    tb.selectAll();
    fc.requestRenderAll();
    this.doc.commit('add text');
  }

  _applyToActive(props) {
    const o = this.doc.fc.getActiveObject();
    if (o && o.type === 'textbox') {
      o.set(props);
      this.doc.fc.requestRenderAll();
      this.doc.commit('text style');
    }
  }

  deactivate() {
    const fc = this.doc.fc;
    const o = fc.getActiveObject();
    if (o?.isEditing) o.exitEditing();
    fc.off('mouse:down', this._down);
    fc.selection = true;
    fc.defaultCursor = 'default';
  }
}
