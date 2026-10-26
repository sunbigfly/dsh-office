/* Ledger — spelling (Tools ▸ Spelling, F7) and AutoCorrect for cell entries.
 * The words come from the shared engine (common/spell.js); this file adds the dialog and AutoCorrect.
 */
(function (root) {
  'use strict';
  const L = root.L;
  const M = L.model, O = L.ops, F = L.formula;
  const { h } = L;
  const ui = L.ui;
  const SP = L.spell;   // the engine: common/spell.js
  const opt = (k, def) => { const o = L.app && L.app.opts; return o && o[k] !== undefined ? o[k] !== false : def !== false; };

  const LEX = L.lex;

  /* ================= AutoCorrect ================= */
  const AC = (L.autocorrect = {});
  const EXCEPTIONS = ['a.', 'abbr.', 'abs.', 'acad.', 'acct.', 'adj.', 'adv.', 'al.', 'apr.', 'approx.', 'assn.', 'aug.', 'ave.', 'b.a.', 'c.', 'ca.', 'cf.', 'co.', 'corp.', 'dec.', 'dept.', 'dr.', 'e.g.', 'ed.', 'esp.', 'est.', 'etc.', 'ex.', 'feb.', 'fig.', 'figs.', 'fri.', 'gen.', 'i.e.', 'inc.', 'jan.', 'jr.', 'jul.', 'jun.', 'ltd.', 'mar.', 'max.', 'min.', 'misc.', 'mon.', 'mr.', 'mrs.', 'ms.', 'mt.', 'no.', 'nov.', 'oct.', 'p.', 'pp.', 'prof.', 'ref.', 'rev.', 'sat.', 'sep.', 'sept.', 'sr.', 'st.', 'sun.', 'tel.', 'thu.', 'tue.', 'u.s.', 'vol.', 'vs.', 'wed.'];
  AC.list = function () {
    const base = L.spell.autocorrectDefaults();
    base.delete('i'); base.delete(':)'); base.delete(':-)'); base.delete(':('); base.delete(':-('); base.delete('==>'); base.delete('<=='); base.delete('<=>');
    const user = L.store.get('acList', null);
    if (user) { for (const k of user.del || []) base.delete(k); for (const [k, v] of user.add || []) base.set(k, v); }
    return base;
  };
  let LIST = null;
  AC.reload = () => { LIST = AC.list(); };
  AC.setEntry = function (from, to) { const u = L.store.get('acList', { add: [], del: [] }); u.add = (u.add || []).filter((x) => x[0] !== from); u.del = (u.del || []).filter((x) => x !== from); if (to != null) u.add.push([from, to]); else u.del.push(from); L.store.set('acList', u); AC.reload(); };
  AC.exceptions = () => L.store.get('acExceptions', EXCEPTIONS);
  const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  /**
   * AutoCorrect a typed text entry (not formulas): replacement list, TWo INitial CApitals,
   * capitalised day names and first letters of sentences, accidental cAPS LOCK.
   */
  AC.applyCell = function (text) {
    if (!text || /^[=+\-@']/.test(text) || !opt('acReplace', true) && !opt('acTwoCaps', true)) return text;
    if (!LIST) AC.reload();
    let out = text;
    if (opt('acReplace', true)) {
      out = out.replace(/(^|[\s(])([^\s()]+?)(?=$|[\s,.;:!?)])/g, (m, pre, w) => {
        if (LIST.has(w)) return pre + LIST.get(w);
        const lw = w.toLowerCase();
        if (LIST.has(lw) && /^[a-z]/.test(LIST.get(lw))) { const r = LIST.get(lw); return pre + (w[0] === w[0].toUpperCase() && w[0] !== w[0].toLowerCase() ? r[0].toUpperCase() + r.slice(1) : r); }
        return m;
      });
      for (const k of ['(c)', '(r)', '(tm)', '...', '-->', '<--', '==>', '<==', '<=>']) if (out.indexOf(k) >= 0 && LIST.has(k)) out = out.split(k).join(LIST.get(k));
    }
    if (opt('acTwoCaps', true)) out = out.replace(/\b([A-Z])([A-Z])([a-z]{2,})\b/g, (m, a, b, rest) => a + b.toLowerCase() + rest);
    if (opt('acDays', true)) out = out.replace(/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/g, (m) => m[0].toUpperCase() + m.slice(1));
    if (opt('acCapsLock', true)) out = out.replace(/\b([a-z])([A-Z]{2,})\b/g, (m, a, rest) => a.toUpperCase() + rest.toLowerCase());
    if (opt('acSentence', false)) out = out.replace(/(^|[.!?]\s+)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
    void DAYS;
    return out;
  };

  /* ================= Spelling dialog (cells and comments) ================= */
  const WORD = /[\p{L}][\p{L}\p{M}'’\-]*[\p{L}\p{M}]|[\p{L}]/gu;
  /** misspellings in a text: [{word, index}] */
  function findErrors(text, list) {
    const out = [];
    WORD.lastIndex = 0;
    let m;
    while ((m = WORD.exec(text))) {
      const w = m[0];
      if (/^(https?|www|mailto)/i.test(w) || /\.\w+\//.test(text.slice(m.index - 1, m.index + w.length + 2))) continue;
      if (opt('ignoreInternet', true) && /[@\/\\]/.test(text.slice(Math.max(0, m.index - 1), m.index + w.length + 1))) continue;
      if (!SP.okWord(w, list)) out.push({ word: w, index: m.index });
    }
    return out;
  }
  SP.findErrors = findErrors;
  SP.check = async function () {
    const G = L.grid, A = L.app;
    const sh = G.sheet(), wb = G.wb;
    let list = (A.opts && A.opts.dictLang) === 'en_GB' ? 'en_GB' : 'en_US';
    ui.busy(true, 'Loading the dictionary...');
    try { await LEX.load(list); } catch (e) { ui.busy(false); ui.msg(L.t('The spelling dictionary could not be loaded ({0}).', e.message || e), { icon: 'warn' }); return; }
    ui.busy(false);
    /* cells to check: the selection when it is more than one cell, otherwise the sheet from the active cell, wrapping */
    const rg0 = G.range();
    const single = G.ranges().length === 1 && rg0.r1 === rg0.r2 && rg0.c1 === rg0.c2;
    const s0 = G.sel();
    const cells = [];
    sh.rows.forEach((row, r) => { if (!row) return; row.cells.forEach((cell, c) => { if (!cell || typeof cell.v !== 'string' || cell.f != null || cell.am) return; if (!single && !G.ranges().some((x) => M.rangeContains(x, r, c))) return; cells.push({ r, c }); }); });
    if (single) { const k = cells.findIndex((x) => x.r > s0.r || (x.r === s0.r && x.c >= s0.c)); if (k > 0) cells.push(...cells.splice(0, k)); }
    let ci = 0, hits = [], hi = 0, changes = 0;
    const changeAll = new Map();
    const next = () => {
      for (;;) {
        if (hi < hits.length) return true;
        if (ci >= cells.length) return false;
        const it = cells[ci++];
        const v = sh.val(it.r, it.c);
        if (typeof v !== 'string') continue;
        hits = findErrors(v, list).map((x) => Object.assign(x, it));
        hi = 0;
        /* Change All replacements apply silently */
        hits = hits.filter((x) => { if (changeAll.has(x.word)) { replaceIn(x, changeAll.get(x.word)); return false; } return true; });
      }
    };
    const replaceIn = (x, to) => {
      const v = sh.val(x.r, x.c);
      if (typeof v !== 'string') return;
      const re = new RegExp('(^|[^\\p{L}])' + x.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=$|[^\\p{L}])', 'u');
      const nv = v.replace(re, (m, pre) => pre + to);
      if (nv !== v) { O.tx(wb, L.N('Spelling'), () => O.setValue(sh, x.r, x.c, nv)); changes++; }
    };
    if (!next()) { ui.msg(changes ? 'The spelling check is complete for the entire sheet.' : 'The spelling check is complete for the entire sheet.', { icon: 'info' }); return; }
    const word = h('input', { type: 'text', style: 'width:100%' });
    const ctx = h('div', { class: 'sp-ctx', translate: 'no' });
    const sugg = h('select', { size: '6', style: 'width:100%' });
    const btn = (label, fn) => ui.button(label, fn, { style: 'width:100%' });
    let cur = null;
    const show = () => {
      cur = hits[hi];
      G.select(cur.r, cur.c);
      word.value = cur.word;
      const v = sh.val(cur.r, cur.c);
      ctx.textContent = '';
      ctx.append(document.createTextNode(v.slice(Math.max(0, cur.index - 40), cur.index)), h('b', { style: 'color:#c00', translate: 'no', text: cur.word }), document.createTextNode(v.slice(cur.index + cur.word.length, cur.index + cur.word.length + 40)));
      sugg.textContent = '';
      const s = SP.suggest(cur.word, list, 8);
      for (const x of s.length ? s : [L.t('(No Suggestions)')]) sugg.appendChild(h('option', { value: x, translate: 'no', text: x }));
      sugg.selectedIndex = 0;
      sugg.disabled = !s.length;
    };
    const advance = () => { hi++; if (!next()) { d.close(null); ui.msg('The spelling check is complete for the entire sheet.', { icon: 'info' }); G.paint(); return; } show(); };
    const pick = () => (word.value !== cur.word ? word.value : sugg.disabled ? null : sugg.value);
    const LANGS = [['en_US', 'English (U.S.)'], ['en_GB', 'English (U.K.)']];
    const langName = (k) => (LANGS.find((x) => x[0] === k) || LANGS[0])[1];
    const langSel = ui.select(LANGS, list, async (v) => {
      /* switch dictionaries: load the list, remember the choice, re-check the current cell */
      ui.busy(true, 'Loading the dictionary...');
      try { await LEX.load(v); } catch (e) { ui.busy(false); ui.msg(L.t('The spelling dictionary could not be loaded ({0}).', e.message || e), { icon: 'warn' }); langSel.value = list; return; }
      ui.busy(false);
      list = v;
      if (A.opts) { A.opts.dictLang = v; if (A.saveOpts) A.saveOpts(); }
      d.el.querySelector('.dlg-ttl').textContent = L.t('Spelling: {0}', L.t(langName(v)));
      hits = findErrors(sh.val(cur.r, cur.c), list).map((x) => Object.assign(x, { r: cur.r, c: cur.c }));
      hi = 0;
      if (!hits.length) { hi = 1; advance(); } else show();
    });
    const d = ui.dialog({
      title: L.t('Spelling: {0}', L.t(langName(list))), width: 520,
      body: h('div', { class: 'sp-grid' },
        h('div', { class: 'col' }, h('label', { text: 'Not in Dictionary:' }), ctx, word, h('label', { text: 'Suggestions:' }), sugg, ui.field('Dictionary &language:', langSel)),
        h('div', { class: 'col sp-btns' },
          btn('&Ignore Once', advance), btn('I&gnore All', () => { SP.ignoreAll(cur.word); hits = hits.filter((x, k) => k <= hi || x.word.toLowerCase() !== cur.word.toLowerCase()); advance(); }),
          btn('&Add to Dictionary', () => { SP.addWord(cur.word); advance(); }),
          btn('&Change', () => { const v = pick(); if (v != null) { replaceIn(cur, v); hits = findErrors(sh.val(cur.r, cur.c), list).map((x) => Object.assign(x, { r: cur.r, c: cur.c })).filter((x) => x.index > cur.index + v.length - cur.word.length - 1); hi = -1; } advance(); }),
          btn('Change A&ll', () => { const v = pick(); if (v != null) { changeAll.set(cur.word, v); replaceIn(cur, v); } advance(); }),
          btn('Auto&Correct', () => { const v = pick(); if (v == null) return; L.autocorrect.setEntry(cur.word, v); replaceIn(cur, v); advance(); }))),
      buttons: [{ label: '&Options...', onClick: () => { L.dlg.options('Spelling'); return false; } }, { label: 'Cancel' }],
    });
    sugg.addEventListener('dblclick', () => { const v = pick(); if (v != null) { replaceIn(cur, v); } advance(); });
    show();
  };
})(typeof window !== 'undefined' ? window : globalThis);
