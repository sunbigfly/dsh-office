/* DSH embedding: no shared browser document cache, recovery, or cross-tab bus. */
(function () {
  'use strict';
  // randomUUID is restricted to secure contexts; LAN HTTP still provides
  // getRandomValues. Keep vendor document/object identifiers cryptographically
  // random without changing the iframe's opaque sandbox origin.
  if (typeof crypto.randomUUID !== 'function') Object.defineProperty(crypto, 'randomUUID', { value() {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128;
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  } });
  window.BroadcastChannel = class { postMessage() {} addEventListener() {} removeEventListener() {} close() {} };
  const today = new Date(), hiddenDay = `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`;
  const settings = new Map([['vibeoffice.look', 'paper'], ['vibeoffice.lang', 'zh-CN'], ['vibeoffice.assistant', '{"on":false}'], ['scout.lastHiddenDay', hiddenDay]]);
  Object.defineProperty(window, 'localStorage', { value: { getItem: key => settings.get(key) ?? null, setItem: (key, value) => settings.set(key, key === 'vibeoffice.look' ? 'paper' : String(value)), removeItem: key => { if (key !== 'vibeoffice.look') settings.delete(key); } } });
  Object.defineProperty(navigator, 'serviceWorker', { value: { register: async () => ({}), getRegistrations: async () => [], addEventListener() {}, startMessages() {} } });
  window.open = () => null;
  window.addEventListener('error', event => {
    parent.postMessage({ channel: 'dsh-office-v1', request: new URLSearchParams(location.search).get('request'), type: 'error', message: '编辑器加载失败，请重试。' }, '*');
  });
})();
