window.__ModuleLoader__.load({
  id: 'dsh-office',
  factory(require) {
    const React = require('react');
    const { FileTypeIcon, classifyFileType } = require('@deepseek-ai/dsh-client-ui-primitives');
    const h = React.createElement, ID = 'dsh-office', KIND = 'office', CHANNEL = 'dsh-office-v1', MAX = 32 * 1024 * 1024;
    const types = { docx: 'quire', xlsx: 'ledger', pptx: 'lectern' };
    function parseFileAddress(address) {
      try {
        const url = new URL(address), parts = url.pathname.slice(1).split('/').map(decodeURIComponent);
        if (url.protocol !== 'dsh-resource:' || url.hostname !== 'file' || parts[0] !== 'session' || !parts[1] || parts.length < 3) return null;
        return { scope: 'session', sessionId: parts[1], path: parts.slice(2).join('/') };
      } catch { return null; }
    }
    const typeOf = path => types[/\.([^.\/\\]+)$/.exec(path)?.[1]?.toLowerCase()] ?? null;
    const basename = path => path.split(/[\/\\]/).at(-1);
    const transport = globalThis.__DSH_TRANSPORT__;
    const origin = (() => { try { return new URL(transport?.streamBaseUrl ?? location.href).origin; } catch { return location.origin; } })();
    const send = (path, options) => typeof transport?.fetch === 'function' ? transport.fetch(path, options) : fetch(new URL(path, origin), options);
    const fromBase64 = value => Uint8Array.from(atob(value), char => char.charCodeAt(0));
    const toBase64 = data => { let value = ''; for (let i = 0; i < data.length; i += 32768) value += String.fromCharCode(...data.subarray(i, i + 32768)); return btoa(value); };
    function failure(message, code) { return Object.assign(new Error(message), { code }); }
    async function ownerApi(payload, signal) {
      const response = await send('/api/dsh-office', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
      const body = await response.json();
      if (!response.ok || !body.result) throw failure(body.error || '文件操作失败，请重试。', response.status);
      return body.result;
    }
    async function memberApi(payload, signal) {
      const flag = window.__DSH_LAN_MEMBER__;
      const response = await send('/lan/api/lan-workspace', { method: 'POST', headers: { 'content-type': 'application/json', 'x-lan-csrf': flag.csrf }, body: JSON.stringify(payload), signal });
      const body = await response.json();
      if (!response.ok || body.ok !== true) throw failure(body.error?.message || '文件操作失败，请重试。', body.error?.code);
      return body.result;
    }
    function assertGrant(snapshot) {
      const access = snapshot.preferences?.effective ?? snapshot.user?.access;
      if (!access?.files || access.plugins !== null && !access.plugins?.includes(ID)) throw failure('当前账号未获授权使用 Office 编辑器。', 'FORBIDDEN');
    }
    async function readSource(remote, file, signal) {
      if (!window.__DSH_LAN_MEMBER__) {
        let result;
        try { result = await ownerApi({ action: 'read', ...file }, signal); }
        catch (error) {
          if (error.code !== 403) throw error;
          const read = await remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal);
          if (!read.ok) throw failure(read.error?.message || '文件读取失败。', read.error?.code);
          const bytes = read.value.data instanceof Uint8Array ? read.value.data : new Uint8Array(read.value.data);
          if (bytes.byteLength > MAX) throw failure('文件超过 32 MB 编辑上限。');
          return { bytes, path: read.value.absolutePath, writable: false };
        }
        return { bytes: fromBase64(result.data), path: result.path, writable: true, save: async (bytes, nextSignal) => {
          const saved = await ownerApi({ action: 'write', ...file, revision: result.revision, data: toBase64(bytes) }, nextSignal);
          result.revision = saved.revision;
        } };
      }
      const snapshot = await memberApi({ action: 'snapshot', section: 'base' }, signal); assertGrant(snapshot);
      const observed = await remote.workspaceFiles.stat(file.sessionId, file.path, signal);
      if (!observed.ok) throw failure(observed.error?.message || '文件读取失败。', observed.error?.code);
      const result = observed.value;
      if (result.bytes > MAX) throw failure('文件超过 32 MB 编辑上限。');
      const targetUser = snapshot.user.role === 'admin' ? /(?:^|\/)usr_[a-f0-9]{32}(?=\/)/.exec(result.absolutePath)?.[0].replace(/^\//, '') ?? snapshot.user.id : snapshot.user.id;
      const action = targetUser === snapshot.user.id ? 'member.content' : 'admin.content';
      const request = { action, ...(action === 'admin.content' ? { userId: targetUser } : {}), sessionId: file.sessionId };
      let resolved;
      try { resolved = await memberApi({ ...request, operation: 'files.resolve', path: result.absolutePath }, signal); }
      catch (error) {
        if (!['ADMIN_FILE_DENIED', 'FORBIDDEN'].includes(error.code)) throw error;
        // An authorized shared directory can be previewed through native DSH;
        // this adapter never fabricates authority to write a different root.
        const preview = await remote.workspaceFiles.readBytes(file.sessionId, file.path, {}, signal);
        if (!preview.ok) throw failure(preview.error?.message || '文件读取失败。', preview.error?.code);
        const bytes = preview.value.data instanceof Uint8Array ? preview.value.data : new Uint8Array(preview.value.data);
        if (bytes.byteLength > MAX) throw failure('文件超过 32 MB 编辑上限。');
        return { bytes, path: result.absolutePath, writable: false };
      }
      // Use the existing revision-bound download so the loaded bytes and save
      // revision describe the same file, even during an external update.
      if (resolved.item.size > MAX) throw failure('文件超过 32 MB 编辑上限。');
      const chunks = []; let offset = 0;
      while (offset < resolved.item.size || offset === 0) {
        const part = await memberApi({ ...request, operation: 'files.download', path: resolved.item.path, offset, revision: resolved.item.revision }, signal);
        if (part.size > MAX || part.nextOffset < offset || part.nextOffset === offset && offset < part.size) throw failure('文件内容无效或超过编辑上限。');
        chunks.push(fromBase64(part.data)); offset = part.nextOffset;
        if (offset >= part.size) break;
      }
      const loaded = new Uint8Array(offset); let at = 0; for (const part of chunks) { loaded.set(part, at); at += part.length; }
      return { bytes: loaded, path: result.absolutePath, writable: true, save: async (data, saveSignal) => {
        const latest = await memberApi({ action: 'snapshot', section: 'base' }, saveSignal); assertGrant(latest);
        let job;
        try {
          job = await memberApi({ ...request, operation: 'upload.begin', path: resolved.item.path, revision: resolved.item.revision, size: data.length }, saveSignal);
          for (let start = 0; start < data.length; start += job.chunkBytes) await memberApi({ ...request, operation: 'upload.chunk', uploadId: job.uploadId, offset: start, data: toBase64(data.subarray(start, start + job.chunkBytes)) }, saveSignal);
          await memberApi({ ...request, operation: 'upload.finish', uploadId: job.uploadId }, saveSignal);
          job = null;
          resolved = await memberApi({ ...request, operation: 'files.resolve', path: result.absolutePath }, saveSignal);
        } finally {
          if (job) await memberApi({ ...request, operation: 'upload.abort', uploadId: job.uploadId }, AbortSignal.timeout(5000)).catch(() => {});
        }
      } };
    }
    const css = `
.dsho{display:flex;flex-direction:column;height:100%;min-height:0;min-width:0;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base,#fff);font:inherit}
.dsho-status button{font:inherit;padding:5px 12px;border:1px solid var(--dsw-alias-border-l1,#ddd);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#fafafa);color:inherit;cursor:pointer}.dsho button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary,#5378fa);outline-offset:2px}
.dsho-stage{position:relative;flex:1;min-height:0;min-width:0;overflow:hidden}.dsho-frame{width:calc(100% / .9);height:calc(100% / .9);transform:scale(.9);transform-origin:top left;border:0;display:block;background:#fff}.dsho-status{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;text-align:center;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-base,#fff)}
.dsho-message{flex:none;padding:8px 12px;font-size:12px;color:var(--dsw-alias-label-secondary);border-bottom:1px solid var(--dsw-alias-border-l1,#eee)}.dsho-message[role=alert]{color:var(--dsw-alias-state-error-primary,#b33)}.dsho-dirty{margin-left:5px}.dsho-parking{position:fixed;left:-100000px;top:0;width:1200px;height:800px;visibility:hidden;pointer-events:none}
`;
    function apply(ctx) {
      ctx.effect(() => {
        const entries = new Map(), cleanup = [], style = document.createElement('style'), parking = document.createElement('div');
        let live = true;
        style.textContent = css; document.head.appendChild(style); parking.className = 'dsho-parking'; parking.inert = true; document.body.appendChild(parking);
        function publish(entry, patch) { if (entry.closed || !live) return; entry.state = { ...entry.state, ...patch }; post(entry, 'state', { state: entry.state }); for (const listener of entry.listeners) listener(); }
        function post(entry, type, extra = {}, transfer = []) { entry.frame?.contentWindow?.postMessage({ channel: CHANNEL, request: entry.nonce, type, ...extra }, '*', transfer); }
        function discard(entry) { return !entry.state.dirty || window.confirm('放弃此文档尚未保存的修改？'); }
        function destroy(entry) { entry.closed = true; entry.control.abort(); entry.frame?.remove(); entry.source = null; entries.delete(entry.id); }
        function buildFrame(entry) {
          clearTimeout(entry.timer); entry.frame?.remove();
          entry.nonce = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''); entry.openSent = false;
          const frame = document.createElement('iframe'); frame.className = 'dsho-frame'; frame.title = `Office · ${entry.name}`;
          frame.setAttribute('sandbox', 'allow-scripts allow-downloads'); frame.referrerPolicy = 'no-referrer';
          frame.src = `${origin}/dsh-office/vendor/${typeOf(entry.path)}/index.html?new&request=${entry.nonce}&readonly=${entry.state.editing ? '0' : '1'}`;
          entry.frame = frame; (entry.mount ?? parking).appendChild(frame);
          entry.resize?.();
          publish(entry, { phase: 'opening', error: '', dirty: false });
          entry.timer = setTimeout(() => publish(entry, { phase: 'error', error: '编辑器加载超时，请重试。' }), 30000);
        }
        async function load(entry) {
          publish(entry, { phase: 'loading', error: '', message: '' });
          try {
            entry.source = await readSource(ctx.remote, { sessionId: entry.sessionId, path: entry.path }, entry.signal);
            if (entry.closed) return;
            publish(entry, { writable: entry.source.writable }); buildFrame(entry);
          } catch (error) { if (!entry.signal.aborted) publish(entry, { phase: 'error', error: error.message }); }
        }
        function acquire(tab) {
          let entry = entries.get(tab.id); if (entry) return entry;
          const file = parseFileAddress(tab.contentId), control = new AbortController();
          entry = { id: tab.id, sessionId: file.sessionId, path: file.path, name: basename(file.path), control, signal: AbortSignal.any([control.signal, tab.signal]), listeners: new Set(), state: { phase: 'loading', editing: false, dirty: false, busy: false, writable: false, error: '', message: '' }, closed: false };
          entries.set(entry.id, entry); tab.signal.addEventListener('abort', () => { clearTimeout(entry.timer); destroy(entry); }, { once: true });
          if (typeOf(entry.path)) void load(entry); return entry;
        }
        function save(entry) { if (entry.state.busy || !entry.state.editing || !entry.source?.writable || entry.state.phase !== 'ready') return; publish(entry, { busy: true, error: '', message: '' }); post(entry, 'export'); }
        function mode(entry) { if (entry.state.busy || entry.state.phase !== 'ready' || !entry.source?.writable || !discard(entry)) return; publish(entry, { editing: !entry.state.editing, message: '' }); buildFrame(entry); }
        async function receive(event) {
          const message = event.data;
          if (event.origin !== 'null' || message?.channel !== CHANNEL) return;
          const entry = [...entries.values()].find(value => value.frame?.contentWindow === event.source && value.nonce === message.request);
          if (!entry || entry.closed) return;
          if (message.type === 'ready') { post(entry, 'state', { state: entry.state }); if (!entry.openSent) { entry.openSent = true; const buffer = entry.source.bytes.slice().buffer; post(entry, 'open', { buffer, name: entry.name }, [buffer]); } }
          if (message.type === 'loaded') { clearTimeout(entry.timer); publish(entry, { phase: 'ready', error: '' }); }
          if (message.type === 'changed') publish(entry, { dirty: message.dirty === true });
          if (message.type === 'error' || message.type === 'save-error') { clearTimeout(entry.timer); publish(entry, { error: message.message || '编辑器操作失败。', busy: false, ...(message.type === 'error' ? { phase: 'error' } : {}) }); }
          if (message.type === 'save-request') save(entry);
          if (message.type === 'mode-request') mode(entry);
          if (message.type === 'exported' && entry.state.busy && entry.state.editing && message.buffer instanceof ArrayBuffer) {
            try {
              if (message.buffer.byteLength > MAX) throw failure('保存文件超过 32 MB 上限。');
              const bytes = new Uint8Array(message.buffer);
              await entry.source.save(bytes, entry.signal);
              entry.source.bytes = bytes; post(entry, 'saved'); publish(entry, { busy: false, message: '已保存到工作区。' });
            } catch (error) { if (!entry.signal.aborted) publish(entry, { busy: false, error: error.message }); }
          }
        }
        window.addEventListener('message', receive);
        const leave = event => { if ([...entries.values()].some(entry => entry.state.dirty || entry.state.busy)) { event.preventDefault(); event.returnValue = ''; } };
        window.addEventListener('beforeunload', leave);
        function OfficeBody({ useTabInfo }) {
          const { tab } = useTabInfo(), entry = React.useMemo(() => acquire(tab), [tab.id]);
          const state = React.useSyncExternalStore(listener => { entry.listeners.add(listener); return () => entry.listeners.delete(listener); }, () => entry.state);
          const mount = React.useRef(null);
          React.useEffect(() => {
            if (!typeOf(entry.path)) { tab.actions.openResource(tab.contentId, { replaceTab: true }); return; }
            entry.mount = mount.current; if (entry.frame) mount.current.appendChild(entry.frame);
            const resize = () => {
              const host = mount.current;
              if (!entry.frame || !host?.clientWidth || !host.clientHeight) return;
              entry.frame.style.width = `${host.clientWidth / .9}px`;
              entry.frame.style.height = `${host.clientHeight / .9}px`;
            };
            entry.resize = resize;
            const observer = new ResizeObserver(resize); observer.observe(mount.current); resize();
            const dispose = tab.actions.bindCommands({ refresh: () => { if (!entry.state.busy && discard(entry)) { publish(entry, { dirty: false }); void load(entry); } } });
            return () => { dispose?.(); observer.disconnect(); if (entry.resize === resize) entry.resize = null; entry.mount = null; if (!entry.closed && entry.frame) parking.appendChild(entry.frame); };
          }, [entry, tab.actions]);
          return h('div', { className: 'dsho', 'data-office-document': entry.name },
            h('div', { className: 'dsho-stage' }, h('div', { ref: mount, style: { width: '100%', height: '100%' } }), state.phase !== 'ready' && h('div', { className: 'dsho-status', role: state.phase === 'error' ? 'alert' : 'status' }, state.phase === 'error' ? state.error : '正在打开文档…', state.phase === 'error' && h('button', { type: 'button', onClick: () => void load(entry) }, '重试'))));
        }
        function OfficeTitle({ useTabInfo }) { const { tab } = useTabInfo(); return h(React.Fragment, null, h(FileTypeIcon, { kind: classifyFileType(tab.title), size: 16 }), tab.title); }
        let activated = false;
        function activate() {
          if (!live || activated) return; activated = true;
          cleanup.push(ctx.sidebarRightTabs.register({ id: ID, kind: KIND, patterns: ['*.docx', '*.xlsx', '*.pptx'], priority: 'extension', canOpen: address => { const file = parseFileAddress(address); return file?.scope === 'session' && !!typeOf(file.path); }, title: address => basename(parseFileAddress(address)?.path ?? '') }));
          cleanup.push(ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: ID }, OfficeBody)));
          cleanup.push(ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: ID }, OfficeTitle)));
          cleanup.push(ctx.sidebarRight.registerCloseHandler(KIND, (_sessionId, tab) => {
            const entry = entries.get(tab.id); if (!entry) return;
            if (entry.state.busy) throw failure('文件正在保存，请稍后关闭。');
            if (!discard(entry)) throw failure('已保留未保存的文档。');
            clearTimeout(entry.timer); destroy(entry);
          }));
        }
        if (!window.__DSH_LAN_MEMBER__) activate();
        else void memberApi({ action: 'snapshot', section: 'base' }).then(snapshot => { assertGrant(snapshot); activate(); }).catch(() => {});
        return () => { live = false; for (const dispose of cleanup.reverse()) dispose?.(); for (const entry of entries.values()) { clearTimeout(entry.timer); destroy(entry); } window.removeEventListener('message', receive); window.removeEventListener('beforeunload', leave); parking.remove(); style.remove(); };
      });
    }
    return { name: 'office', inject: ['slots', 'sidebarRightTabs', 'sidebarRight', 'remote', 'remote.workspaceFiles'], apply };
  },
});
