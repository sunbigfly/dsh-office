import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../embed/bridge.js', import.meta.url), 'utf8');
async function fixture(app, readonly = false) {
  const sent = [], handlers = new Map(), options = new Map(), frames = [], parent = { postMessage(message) { sent.push(message); } };
  let transactions = 0;
  const L = { hist: { dirty: false }, app: {}, ed: {}, ops: { tx(_doc, _label, run) { transactions++; return run(); } }, ui: { cmds: { bold: {}, copy: {}, zoomIn: {}, save: {} }, exec() {}, refresh() {}, openMenu(items) { return items(); } }, editor: { active: false }, bus: { on() {} } };
  const VO = { settings: { set() {} }, host: {}, changed() {} };
  let document = { dirty: false }, snapshots = 0;
  const hooks = { current: () => document, isDirty: doc => app === 'lectern' ? L.hist.dirty : doc.dirty,
    async open() { document = { dirty: false }; },
    async snapshot() { snapshots++; return new Blob(['saved']); } };
  const window = { VO, L, innerHeight: 800, addEventListener(name, callback, config) { handlers.set(name, [...handlers.get(name) ?? [], callback]); options.set(name, config); } };
  function element() { return { children: [], dataset: {}, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, appendChild(e) { this.children.push(e); }, addEventListener(name, fn) { this[name] = fn; } }; }
  const menu = element();
  const dom = { documentElement: { dataset: {}, classList: { add() {} } }, querySelector: selector => selector === '#menurow' ? menu : null, querySelectorAll: () => [], head: element(), createElement: element, addEventListener() {}, body: {} };
  vm.runInNewContext(source, { window, parent, document: dom, URLSearchParams, location: { search: '?request=nonce&readonly=' + (readonly ? '1' : '0') }, ArrayBuffer, File, Blob, MutationObserver: class { observe() {} }, requestAnimationFrame: fn => frames.push(fn) });
  await VO.attach(app, hooks);
  const message = async (type, more = {}, origin = parent) => { for (const callback of handlers.get('message') ?? []) await callback({ source: origin, data: { channel: 'dsh-office-v1', request: 'nonce', type, ...more } }); };
  const [status, mode, save] = menu.children[0].children;
  return { L, VO, hooks, sent, message, menu, status, mode, save, handlers, options, frames, flushFrames() { while (frames.length) frames.shift()(); }, transactions: () => transactions, snapshots: () => snapshots, change() { document.dirty = true; L.hist.dirty = true; VO.changed(document); } };
}

