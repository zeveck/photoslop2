// App conductor: document, tool switching, file open, keyboard, status bar.
import { $, $$, fileToCanvas, setStatus } from './util.js';
import { EditorDocument } from './document.js';
import { MoveTool } from './tools/move.js';
import { CropTool } from './tools/crop.js';
import { TransformTool } from './tools/transform.js';
import { BrushTool } from './tools/brush.js';
import { ShapeTool } from './tools/shapes.js';
import { TextTool } from './tools/text.js';
import { initResizeDialog } from './resize.js';
import { initExportDialog } from './export.js';
import { initKeysDialog } from './ai/keys.js';
import { HealTool } from './tools/heal.js';
import { ExpandTool } from './tools/expand.js';
import { BgRemoveTool } from './tools/bgremove.js';
import { GenerateTool } from './tools/generate.js';

const doc = new EditorDocument($('#c'), $('#canvas-area'));
window.psDoc = doc; // debugging & tests

let baseName = 'image';
const ui = {
  setTitle: (t) => { $('#tool-options-title').textContent = t; },
  body: $('#tool-options-body'),
};

// ---------- tools ----------

export const tools = {
  move: new MoveTool(doc),
  crop: new CropTool(doc, { onDone: () => setTool('move') }),
  transform: new TransformTool(doc),
  brush: new BrushTool(doc),
  shape: new ShapeTool(doc),
  text: new TextTool(doc),
  heal: new HealTool(doc),
  expand: new ExpandTool(doc),
  bgremove: new BgRemoveTool(doc),
  generate: new GenerateTool(doc),
};

let current = null, currentName = null;

export function setTool(name) {
  if (!doc.hasImage && name !== 'move') return;
  if (currentName === name) return;
  current?.deactivate();
  currentName = name;
  current = tools[name];
  $$('#toolbar .tool').forEach(b => b.classList.toggle('active', b.dataset.tool === name));
  current.activate(ui);
}

export function registerTool(name, tool) { tools[name] = tool; }

$$('#toolbar .tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));

// ---------- file open ----------

async function openBlob(blob, name) {
  const canvas = await fileToCanvas(blob);
  baseName = (name || 'image').replace(/\.[a-z0-9]+$/i, '');
  await doc.open(canvas);
  $('#drop-hint').classList.add('hidden');
  currentName = null;
  setTool('move');
  updateBars();
}

const fileInput = $('#file-input');
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) openBlob(fileInput.files[0], fileInput.files[0].name);
  fileInput.value = '';
});
$('#btn-open').addEventListener('click', () => fileInput.click());
$('#btn-open2').addEventListener('click', () => fileInput.click());

const area = $('#canvas-area');
area.addEventListener('dragover', (e) => { e.preventDefault(); area.classList.add('dragover'); });
area.addEventListener('dragleave', () => area.classList.remove('dragover'));
area.addEventListener('drop', (e) => {
  e.preventDefault();
  area.classList.remove('dragover');
  const f = [...e.dataTransfer.files].find(f => f.type.startsWith('image/'));
  if (f) openBlob(f, f.name);
});
document.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find(i => i.type.startsWith('image/'));
  if (item) openBlob(item.getAsFile(), 'pasted');
});

// ---------- dialogs ----------

const openResize = initResizeDialog(doc);
const openExport = initExportDialog(doc, () => `${baseName}-edited`);
const openKeys = initKeysDialog();
$('#btn-resize').addEventListener('click', openResize);
$('#btn-save').addEventListener('click', openExport);
$('#btn-keys').addEventListener('click', openKeys);

// ---------- undo/redo ----------

$('#btn-undo').addEventListener('click', () => doc.undo());
$('#btn-redo').addEventListener('click', () => doc.redo());
doc.addEventListener('history', () => {
  $('#btn-undo').disabled = !doc.canUndo;
  $('#btn-redo').disabled = !doc.canRedo;
});

// ---------- zoom & pan ----------

doc.fc.on('mouse:wheel', (opt) => {
  const e = opt.e;
  e.preventDefault();
  e.stopPropagation();
  const factor = Math.pow(0.999, e.deltaY);
  doc.setZoom(doc.zoom * factor, new fabric.Point(e.offsetX, e.offsetY));
});

