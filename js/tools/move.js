// Move/select tool: default Fabric selection behavior for overlay objects.
import { h } from '../util.js';

export class MoveTool {
  constructor(doc) { this.doc = doc; }

  activate(ui) {
    const fc = this.doc.fc;
    fc.selection = true;
    fc.skipTargetFind = false;
    fc.defaultCursor = 'default';
    ui.setTitle('Move / Select');
    ui.body.replaceChildren(
      h('p', { class: 'hint' }, 'Click to select text, shapes and strokes. Drag to move, handles to scale/rotate. Del removes.'),
      h('button', {
        onclick: () => this.deleteSelection(),
      }, 'Delete selected'),
    );
  }

  deleteSelection() {
    const fc = this.doc.fc;
    const objs = fc.getActiveObjects().filter(o => !o.psBase && !o.psUI);
    if (!objs.length) return;
    fc.discardActiveObject();
    fc.remove(...objs);
    fc.requestRenderAll();
  }

  deactivate() {
    this.doc.fc.discardActiveObject();
    this.doc.fc.requestRenderAll();
  }
}
