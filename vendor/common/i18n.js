/* The UI's language (docs/i18n.md): one choice for the whole suite, the setting 'vibeoffice.lang' (auto, en, ja,
 * ko, fr, de, zh-CN, zh-Hant; qps, the pseudo-locale, for developers), with ?lang= overriding it for one page. common/lang.js
 * resolves it before the first paint into <html lang> (auto: the first of the browser's languages we have, else
 * English), which this reads. The dictionary, public/common/i18n/<lang>.json, maps the English text to its
 * translation; it is fetched once, and VO.i18n.whenReady(fn) runs fn once it is here (at once for English).
 * VO.t(s, ...args) / L.t: the translation of s, else s itself, with {0}, {1}… filled from args. "Line|chart" is the
 * English "Line" in a context of its own, where a language needs another word than for "Line" elsewhere (a chart
 * type, not a drawn line): it shows as "Line", and takes the plain "Line"'s translation until it has its own. */
(function () {
  'use strict';
  const VO = window.VO || (window.VO = {});
  const doc = typeof document !== 'undefined' ? document : null;
  const tag = (doc && doc.documentElement.getAttribute('lang')) || 'en';
  const lang = VO.lang.normalize(tag) || 'en';

  /* qps: each string of the English catalog (i18n/en.json, tools/i18n.mjs) mechanically changed, as a complete
     translation would change it: it stands out (accented, in brackets) and is about 40% longer, as French and German
     are; {0} placeholders and the letter after & stay as they are. English left on screen isn't in the catalog. */
  const ACC = { a: 'á', c: 'ç', e: 'é', i: 'í', n: 'ñ', o: 'ó', u: 'ú', y: 'ý', A: 'Á', C: 'Ç', E: 'É', I: 'Í', N: 'Ñ', O: 'Ó', U: 'Ú', Y: 'Ý' };
  const pseudo = (s) => {
    const body = s.replace(/(\{\d+\}|&.)|[aceinouyACEINOUY]/g, (m, keep) => keep || ACC[m]);
    const letters = s.replace(/\{\d+\}|[^A-Za-z]/g, '').length;
    return '[' + body + (letters > 2 ? ' ' + '·'.repeat(Math.ceil(letters * 0.4)) : '') + ']';
  };
  const marks = (s) => (s.match(/\{\d+\}/g) || []).sort().join();
  /** the text without its context: "Line|chart" is "Line". A context is words (letters, spaces, hyphens) right after
      the "|" that ends the text; other text with a "|" is shown whole, as text that is the user's can reach VO.t again
      (a file name A|B.docx filled into a message, "Revenue | Expenses") */
  const plain = (s) => s.replace(/(\S)\|[A-Za-z][A-Za-z -]*$/, '$1');

  let dict = null;
  /* in the pseudo-locale, the text asked for that the catalog lacks (tools/i18n.mjs harvest reads it) */
  const missed = new Set();
  const t = (s, ...args) => {
    if (typeof s !== 'string' || !s) return s;
    const has = (k) => dict && Object.prototype.hasOwnProperty.call(dict, k) && typeof dict[k] === 'string' && dict[k];
    const base = plain(s);
    let out = base;
    if (lang === 'qps') { if (!dict || Object.prototype.hasOwnProperty.call(dict, s)) out = pseudo(base); else if (/[A-Za-z]{2}/.test(s) && s[0] !== '[') missed.add(s); }
    else out = [s, base].map((k) => has(k) && marks(dict[k]) === marks(base) && dict[k]).find(Boolean) || base;
    return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[i] != null ? String(args[i]) : m)) : out;
  };

  /* the dictionary beside this file (for qps, the catalog) */
  const here = doc && doc.currentScript && doc.currentScript.src;
  let loaded = lang === 'en' || !here || typeof fetch !== 'function';
  const ready = loaded ? Promise.resolve() : fetch(new URL('i18n/' + (lang === 'qps' ? 'en' : lang) + '.json', here))
    .then((r) => (r.ok ? r.json() : null))
    .then((d) => { if (d && typeof d === 'object') dict = d; })
    .catch(() => {})
    .then(() => { loaded = true; });

  VO.i18n = {
    /** the language of this page's UI (common/lang.js) */
    lang,
    /** the locales argument of toLocaleDateString and the like for dates the UI shows: the UI's language, or with
        English the browser's own (an English UI in Britain writes 14 Oct) */
    dates: lang === 'en' || lang === 'qps' ? [] : lang,
    ready,
    /** run fn once the dictionary is here: now if it is (English), else when it arrives */
    whenReady: (fn) => (loaded ? fn() : ready.then(fn)),
    missed,
    t,
    plain,
  };
  VO.t = t;
  /** UI text kept in a table and translated where it is shown (VO.t then): marks it for the catalog, returns it as is */
  VO.N = (s) => s;

  /* the page's own HTML (the Start Center's text, Ledger's formula bar): its text and the attributes the UI shows,
     translated once, before the app builds the rest of its UI with VO.t (tools/i18n.mjs gathers the same text) */
  const ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];
  const translateTree = (top) => {
    if (lang === 'en' || !top) return;
    /* not inside translate="no" (data: a version, a language's own name) */
    const walker = doc.createTreeWalker(top, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, { acceptNode: (n) => (n.nodeType === 1 && n.getAttribute('translate') === 'no' ? 2 : 1) });   // FILTER_REJECT skips the subtree
    for (let n = walker.currentNode; n; n = walker.nextNode()) {
      if (n.nodeType === 1) {
        for (const a of ATTRS) { const v = n.getAttribute(a); if (v) { const x = t(v); if (x !== v) n.setAttribute(a, x); } }
        continue;
      }
      const p = n.parentNode && n.parentNode.nodeName;
      if (p === 'SCRIPT' || p === 'STYLE') continue;
      const s = n.data.replace(/\s+/g, ' ').trim();
      if (!s || !/[A-Za-z]/.test(s)) continue;
      const x = t(s);
      if (x !== s) n.data = n.data.match(/^\s*/)[0] + x + n.data.match(/\s*$/)[0];
    }
  };
  VO.i18n.translateTree = translateTree;
  if (doc) {
    const run = () => VO.i18n.whenReady(() => translateTree(doc.documentElement));
    if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', run); else run();
  }
  if (window.L) { window.L.t = t; window.L.N = VO.N; }
})();
