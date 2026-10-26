/* The suite's settings (VO.settings) and the look before the first paint (common/looks.css; suite.js, VO.look);
   loaded first in every page's <head>, a script file rather than inline (the pages' Content-Security-Policy).
   A setting is a string by key ('vibeoffice.look', 'quire.opts', …), as localStorage keeps it. On the web they are
   in localStorage; in the desktop app in ~/.vibeoffice/config.json, which the app serves at the top of this file
   (window.__VO_SETTINGS__, desktop/src/settings.rs) and keeps current in every window ('vo-settings'): its pages have
   no browser storage. */
(function () {
  'use strict';
  const VO = window.VO || (window.VO = {});
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  /* the desktop app's copy */
  const desk = window.__VO_HOST__ && window.__TAURI_INTERNALS__ ? Object.assign({}, window.__VO_SETTINGS__) : null;
  delete window.__VO_SETTINGS__;
  const listeners = new Set();
  let sending = Promise.resolve();
  const take = (key, value) => {
    if ((has(desk, key) ? desk[key] : null) === value) return;
    if (value == null) delete desk[key]; else desk[key] = value;
    for (const fn of listeners) fn(key, value);
  };
  VO.settings = {
    /** the string kept for key, else dflt */
    get(key, dflt = null) {
      if (desk) return has(desk, key) ? desk[key] : dflt;
      try { const v = localStorage.getItem(key); return v == null ? dflt : v; } catch (e) { return dflt; }
    },
    /** keeps value (a string; null removes the key) for every window of the suite; false if it can't be kept */
    set(key, value) {
      value = value == null ? null : String(value);
      if (!desk) {
        try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, value); return true; } catch (e) { return false; }
      }
      const before = has(desk, key) ? desk[key] : null;
      if (before === value) return true;
      if (value == null) delete desk[key]; else desk[key] = value;
      // one at a time, so the app takes them in the order they were made
      sending = sending.then(() => window.__TAURI_INTERNALS__.invoke('host_set_setting', { key, value })).catch((e) => {
        console.error('setting not kept:', key, e);
        if ((has(desk, key) ? desk[key] : null) === value) take(key, before);
      });
      return true;
    },
    remove: (key) => VO.settings.set(key, null),
    /** resolves once every change made here has reached the desktop app (before this page reloads) */
    kept: () => sending,
    /** fn(key, value) when another window changes a setting (value null: removed; key null: all may have); returns
     *  the function that stops it */
    on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  if (desk) window.addEventListener('vo-settings', (e) => take(e.detail.key, e.detail.value));
  else window.addEventListener('storage', (e) => { if (e.storageArea === localStorage) for (const fn of listeners) fn(e.key, e.newValue); });

  const d = document.documentElement, l = VO.settings.get('vibeoffice.look') || 'classic';
  d.dataset.look = l;
  d.dataset.layout = l === 'paper2016' ? 'ribbon' : 'bars';
})();