for (const app of ['quire', 'ledger', 'lectern']) for (const readonly of [false, true]) {
  test(`${app}: Ctrl+wheel zooms locally in ${readonly ? 'preview' : 'editing'} without changing the document`, async () => {
    const f = await fixture(app, readonly), changes = [];
    let zoom = app === 'ledger' ? 100 : .75;
    if (app === 'quire') f.L.layout = { get zoom() { return zoom; }, setZoom(value) { zoom = value; changes.push(value); } };
    if (app === 'ledger') f.L.grid = { sheet: () => ({ view: { zoom } }), setZoom(value) { zoom = value; changes.push(value); } };
    if (app === 'lectern') { f.L.ed.zoomPct = () => zoom * 100; f.L.ed.setZoom = value => { zoom = value; changes.push(value); }; }
    const listener = f.handlers.get('wheel')[0];
    assert.equal(f.options.get('wheel').capture, true);
    assert.equal(f.options.get('wheel').passive, false);
    const wheel = (deltaY, ctrlKey = true, deltaMode = 0) => {
      const event = { deltaY, ctrlKey, deltaMode, canceled: false, stopped: false, preventDefault() { this.canceled = true; }, stopImmediatePropagation() { this.stopped = true; } };
      listener(event); return event;
    };
    const start = zoom;
    for (const event of [wheel(100, false), wheel(0)]) assert.equal(event.canceled, false);
    assert.equal(f.frames.length, 0);
    const first = wheel(-40), second = wheel(-60);
    assert.equal(first.canceled && first.stopped && second.canceled && second.stopped, true);
    assert.equal(f.frames.length, 1, 'combine high-frequency wheel events into one repaint');
    f.flushFrames(); assert.equal(changes.length, 1); assert.ok(zoom > start);
    assert.ok(Math.abs(zoom / start - Math.exp(.1)) < 1e-10);
    wheel(100); f.flushFrames(); assert.ok(Math.abs(zoom - start) < 1e-10);
    wheel(-1, true, 1); f.flushFrames(); assert.ok(Math.abs(zoom / start - Math.exp(.016)) < 1e-10);
    assert.equal(f.hooks.isDirty(f.hooks.current()), false);
    assert.equal(f.sent.some(message => message.type === 'changed'), false);
  });
}
for (const app of ['quire', 'ledger', 'lectern']) {
  test(`${app}: successful save acknowledges exactly the exported version`, async () => {
    const f = await fixture(app);
    f.change(); assert.equal(f.sent.at(-1).dirty, true);
    await f.message('export'); assert.equal(f.sent.at(-1).type, 'exported');
    await f.message('saved'); assert.equal(f.sent.at(-1).dirty, false);
    f.change(); await f.message('export'); f.change(); await f.message('saved');
    assert.equal(f.sent.at(-1).dirty, true, 'an edit during saving remains unsaved');
  });
}
test('preview refuses export even with the correct channel and nonce', async () => {
  const f = await fixture('quire', true);
  await f.message('export'); assert.equal(f.snapshots(), 0);
});
test('messages from another source or nonce cannot open or export a file', async () => {
  const f = await fixture('quire');
  const original = f.hooks.current();
  await f.message('open', { buffer: new ArrayBuffer(1), name: 'a.docx' }, {});
  await f.message('open', { request: 'wrong', buffer: new ArrayBuffer(1), name: 'a.docx' });
  await f.message('export', {}, {});
  assert.equal(f.hooks.current(), original); assert.equal(f.snapshots(), 0);
});
test('an invalid active spreadsheet cell blocks export and preserves the draft', async () => {
  const f = await fixture('ledger');
  f.change(); f.L.editor = { active: true, commit: () => false };
  await f.message('export'); assert.equal(f.snapshots(), 0); assert.equal(f.sent.at(-1).type, 'save-error'); assert.equal(f.hooks.isDirty(f.hooks.current()), true);
});

for (const app of ['quire', 'ledger', 'lectern']) test(`${app}: preview keeps menu controls and rejects edits and export`, async () => {
  const f = await fixture(app, true);
  assert.equal(f.menu.children.length, 1);
  assert.equal(f.L.ed.readOnly, true);
  assert.equal(f.L.ui.cmds.bold.enabled(), false);
  assert.equal(f.L.ops.tx({}, 'Edit text', () => 'changed'), undefined);
  assert.equal(f.transactions(), 0);
  await f.message('state', { state: { phase: 'ready', writable: true } });
  assert.equal(f.mode.textContent, '编辑'); assert.equal(f.mode.disabled, false);
  assert.equal(f.save.hidden, true);
  f.mode.click(); assert.equal(f.sent.at(-1).type, 'mode-request');
  await f.message('export'); assert.equal(f.snapshots(), 0);
  const items = f.L.ui.openMenu([{ label: 'Edit', action() {} }, { cmd: 'copy' }]);
  assert.equal(items[0].disabled, true); assert.equal(items[1].disabled, undefined);
});

test('menu actions follow trusted parent readiness, save progress and permission', async () => {
  const f = await fixture('quire');
  await f.message('state', { state: { phase: 'ready', writable: true } }, {});
  assert.equal(f.mode.hidden, true);
  await f.message('state', { state: { phase: 'ready', writable: true, editing: true } });
  assert.equal(f.mode.textContent, '返回预览'); assert.equal(f.save.hidden, false);
  f.save.click(); assert.equal(f.sent.at(-1).type, 'save-request');
  await f.message('state', { state: { phase: 'ready', writable: true, busy: true } });
  assert.equal(f.mode.disabled, true); assert.equal(f.save.disabled, true);
  const count = f.sent.length; f.mode.click(); f.save.click(); assert.equal(f.sent.length, count);
  await f.message('state', { state: { phase: 'ready', writable: false, error: 'Access revoked' } });
  assert.equal(f.mode.hidden, true); assert.equal(f.save.hidden, true);
  assert.equal(f.status.textContent, 'Access revoked'); assert.equal(f.status.attributes.role, 'alert');
});
