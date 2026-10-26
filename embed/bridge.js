/* DSH adapter for VibeOffice. Apache-2.0. No access to parent state or APIs. */
(function () {
  'use strict';
  const query = new URLSearchParams(location.search), request = query.get('request');
  if (!request || parent === window) return;
  const readonly = query.get('readonly') !== '0', channel = 'dsh-office-v1';
  let hooks, app, opening = false, exporting = false, generation = 0, exported = null;
  let controls, modeButton, saveButton, stateLabel, state = { phase: 'opening', writable: false, editing: !readonly };
  let fitMenus = () => {};
  const send = (type, extra = {}, transfer = []) => parent.postMessage({ channel, request, type, ...extra }, '*', transfer);
  const VO = window.VO;
  // The stock suite keeps local recents/recovery and registers a service worker.
  // Embedded documents live only in this tab and are saved by the DSH parent.
  VO.recent = new Proxy({}, { get: (_target, key) => key === 'forApp' ? () => [] : async () => [] });
  VO.opened = () => {}; VO.saved = () => {}; VO.elsewhere = async () => false;
  VO.showLicenses = () => {}; VO.host.newWindow = async () => false;
  VO.settings.set('vibeoffice.look', 'paper');
  const look = VO.look;
  if (look) {
    VO.look = { ...look, list: () => look.list().filter(item => item.id === 'paper'), get: () => 'paper', layout: () => 'bars', set: () => look.set('paper') };
    VO.look.set('paper');
  }
  document.documentElement.dataset.look = 'paper'; document.documentElement.dataset.layout = 'bars';
  function updateControls() {
    if (!controls) return;
    const busy = state.busy || state.phase !== 'ready';
    modeButton.hidden = !state.writable;
    modeButton.disabled = busy;
    modeButton.textContent = readonly ? '编辑' : '返回预览';
    saveButton.hidden = readonly || !state.writable;
    saveButton.disabled = busy;
    saveButton.textContent = state.busy ? '正在保存…' : '保存到工作区';
    stateLabel.textContent = state.error || state.message || (readonly ? state.writable ? '预览' : '只读预览' : state.dirty ? '未保存' : '编辑');
    stateLabel.title = stateLabel.textContent;
    stateLabel.setAttribute('role', state.error ? 'alert' : 'status');
    fitMenus();
  }
  function installControls() {
    const header = document.querySelector('#menurow');
    if (!header || controls) return;
    controls = document.createElement('div'); controls.className = 'dsh-office-controls';
    controls.setAttribute('role', 'group'); controls.setAttribute('aria-label', 'DSH 文档操作');
    stateLabel = document.createElement('span'); stateLabel.className = 'dsh-office-state'; stateLabel.setAttribute('aria-live', 'polite');
    modeButton = document.createElement('button'); modeButton.type = 'button'; modeButton.dataset.officeAction = 'mode';
    modeButton.addEventListener('click', () => { if (!modeButton.disabled && state.writable) send('mode-request'); });
    saveButton = document.createElement('button'); saveButton.type = 'button'; saveButton.className = 'dsh-office-save'; saveButton.dataset.officeAction = 'save';
    saveButton.addEventListener('click', () => { if (!saveButton.disabled && !readonly && state.writable) send('save-request'); });
    controls.appendChild(stateLabel); controls.appendChild(modeButton); controls.appendChild(saveButton); header.appendChild(controls);
    updateControls();
    fitMenus = window.DSHOfficeMenus?.install(header, controls, window.L) || fitMenus;
  }
  function current() { return hooks?.current(); }
  function changed() { if (opening) return; generation++; send('changed', { dirty: !!hooks?.isDirty(current()) }); }
  const recordChange = VO.changed;
  VO.changed = doc => { recordChange(doc); if (doc === current()) changed(); };
  function lock() {
    if (!readonly) return;
    document.documentElement.classList.add('dsh-office-readonly');
    if (window.L.ed) window.L.ed.readOnly = true;
    for (const node of document.querySelectorAll('[contenteditable=true]')) node.setAttribute('contenteditable', 'false');
    for (const node of document.querySelectorAll('input,textarea')) {
      if (node.closest('.dsh-office-controls,.menu,.dlg,dialog,[role=dialog],.namebox')) continue;
      node.readOnly = true;
      if (node.closest('.cmdbars') && node.id !== 'fbinput') node.disabled = true;
    }
  }
  const canNavigate = id => /^(?:copy$|selectAll$|showAssistant$|help$|keyboardHelp$|gettingStarted$|zoom|view|nextSlide|prevSlide|showFrom|printPreview|closePreview|find|goTo)/.test(id);
  function fit() {
    if (!hooks || opening) return;
    if (app === 'quire' && window.L.layout?.zoomFor) window.L.layout.setZoom(Math.min(1, window.L.layout.zoomFor('pageWidth')));
    if (app === 'lectern') window.L.ed?.setZoom('fit');
  }
  window.addEventListener('resize', fit);
  let wheelDelta = 0, wheelZoomScheduled = false;
  function zoomByWheel() {
    const factor = Math.exp(-Math.max(-240, Math.min(240, wheelDelta)) / 1000);
    wheelDelta = 0; wheelZoomScheduled = false;
    if (!hooks || opening) return;
    const L = window.L;
    if (app === 'quire') L.layout.setZoom(L.layout.zoom * factor);
    else if (app === 'ledger') L.grid.setZoom((L.grid.sheet().view.zoom || 100) * factor);
    else if (app === 'lectern') L.ed.setZoom(L.ed.zoomPct() / 100 * factor);
  }
  // Capture inside this iframe before native editor handlers, including preview.
  // A non-passive listener keeps Ctrl+wheel from zooming the surrounding DSH UI.
  window.addEventListener('wheel', event => {
    if (!hooks || !event.ctrlKey || !Number.isFinite(event.deltaY) || event.deltaY === 0) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? window.innerHeight || 800 : 1;
    wheelDelta += event.deltaY * unit;
    if (!wheelZoomScheduled) { wheelZoomScheduled = true; requestAnimationFrame(zoomByWheel); }
  }, { capture: true, passive: false });
  VO.attach = async (id, provided) => {
    hooks = provided; app = id;
    const L = window.L;
    installControls();
    const exec = L.ui.exec;
    L.ui.exec = (id, ...args) => {
      if (/^(save|saveAs)$/.test(id)) { if (!readonly) send('save-request'); return; }
      if (/^(new|open|close|exit)/.test(id)) return;
      return !readonly || canNavigate(id) ? exec(id, ...args) : undefined;
    };
    if (readonly) {
      // Keep RDF's read-only command and transaction boundary while retaining
      // the complete menu/toolbars in all three preview editors.
      for (const [id, command] of Object.entries(L.ui.cmds || {})) if (!canNavigate(id)) command.enabled = () => false;
      const menuItems = items => (typeof items === 'function' ? items() : items || []).map(item => {
        if (!item || typeof item === 'string') return item;
        if (item.sub) return { ...item, sub: () => menuItems(item.sub) };
        return item.cmd && canNavigate(item.cmd) ? item : { ...item, disabled: true };
      });
      const openMenu = L.ui.openMenu;
      L.ui.openMenu = (items, ...args) => openMenu(() => menuItems(items), ...args);
      if (L.ops?.tx) {
        const transaction = L.ops.tx;
        L.ops.tx = (doc, label, run) => opening || app === 'ledger' && /^(Column Width|Row Height)$/.test(label) ? transaction(doc, label, run) : undefined;
      }
      document.addEventListener('beforeinput', event => { if (event.target.closest('.dlg,dialog,[role=dialog],.namebox')) return; event.preventDefault(); event.stopImmediatePropagation(); }, true);
      for (const event of ['paste', 'cut', 'drop']) document.addEventListener(event, e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
      document.addEventListener('keydown', event => {
        if (event.target.closest('.dsh-office-controls,.menu,.dlg,dialog,[role=dialog],.namebox')) return;
        const copy = (event.ctrlKey || event.metaKey) && /^[cafg]$/i.test(event.key);
        const nav = /^(Arrow|Page|Home|End|Escape|Tab|F3)/.test(event.key) && !event.altKey && !event.ctrlKey && !event.metaKey;
        if (!copy && !nav) { event.preventDefault(); event.stopImmediatePropagation(); }
      }, true);
      new MutationObserver(lock).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['contenteditable'] });
      lock();
    }
    send('ready', { app });
  };
  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); event.stopImmediatePropagation(); if (!readonly) send('save-request'); }
  }, true);
  window.addEventListener('message', async event => {
    const message = event.data;
    // An opaque iframe accepts only its exact parent plus a per-instance nonce.
    if (event.source !== parent || !message || message.channel !== channel || message.request !== request) return;
    if (message.type === 'state' && message.state && typeof message.state === 'object') { state = message.state; updateControls(); return; }
    if (message.type === 'ping' && hooks) { send('ready', { app }); return; }
    if (message.type === 'open' && hooks && !opening) {
      if (!(message.buffer instanceof ArrayBuffer) || message.buffer.byteLength > 32 * 1024 * 1024 || typeof message.name !== 'string') return;
      opening = true;
      try {
        const before = current();
        await hooks.open(new File([message.buffer], message.name), {});
        if (before === current()) throw new Error('Not opened');
        generation = 0; lock(); send('loaded'); requestAnimationFrame(fit);
      } catch { send('error', { message: '无法打开文档，请检查格式或密码。' }); }
      finally { opening = false; }
    }
    if (message.type === 'export' && hooks && !readonly && !opening && !exporting) {
      exporting = true;
      try {
        // Commit an active spreadsheet cell before serializing.
        if (app === 'ledger' && window.L.editor?.active && !window.L.editor.commit()) throw new Error('Cell validation failed');
        const doc = current(), version = generation, blob = await hooks.snapshot(doc);
        const buffer = await blob.arrayBuffer();
        if (buffer.byteLength > 32 * 1024 * 1024) throw new Error('Too large');
        exported = { doc, version };
        send('exported', { buffer }, [buffer]);
      } catch { send('save-error', { message: '无法生成保存文件，草稿已保留。' }); }
      finally { exporting = false; }
    }
    if (message.type === 'saved' && exported) {
      const same = exported.doc === current() && exported.version === generation;
      if (same) { if (app === 'lectern') window.L.hist.dirty = false; else exported.doc.dirty = false; window.L.app?.updateTitle?.(); window.L.ui.refresh(); }
      exported = null; send('changed', { dirty: !same || !!hooks.isDirty(current()) });
    }
  });
})();