let spaceDown = false, panning = false, panLast = null, savedInteraction = null;

function beginPanMode() {
  if (savedInteraction) return;
  const fc = doc.fc;
  savedInteraction = {
    selection: fc.selection, skipTargetFind: fc.skipTargetFind,
    cursor: fc.defaultCursor, drawing: fc.isDrawingMode,
  };
  fc.selection = false;
  fc.skipTargetFind = true;
  fc.isDrawingMode = false;
  fc.defaultCursor = 'grab';
  fc.setCursor('grab');
}
function endPanMode() {
  if (!savedInteraction) return;
  const fc = doc.fc;
  fc.selection = savedInteraction.selection;
  fc.skipTargetFind = savedInteraction.skipTargetFind;
  fc.defaultCursor = savedInteraction.cursor;
  fc.isDrawingMode = savedInteraction.drawing;
  savedInteraction = null;
}

doc.fc.on('mouse:down', (opt) => {
  if (spaceDown || opt.e.button === 1) {
    if (opt.e.button === 1) beginPanMode();
    panning = true;
    panLast = { x: opt.e.clientX, y: opt.e.clientY };
    opt.e.preventDefault();
  }
});
doc.fc.on('mouse:move', (opt) => {
  if (panning && panLast) {
    doc.panBy(opt.e.clientX - panLast.x, opt.e.clientY - panLast.y);
    panLast = { x: opt.e.clientX, y: opt.e.clientY };
  }
  if (doc.hasImage) {
    const p = doc.scenePoint(opt.e);
    $('#status-pos').textContent = `${Math.round(p.x)}, ${Math.round(p.y)}`;
  }
});
doc.fc.on('mouse:up', (opt) => {
  if (panning) {
    panning = false;
    if (!spaceDown) endPanMode();
  }
});

// ---------- keyboard ----------

const TOOL_KEYS = { v: 'move', c: 'crop', r: 'transform', b: 'brush', u: 'shape', t: 'text', j: 'heal', x: 'expand', k: 'bgremove', g: 'generate' };

function typingTarget(e) {
  const t = e.target;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return true;
  const o = doc.fc.getActiveObject();
  return !!(o && o.isEditing);
}

document.addEventListener('keydown', (e) => {
  if (typingTarget(e)) return;
  if (e.key === ' ' && !spaceDown) { spaceDown = true; beginPanMode(); e.preventDefault(); return; }
  if (current?.onKey?.(e)) { e.preventDefault(); return; }

  const mod = e.ctrlKey || e.metaKey;
  if (mod) {
    const k = e.key.toLowerCase();
    if (k === 'z') { e.shiftKey ? doc.redo() : doc.undo(); e.preventDefault(); }
    else if (k === 'y') { doc.redo(); e.preventDefault(); }
    else if (k === 'o') { fileInput.click(); e.preventDefault(); }
    else if (k === 's') { openExport(); e.preventDefault(); }
    else if (k === '0') { doc.fitToWindow(); e.preventDefault(); }
    else if (k === '=' || k === '+') { doc.setZoom(doc.zoom * 1.25); e.preventDefault(); }
    else if (k === '-') { doc.setZoom(doc.zoom / 1.25); e.preventDefault(); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    tools.move.deleteSelection();
    e.preventDefault();
    return;
  }
  const tool = TOOL_KEYS[e.key.toLowerCase()];
  if (tool) setTool(tool);
});

document.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    if (!panning) endPanMode();
  }
});

// ---------- status bar ----------

function updateBars() {
  $('#status-dims').textContent = doc.hasImage ? `${doc.width} × ${doc.height} px` : '';
  $('#status-zoom').textContent = doc.hasImage ? `${Math.round(doc.zoom * 100)}%` : '';
}
doc.addEventListener('change', updateBars);
doc.addEventListener('zoom', updateBars);

window.addEventListener('beforeunload', (e) => {
  if (doc.hasImage) { e.preventDefault(); e.returnValue = ''; }
});

setStatus('Ready');
setTool('move');
