/* Lectern — SmartArt diagrams. A diagram is a group with an `sa` record:
 *   sa = { layout, colors, style, items: [{ id, text, kids }] }     (common/smartart.js lays the items out)
 * Its kids are the laid-out shapes, regenerated from the items on every change, each marked
 * kid.sa = { item, role } so a click, an on-slide text edit or Delete finds its item. Because it stays a group,
 * moving, copying, undo, drafts and drawing work as for any group; resizing lays it out again
 * (editor.js) and SmartArt Tools replace Drawing Tools while it is selected (app.js A.inContext).
 * Items are plain text; colours and styles name theme slots, so a new design recolours the diagram.
 */
(function () {
  'use strict';
  const L = window.L, ui = L.ui, { h } = L;
  const SA = L.smartart, M = L.model, T = L.txt;
  const E = () => L.ed;
  const DG = (L.diagram = {});

  /* ---------------------------------------------------------------- colours and styles */
  const ACC = ['accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  /* colours (the colours definition's id). From the theme: each item its own accent (Colorful), a range from one
     accent to another item by item ('accent2-accent3', Colorful Range), and from older files every item in one
     accent ('accent1'), a range of its shades ('accent1-range') or the dark text colour ('dark2'). Our own palettes
     ('ocean') are fixed colours, the same in every design: a range from one colour to another, or a colour per item */
  /** the colours id as [base, kind]: 'accent3-range' → ['accent3', 'range'], 'accent2-accent3' → ['accent2', 'accent3'] (an older file's 'range' is accent 1's) */
  DG.colorsOf = (id) => { const [b, k] = (id === 'range' ? 'accent1-range' : id || 'accent1').split('-'); return [b, k || 'fill']; };
  /* id: [name, colours, 'span' (item by item from the first to the last) or 'cycle', text colour (white), colour of
     arrows, lines and cards (the first)] */
  DG.PALETTES = {
    ocean: [L.N('Ocean'), ['#0891B2', '#4F46E5'], 'span'], aurora: [L.N('Aurora'), ['#059669', '#2563EB'], 'span'], lagoon: [L.N('Lagoon'), ['#0F766E', '#0284C7'], 'span'],
    midnight: [L.N('Midnight'), ['#1E3A8A', '#7C3AED'], 'span'], berry: [L.N('Berry'), ['#7C3AED', '#DB2777'], 'span'], sunset: [L.N('Sunset'), ['#EA580C', '#DB2777'], 'span'],
    fire: [L.N('Fire'), ['#B91C1C', '#EA580C'], 'span'], amber: [L.N('Amber'), ['#B45309', '#CA8A04'], 'span'], forest: [L.N('Forest'), ['#166534', '#65A30D'], 'span'],
    slate: [L.N('Slate'), ['#1E293B', '#64748B'], 'span'],
    vivid: [L.N('Vivid'), ['#E03131', '#E8590C', '#2F9E44', '#1971C2', '#7048E8'], 'cycle'], jewel: [L.N('Jewel'), ['#0E7490', '#7E22CE', '#BE123C', '#15803D', '#1D4ED8'], 'cycle'],
    pastel: [L.N('Pastel'), ['#FBCFE8', '#BFDBFE', '#BBF7D0', '#FDE68A', '#DDD6FE'], 'cycle', '#1F2937', '#64748B'],
  };
  const N = (a) => a.slice(6);
  const colorsText = (id, t) => {
    const [ref, kind] = DG.colorsOf(id);
    if (DG.PALETTES[ref]) return t(DG.PALETTES[ref][0]);
    return ref === 'colorful' ? t('Colorful - Accent Colors') : ref === 'dark2' ? t('Dark 2 Fill') : ACC.includes(kind) ? t('Colorful Range - Accent Colors {0} to {1}', N(ref), N(kind)) : kind === 'range' ? t('Gradient Range - Accent {0}', N(ref)) : t('Colored Fill - Accent {0}', N(ref));
  };
  /** the colours' name as written into the file (smartart-io.js), and as shown in the UI's language */
  DG.colorsName = (id) => colorsText(id, (s, ...a) => s.replace(/\{(\d+)\}/g, (m, i) => a[i]));
  DG.colorsLabel = (id) => colorsText(id, L.t);
  /** the colour choices: two from the design's theme, then our palettes */
  DG.colorChoices = (d) => ['colorful', DG.themeRange(d)].concat(Object.keys(DG.PALETTES)).map((k) => [k, DG.colorsLabel(k)]);
  /** what a new diagram is coloured with */
  DG.DEFAULT_COLORS = 'ocean';
  /** the items' colours of a colours id: { cols: [[colour, colour changes]…] (a theme slot or '#hex'), meth ('span',
      'cycle' or 'repeat'), base (arrows, lines, cards), texts (text colours, as cols) }. smartart-io.js writes
      the same in the colours definition */
  DG.colorSpec = (id, pal) => {
    const [ref, kind] = DG.colorsOf(id), P = DG.PALETTES[ref];
    if (P) return { cols: P[1].map((v) => [v, []]), meth: P[2], base: P[4] || P[1][0], texts: P[2] === 'cycle' ? P[1].map(() => [P[3] || '#FFFFFF', []]) : [[P[3] || '#FFFFFF', []]] };
    if (ref === 'colorful') return { cols: pal.colorful.map((v) => [v, []]), meth: 'cycle', base: pal.slot('accent1'), texts: pal.colorful.map((v) => [pal.text(v), []]) };
    const base = pal.slot(ref === 'dark2' ? 'dk2' : ACC.includes(ref) ? ref : 'accent1'), texts = [[pal.text(base), []]];
    if (kind === 'range') return { cols: DG.rangeMods(pal, base).map((m) => [base, m]), meth: 'span', base, texts };
    if (kind !== 'fill') return { cols: [[base, []], [pal.slot(kind), []]], meth: 'span', base, texts };
    return { cols: [[base, []]], meth: 'repeat', base, texts };
  };
  /** a colour of a spec as '#hex' */
  DG.hexOf = (pal, [v, mods]) => L.color.applyMods(v[0] === '#' ? v : pal.hex(v), (mods || []).map(([name, val]) => ({ name, val })));
  /* styles: [line, fill, effect] of the theme's style matrix (L.model.FMT; 0 none): a white edge, a flat, soft or
     rich gradient fill, a drop shadow. PowerPoint draws them from the theme the same way. Three design languages:
     filled shapes; outlined (the slide's background inside a coloured edge, coloured text); tinted (a pale wash
     of the colour, coloured text). The last two have colours of their own (smartart-io.js colorsXML) */
  DG.STYLES = [['simple', L.N('Simple Fill'), [2, 1, 0]], ['flat', L.N('Flat'), [0, 1, 0]], ['white', L.N('White Outline'), [3, 1, 0]], ['subtle', L.N('Subtle Effect'), [2, 1, 1]],
    ['soft', L.N('Soft Gradient'), [0, 2, 0]], ['moderate', L.N('Moderate Effect'), [0, 2, 2]], ['intense', L.N('Intense Effect'), [0, 3, 3]], ['lifted', L.N('Lifted'), [2, 2, 3]], ['gloss', L.N('Gloss'), [1, 3, 2]],
    ['outline', L.N('Outline|style'), [2, 1, 0], 'outline'], ['card', L.N('Outline Card'), [1, 1, 2], 'outline'], ['tint', L.N('Tinted'), [0, 1, 0], 'tint'], ['tintLine', L.N('Tinted Outline'), [2, 1, 0], 'tint']];
  DG.STYLE_GROUPS = [['fill', L.N('Filled')], ['outline', L.N('Outlined')], ['tint', L.N('Tinted')]];
  const styleOf = (id) => DG.STYLES.find((s) => s[0] === id) || DG.STYLES[0];
  DG.styleRefs = (id) => styleOf(id)[2];
  /** the style's design language: 'fill', 'outline' or 'tint' */
  DG.styleLang = (id) => styleOf(id)[3] || 'fill';
  /** what a new diagram looks like: a range of the design's liveliest accent, soft gradients and shadows */
  DG.DEFAULT_STYLE = 'moderate';
  const COLORFUL = ['accent2', 'accent3', 'accent4', 'accent5', 'accent6'];
  /** the two ends of a gradient range of slot, as colour changes: deep to a little lighter under light text, the
      colour to light under dark text (so the text reads on every item) */
  DG.rangeMods = (pal, slot) => (pal.lum(pal.text(slot)) > pal.lum(slot) ? [[['shade', 68000]], [['tint', 90000], ['satMod', 120000]]] : [[], [['tint', 60000]]]);

  /** a tinted shape's wash of a colour, as colour changes: pale on a light slide, deep on a dark one (a mix, not
      transparency, which applications drop from a range of colours) */
  DG.washMods = (pal) => (pal.lum('lt1') > 0.5 ? [['tint', 28000]] : [['shade', 38000]]);
  /** colour changes that make a colour (hex) readable as text on the slide: deeper on a light slide, lighter on
      a dark one, when it is too close to the background */
  DG.inkMods = (pal, hex) => {
    const bg = pal.lum('lt1'), d = L.color.luma(hex) - bg;
    if (Math.abs(d) >= 0.45) return [];
    return bg > 0.5 ? [['lumMod', 55000]] : [['lumMod', 45000], ['lumOff', 55000]];
  };
  /** the theme's usable colours: accents too close to the background are skipped (pale fill colours such as the
      Default Design's accent 1, a white accent), and text is dark on light fills. Instead of a skipped accent the
      diagram takes the mid-toned accent that best carries white text. The saved colours part follows the same
      choice (smartart-io.js) */
  DG.palette = (d) => {
    const hex = (slot) => M.resolveColor(slot, d), lum = (slot) => L.color.luma(hex(slot));
    const bg = lum('lt1'), ok = (slot) => Math.abs(lum(slot) - bg) > 0.3;
    const first = ACC.filter(ok).sort((x, y) => Math.abs(lum(x) - 0.42) - Math.abs(lum(y) - 0.42) || ACC.indexOf(x) - ACC.indexOf(y))[0] || 'accent1';
    const colorful = COLORFUL.filter(ok);
    return { slot: (slot) => (ok(slot) ? slot : first), colorful: colorful.length ? colorful : [first], /* the theme's text colour that stands out more from the fill (dk1 is not always the dark one), light preferred */
      text: (slot) => (Math.abs(lum(slot) - lum('dk1')) > Math.abs(lum(slot) - lum('lt1')) + 0.15 ? 'dk1' : 'lt1'), ok, lum, hex };
  };
  /** the theme's range: the design's most vivid accent that stands out from the slide and carries white text well
      (a grey or pale accent 1 makes a dull diagram), running item by item into a neighbouring hue of the design
      (navy into teal); without one, shades of that accent */
  DG.themeRange = (d) => {
    d = d || design();
    const pal = DG.palette(d);
    const hsl = (slot) => L.color.rgbToHsl(...L.color.hexToRgb(pal.hex(slot)));
    const score = (slot) => hsl(slot)[1] - 1.2 * Math.abs(pal.lum(slot) - 0.42);
    const ok = ACC.filter(pal.ok), rank = ok.slice().sort((x, y) => score(y) - score(x) || ok.indexOf(x) - ok.indexOf(y));
    const best = rank[0] || 'accent1';
    const apart = (x) => { const t = Math.abs(hsl(x)[0] - hsl(best)[0]); return Math.min(t, 1 - t) * 360; };
    const mate = rank.filter((x) => x !== best && hsl(x)[1] > 0.3 && pal.text(x) === pal.text(best) && apart(x) >= 12 && apart(x) <= 150 && Math.abs(pal.lum(x) - pal.lum(best)) < 0.3)
      .sort((x, y) => score(y) - Math.abs(apart(y) - 70) / 200 - (score(x) - Math.abs(apart(x) - 70) / 200))[0];
    return mate ? best + '-' + mate : best + '-range';
  };
  /** fill, line, shadow and text colour of one laid-out shape */
  function paint(s, sa, pal) {
    const spec = DG.colorSpec(sa.colors, pal), base = spec.base, n = spec.cols.length, i = s.colorIdx || 0;
    /* an item's colour: its own in a cycle, its step in a range (from first to last colour, item by item) */
    const step = () => { const t = (s.colorCnt > 1 ? i / (s.colorCnt - 1) : 0) * (n - 1), k = Math.min(n - 2, Math.floor(t)); return L.color.mix(DG.hexOf(pal, spec.cols[k]), DG.hexOf(pal, spec.cols[k + 1]), t - k); };
    let c = spec.meth === 'cycle' && s.role !== 'conn' ? DG.hexOf(pal, spec.cols[i % n]) : base;
    const a = s.alpha == null ? 1 : s.alpha;
    /* sub-item cards: a pale tint of the item's colour, with an outline when the layout asks for one */
    if (s.role === 'child' && s.tint && !s.noFill) return { fill: { t: 'solid', c, a: 0.18 }, line: s.line ? { c, w: 1, dash: 'solid' } : { t: 'none' }, shadow: null, text: 'tx1' };
    if (s.role === 'child' || s.noFill) return { fill: { t: 'none' }, line: { t: 'none' }, shadow: null, text: 'tx1' };
    if (s.role === 'conn') return { fill: { t: 'none' }, line: { c, w: 1.5, dash: 'solid' }, shadow: null };
    if (s.role === 'ring') return { fill: { t: 'none' }, line: { c, a: 0.4, w: 8, dash: 'solid' }, shadow: null };
    if (s.role === 'bg') return { fill: { t: 'solid', c, a: 0.25 }, line: { t: 'none' }, shadow: null };
    if (s.role === 'arrow') return { fill: { t: 'solid', c, a: a * (s.big ? 0.3 : 0.6) }, line: { t: 'none' }, shadow: null };
    if (spec.meth === 'span') c = step();
    const text = DG.hexOf(pal, spec.texts[spec.meth === 'cycle' ? i % spec.texts.length : 0]);
    const [ln, fl, fx] = DG.styleRefs(sa.style), lang = DG.styleLang(sa.style);
    const venn = s.styleLbl === 'vennNode1', e = !venn && M.FMT.effects[fx - 1];
    const shadow = e ? { c: '#000000', a: e.a, dx: 0, dy: e.dist, blur: e.blur } : null;
    /* outlined and tinted: the item's colour on its edge and its text (a range of shades writes in its deep end) */
    const inkOf = (x) => { const hx = DG.hexOf(pal, [x]), m = DG.inkMods(pal, hx); return m.length ? L.color.applyMods(hx, m.map(([name, val]) => ({ name, val }))) : x; };
    const ink = venn ? 'tx1' : inkOf(DG.colorsOf(sa.colors)[1] === 'range' ? base : c);
    if (lang === 'outline') return { fill: { t: 'solid', c: 'lt1', a }, line: { c, w: M.FMT.lines[(ln || 2) - 1], dash: 'solid' }, shadow, text: ink };
    if (lang === 'tint') return { fill: { t: 'solid', c: L.color.applyMods(DG.hexOf(pal, [c]), DG.washMods(pal).map(([name, val]) => ({ name, val }))), a: venn ? 0.7 : a }, line: ln ? { c, w: M.FMT.lines[ln - 1], dash: 'solid' } : { t: 'none' }, shadow, text: ink };
    return { fill: fl > 1 ? M.fmtFill(fl, DG.hexOf(pal, [c]), a) : { t: 'solid', c, a },
      line: ln ? { c: 'lt1', w: M.FMT.lines[ln - 1], dash: 'solid' } : { t: 'none' },
      shadow,
      text: venn ? 'tx1' : text };
  }

  /* ---------------------------------------------------------------- items → shapes */
  const design = () => M.design(L.pres, E().slide());
  /* 15% to spare, for applications that draw the text in a wider font or with wider margins (LibreOffice) */
  const measurer = DG.measurer = (d) => { const m = SA.measureWith(L.fontStack(L.style.font('+mn', d))); return (t, sz) => m(t, sz) * 1.15; };
  DG.isDiagram = (sh) => !!(sh && sh.type === 'group' && sh.sa);
  /** the diagram a shape is, or is part of */
  DG.of = (sh) => { if (!sh) return null; if (DG.isDiagram(sh)) return sh; const top = E().topOf(sh.id); return DG.isDiagram(top) ? top : null; };
  DG.current = () => DG.of(E().primary());

  /* formatting the user gave one shape (fill, outline, font colour, bold, italic) is kept on its item, as
     item.fmt[role], so it survives laying the diagram out again; Reset Graphic clears it */
  const FMT_ROLES = ['node', 'child'];
  const fmtOf = (sa, id, role) => { const r = id && FMT_ROLES.includes(role) && locate(sa.items, id); return (r && r.item.fmt && r.item.fmt[role]) || null; };
  function kidOf(s, sa, keep, pal) {
    const p = Object.assign({}, paint(s, sa, pal)), f = fmtOf(sa, s.itemId, s.role) || {};
    if (f.fill) p.fill = L.clone(f.fill);
    if (f.line) p.line = L.clone(f.line);
    if (f.color) p.text = f.color;
    const key = `${s.itemId}:${s.role}:${keep.n[s.itemId + s.role] = (keep.n[s.itemId + s.role] || 0) + 1}`;
    const base = { id: keep.ids[key] || L.uid('s'), type: 'shape', name: (SA.get(sa.layout) || {}).name + ' ' + s.role, x: s.x, y: s.y, w: Math.max(s.w, 0.01), h: Math.max(s.h, 0.01), rot: s.rot || 0, fill: p.fill, line: p.line, shadow: p.shadow, sa: { item: s.itemId, role: s.role } };
    if (s.flipV) base.flipV = true;
    if (FMT_ROLES.includes(s.role)) base.sa.gen = { fill: JSON.stringify(base.fill), line: JSON.stringify(base.line), color: p.text, b: !!f.b, i: !!f.i };
    if (s.geom === 'path') {
      const cmds = s.path.map(([x, y], i) => [i ? 'L' : 'M', x - s.x, y - s.y]);
      return Object.assign(base, { geom: 'custom', path: { paths: [{ w: base.w, h: base.h, cmds, fill: 'none', stroke: true }] } });
    }
    if (s.geom === 'poly') {
      const cmds = s.poly.map(([x, y], i) => [i ? 'L' : 'M', x - s.x, y - s.y]).concat([['Z']]);
      Object.assign(base, { geom: 'custom', path: { paths: [{ w: base.w, h: base.h, cmds, fill: 'norm', stroke: true }] } });
    } else Object.assign(base, { geom: s.geom });
    const defAdj = (L.geom.get(s.geom) || {}).adj;
    if (defAdj) {
      base.adj = L.clone(defAdj);
      const names = Object.keys(defAdj);
      (s.adj || []).forEach((v, i) => { if (names[i]) base.adj[names[i]] = v; });
    }
    if (s.text) {
      const sz = s.fontSize, b = s.text.box, inset = sz * 0.25;
      const rp = Object.assign({ sz, color: p.text }, f.b ? { b: true } : {}, f.i ? { i: true } : {});
      const ps = s.text.lines.map((ln) => (ln.lvl
        ? T.para(ln.t, { algn: 'l', marL: sz * 0.9, indent: -sz * 0.9, bu: { t: 'char', ch: '•' } }, rp, 1)
        : T.para(ln.t, { algn: s.text.align === 'l' ? 'l' : 'ctr', bu: { t: 'none' } }, rp)));
      base.tx = T.body(ps, { anchor: s.text.anchor === 't' || s.text.anchor === 'b' ? s.text.anchor : 'ctr', wrap: true, autofit: 'none', ins: [inset, inset, inset, inset] });
      base.txRect = [b.x - s.x, b.y - s.y, b.x + b.w - s.x, b.y + b.h - s.y].map((v) => L.round(v, 3));
    }
    return base;
  }
  /** lay the diagram out again in its box; shapes keep their ids where their item and role are the same */
  /** what the user changed on the shapes since they were laid out, recorded on their items */
  DG.capture = (g) => {
    for (const k of g.kids || []) {
      const gen = k.sa && k.sa.gen, r = gen && locate(g.sa.items, k.sa.item);
      if (!r) continue;
      const f = {};
      /* colours and gradients only: a picture fill needs a part of its own, which the SmartArt data does not have here */
      if (JSON.stringify(k.fill) !== gen.fill && k.fill && ['solid', 'grad', 'none', 'patt'].includes(k.fill.t)) f.fill = L.clone(k.fill);
      if (JSON.stringify(k.line) !== gen.line) f.line = L.clone(k.line);
      const run = k.tx && k.tx.ps[0] && (k.tx.ps[0].rs[0] || k.tx.ps[0].end);
      if (run) {
        if (run.color && run.color !== gen.color) f.color = run.color;
        if (!!run.b !== gen.b) f.b = !!run.b;
        if (!!run.i !== gen.i) f.i = !!run.i;
      }
      if (!Object.keys(f).length) continue;
      const fmt = (r.item.fmt = r.item.fmt || {});
      fmt[k.sa.role] = Object.assign(fmt[k.sa.role] || {}, f);
      for (const key of Object.keys(fmt[k.sa.role])) if (fmt[k.sa.role][key] === false) delete fmt[k.sa.role][key];
    }
  };
  DG.relayout = (g, d) => {
    d = d || design();
    DG.capture(g);
    const keep = { ids: {}, n: {} }, seen = {};
    for (const k of g.kids || []) if (k.sa) { const kk = k.sa.item + k.sa.role; seen[kk] = (seen[kk] || 0) + 1; keep.ids[`${k.sa.item}:${k.sa.role}:${seen[kk]}`] = k.id; }
    const res = SA.layout(g.sa.layout, g.sa.items, { x: g.x, y: g.y, w: g.w, h: g.h }, { measure: measurer(d) });
    const pal = DG.palette(d);
    g.kids = res.shapes.map((s) => kidOf(s, g.sa, keep, pal));
    return g;
  };
  /* SmartArt PowerPoint made, in a layout we have: shown as PowerPoint drew it until it is edited here; from then on
     it is laid out and saved with our layout of the same name (the save records the change) */
  function officeEdited(g) {
    if (!g.sa.office) return;
    delete g.sa.office;
    g.sa.converted = true;
    ui.toast(L.t('This IntelliArt now uses Lectern\'s {0} layout, so it can be edited here.', L.t((SA.get(g.sa.layout) || {}).name)), 4000);
  }
  /** after a change: undo point, lay out, draw, keep the text pane in step */
  function change(g, label, fn, coalesce) {
    L.hist.push(label, coalesce);
    officeEdited(g);
    fn();
    DG.relayout(g);
    E().renderShape(g.id);
    E().touched();
    refreshPane();
  }

  /* ---------------------------------------------------------------- inserting */
  DG.insert = (layout, phId) => {
    const slide = E().slide();
    if (!slide) return;
    /* like PowerPoint, an empty content placeholder on the slide takes the diagram */
    const ph = phId ? E().shape(phId) : slide.shapes.find((s) => s.ph && ['obj', 'body'].includes(s.ph.type || 'body') && T.isEmpty(s.tx));
    const box = ph ? { x: ph.x, y: ph.y, w: ph.w, h: ph.h } : { x: L.pres.W * 0.15, y: L.pres.H * 0.22, w: L.pres.W * 0.7, h: L.pres.H * 0.66 };
    L.hist.push('Insert IntelliArt');
    const lay = SA.get(layout) || SA.LAYOUTS[0];
    const g = { id: L.uid('s'), type: 'group', name: lay.name + ' ' + (slide.shapes.length + 1), rot: 0, x: box.x, y: box.y, w: box.w, h: box.h,
      sa: { layout: lay.id, colors: DG.DEFAULT_COLORS, style: DG.DEFAULT_STYLE, items: SA.blank(lay.id) }, kids: [] };
    DG.relayout(g);
    if (ph) slide.shapes.splice(slide.shapes.indexOf(ph), 1, g); else slide.shapes.push(g);
    E().select([g.id]);
    E().render(); E().touched();
    DG.showPane(true);
    /* with the ribbon, SmartArt Tools ▸ Design opens, as in PowerPoint */
    if (L.ribbonUI && L.ribbonUI.built && L.ribbonUI.built()) { ui.refresh(); setTimeout(() => L.ribbonUI.select('smartartDesign'), 60); }
  };

  /** items from outline lines: '\t' before a line makes it a sub-item of the line above */
  DG.itemsFrom = (lines) => {
    const out = [], stack = [];
    for (const ln of lines) {
      const lvl = /^\t*/.exec(ln)[0].length, it = { id: SA.newId(), text: ln.slice(lvl), kids: [] };
      stack.length = Math.min(stack.length, lvl);
      (stack.length ? stack[stack.length - 1].kids : out).push(it);
      stack.push(it);
    }
    return out;
  };
  /** a finished diagram for a deck being built (templates, the sample): in place of a placeholder, or in box */
  DG.make = (pres, slide, at, layout, lines, opts) => {
    const box = { x: at.x, y: at.y, w: at.w, h: at.h };
    const lay = SA.get(layout) || SA.LAYOUTS[0];
    const g = Object.assign({ id: L.uid('s'), type: 'group', name: lay.name + ' ' + (slide.shapes.length + 1), rot: 0 }, box,
      { sa: Object.assign({ layout: lay.id, colors: DG.DEFAULT_COLORS, style: DG.DEFAULT_STYLE, items: DG.itemsFrom(lines) }, opts || {}), kids: [] });
    DG.relayout(g, M.design(pres, slide));
    const i = slide.shapes.indexOf(at);
    if (i >= 0) slide.shapes.splice(i, 1, g); else slide.shapes.push(g);
    return g;
  };

  /* ---------------------------------------------------------------- the gallery */
  /** a small SVG picture of a layout with sample items, in the design's accent colours (opts: colors, style) */
  let thumbN = 0;
  DG.thumb = (layout, w, hh, opts) => {
    opts = opts || {};
    const d = opts.design || design();
    const items = opts.items || sampleItems(layout);
    const { shapes } = SA.layout(layout, items, { x: 2, y: 2, w: w - 4, h: hh - 4 }, { measure: (t, sz) => t.length * sz * 0.5, maxFont: 9, minFont: 4 });
    const sa = { colors: opts.colors || DG.DEFAULT_COLORS, style: opts.style || DG.DEFAULT_STYLE };
    const col = (c) => M.resolveColor(c, d), pal = DG.palette(d);
    /* shadows and lines at the picture's scale, so a small picture still shows them */
    const k = Math.max(0.25, Math.min(1, w / 160));
    let out = '', defs = '';
    for (const s of shapes) {
      const p = paint(s, sa, pal);
      let fill = 'fill="none"';
      if (p.fill.t === 'solid') fill = `fill="${col(p.fill.c)}" fill-opacity="${L.round(p.fill.a, 2)}"`;
      else if (p.fill.t === 'grad') {
        const id = 'sag' + ++thumbN;
        defs += `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${p.fill.stops.map((st) => `<stop offset="${st.p}" stop-color="${col(st.c)}" stop-opacity="${L.round(st.a == null ? 1 : st.a, 2)}"/>`).join('')}</linearGradient>`;
        fill = `fill="url(#${id})"`;
      }
      const stroke = p.line.t === 'none' ? '' : ` stroke="${col(p.line.c)}" stroke-opacity="${L.round(p.line.a == null ? 1 : p.line.a, 2)}" stroke-width="${L.round(s.role === 'conn' ? 1 : Math.max(0.4, p.line.w * k * 0.6), 2)}"`;
      const shadow = p.shadow ? ` style="filter:drop-shadow(0 ${L.round(Math.max(0.5, p.shadow.dy * k * 0.5), 2)}px ${L.round(Math.max(0.5, p.shadow.blur * k * 0.4), 2)}px rgba(0,0,0,${L.round(p.shadow.a, 2)}))"` : '';
      const tr = s.rot ? ` transform="rotate(${L.round(s.rot, 1)} ${L.round(s.x + s.w / 2, 1)} ${L.round(s.y + s.h / 2, 1)})"` : '';
      if (s.geom === 'path') out += `<polyline points="${s.path.map((q) => q.map((v) => L.round(v, 1)).join(',')).join(' ')}" fill="none"${stroke}/>`;
      else if (s.noFill) out += s.text ? s.text.lines.map((ln, i) => `<rect x="${L.round(s.text.box.x + 3, 1)}" y="${L.round(s.text.box.y + 2 + i * 4, 1)}" width="${L.round(s.text.box.w * 0.5, 1)}" height="1.6" fill="#999"/>`).join('') : '';
      else out += `<path d="${shapePath(s)}" ${fill}${stroke}${shadow}${s.flipV ? ` transform="translate(0 ${L.round(2 * s.y + s.h, 1)}) scale(1 -1)"` : tr}/>`;
    }
    return `<svg width="${w}" height="${hh}" viewBox="0 0 ${w} ${hh}" aria-hidden="true">${defs ? `<defs>${defs}</defs>` : ''}${out}</svg>`;
  };
  function shapePath(s) {
    const { x, y, w, h: hh } = s, a = (s.adj || [])[0], r = (v) => L.round(v, 1);
    const P = (pts) => 'M' + pts.map((q) => q.map(r).join(',')).join('L') + 'Z';
    switch (s.geom) {
      case 'poly': return P(s.poly);
      case 'ellipse': return `M${r(x)},${r(y + hh / 2)}a${r(w / 2)},${r(hh / 2)} 0 1 0 ${r(w)},0a${r(w / 2)},${r(hh / 2)} 0 1 0 ${r(-w)},0Z`;
      case 'triangle': return P([[x + w / 2, y], [x + w, y + hh], [x, y + hh]]);
      case 'trapezoid': { const i = ((a == null ? 25000 : a) / 100000) * Math.min(w, hh); return P([[x + i, y], [x + w - i, y], [x + w, y + hh], [x, y + hh]]); }
      case 'chevron': { const dd = hh / 2; return P([[x, y], [x + w - dd, y], [x + w, y + hh / 2], [x + w - dd, y + hh], [x, y + hh], [x + dd, y + hh / 2]]); }
      case 'rightArrow': { const hw = w - hh * 0.5; return P([[x, y + hh * 0.2], [x + hw, y + hh * 0.2], [x + hw, y], [x + w, y + hh / 2], [x + hw, y + hh], [x + hw, y + hh * 0.8], [x, y + hh * 0.8]]); }
      default: return P([[x, y], [x + w, y], [x + w, y + hh], [x, y + hh]]);
    }
  }
  function sampleItems(layout) {
    const it = (t, kids) => ({ id: t, text: '', kids: kids || [] });
    const lay = SA.get(layout) || {};
    if (lay.tree) return [it('a', [it('b', layout === 'orgChart' ? [] : [it('b1'), it('b2')]), it('c'), it('d')])];
    if (layout === 'radial') return [it('a', [it('b'), it('c'), it('d'), it('e')])];
    if (lay.levels === 2) return [it('a', [it('a1'), it('a2')]), it('b', [it('b1')]), it('c', [it('c1')])].slice(0, layout === 'verticalBullet' ? 2 : 3);
    return SA.blank(layout).map((x, i) => it('n' + i));
  }

  /** Insert ▸ SmartArt (and Change Layout): categories, pictures of the layouts, a description */
  DG.gallery = (cb, current) => {
    let pick = current || SA.LAYOUTS[0].id, cat = 'all';
    const cats = h('div', { class: 'sa-cats list-box', role: 'listbox', 'aria-label': 'Categories' });
    const grid = h('div', { class: 'sa-grid', role: 'listbox', 'aria-label': 'Layouts' });
    const big = h('div', { class: 'sa-big' }), title = h('b'), desc = h('div', { class: 'sa-desc' });
    const show = () => { const lay = SA.get(pick); big.innerHTML = DG.thumb(pick, 190, 150); title.textContent = L.t(lay.name); desc.textContent = L.t(lay.desc); L.$$('button', grid).forEach((b) => b.classList.toggle('on', b.dataset.lay === pick)); };
    const fill = () => {
      L.clear(grid);
      const shown = SA.LAYOUTS.filter((l) => cat === 'all' || l.cat === cat);
      if (shown.length && !shown.some((l) => l.id === pick)) pick = shown[0].id;
      for (const lay of shown) {
        const b = h('button', { type: 'button', class: 'sa-cell', 'data-lay': lay.id, 'aria-label': lay.name, 'data-tip': lay.name, html: DG.thumb(lay.id, 74, 58) });
        b.addEventListener('click', () => { pick = lay.id; show(); });
        b.addEventListener('dblclick', () => { pick = lay.id; d.buttons[0].click(); });
        grid.append(b);
      }
      show();
    };
    const used = new Set(SA.LAYOUTS.map((l) => l.cat));
    for (const [k, n] of [['all', L.N('All')]].concat(SA.CATEGORIES.filter(([k]) => used.has(k)))) {
      const b = h('button', { type: 'button', class: 'sa-cat' + (k === cat ? ' on' : ''), text: n });
      b.addEventListener('click', () => { cat = k; L.$$('.sa-cat', cats).forEach((x) => x.classList.toggle('on', x === b)); fill(); });
      cats.append(b);
    }
    const d = ui.dialog({ title: current ? 'Change IntelliArt Layout' : 'Choose an IntelliArt Graphic', width: 720,
      body: h('div', { class: 'sa-gallery' }, cats, grid, h('div', { class: 'sa-side' }, big, title, desc)),
      buttons: [{ label: 'OK', primary: true, onClick: () => cb(pick) }, { label: 'Cancel' }] });
    fill();
  };

  /* ---------------------------------------------------------------- editing the items */
  function locate(items, id, parent) {
    for (let i = 0; i < items.length; i++) {
      if (items[i].id === id) return { list: items, i, item: items[i], parent: parent || null };
      const r = locate(items[i].kids || [], id, items[i]);
      if (r) return r;
    }
    return null;
  }
  DG.locate = (g, id) => locate(g.sa.items, id);
  const newItem = (text) => ({ id: SA.newId(), text: text || '', kids: [] });
  /** the item the user is on: the text pane's row, or the selected shape's item */
  let paneItem = null;
  function focusItem(g) {
    if (paneItem && DG.locate(g, paneItem)) return paneItem;
    const p = E().primary();
    if (p && p.sa && p.sa.item && DG.locate(g, p.sa.item)) return p.sa.item;
    const out = SA.outline(g.sa.items);
    return out.length ? out[out.length - 1].item.id : null;
  }
  const ops = {
    after(g, id) { const r = DG.locate(g, id); const it = newItem(); if (r) r.list.splice(r.i + 1, 0, it); else g.sa.items.push(it); return it.id; },
    before(g, id) { const r = DG.locate(g, id); const it = newItem(); if (r) r.list.splice(r.i, 0, it); else g.sa.items.unshift(it); return it.id; },
    above(g, id) { const r = DG.locate(g, id); if (!r) return ops.after(g, id); const it = newItem(); it.kids = [r.item]; r.list.splice(r.i, 1, it); return it.id; },
    below(g, id) { const r = DG.locate(g, id); if (!r) return ops.after(g, id); const it = newItem(); (r.item.kids = r.item.kids || []).push(it); return it.id; },
    promote(g, id) {
      const r = DG.locate(g, id); if (!r || !r.parent) return id;
      const up = DG.locate(g, r.parent.id);
      r.list.splice(r.i, 1);
      up.list.splice(up.i + 1, 0, r.item);
      return id;
    },
    demote(g, id) {
      const r = DG.locate(g, id); if (!r || r.i === 0) return id;
      r.list.splice(r.i, 1);
      (r.list[r.i - 1].kids = r.list[r.i - 1].kids || []).push(r.item);
      return id;
    },
    up(g, id) { const r = DG.locate(g, id); if (r && r.i > 0) [r.list[r.i - 1], r.list[r.i]] = [r.list[r.i], r.list[r.i - 1]]; return id; },
    down(g, id) { const r = DG.locate(g, id); if (r && r.i < r.list.length - 1) [r.list[r.i + 1], r.list[r.i]] = [r.list[r.i], r.list[r.i + 1]]; return id; },
    remove(g, id) {
      const r = DG.locate(g, id); if (!r) return null;
      r.list.splice(r.i, 1, ...(r.item.kids || []));
      const out = SA.outline(g.sa.items);
      return out.length ? out[Math.min(out.length - 1, Math.max(0, r.i - 1))].item.id : null;
    },
  };
  const LABELS = { after: 'Add Shape', before: 'Add Shape', above: 'Add Shape', below: 'Add Shape', promote: L.N('Promote'), demote: L.N('Demote'), up: 'Move Up', down: 'Move Down', remove: 'Delete Shape' };
  /** run an item operation on the current diagram; the pane follows the item it leaves you on */
  DG.op = (name, g, id) => {
    g = g || DG.current();
    if (!g) return;
    id = id || focusItem(g);
    let next = id;
    change(g, LABELS[name], () => { next = ops[name](g, id); });
    paneItem = next;
    selectItem(g, next);
    refreshPane(true);
  };
  function selectItem(g, id) {
    const k = g.kids.find((x) => x.sa && x.sa.item === id && x.sa.role === 'node');
    if (k && E().sel[0] !== g.id) E().select([k.id]);
  }
  DG.setText = (g, id, text) => {
    const r = DG.locate(g, id);
    if (!r || r.item.text === text) return;
    change(g, L.N('Typing'), () => { r.item.text = text; }, 'sa-type-' + id);
  };
  DG.set = (key, val, g) => {
    g = g || DG.current();
    if (!g || g.sa[key] === val) return;
    const label = { layout: 'Change Layout', colors: 'Change Colors', style: L.N('IntelliArt Style') }[key];
    change(g, label, () => { g.sa[key] = val; if (key === 'layout') g.name = (SA.get(val) || {}).name + ' ' + g.name.split(' ').pop(); });
  };
  DG.reset = (g) => {
    g = g || DG.current();
    if (!g) return;
    change(g, 'Reset Graphic', () => {
      g.sa.colors = DG.DEFAULT_COLORS; g.sa.style = DG.DEFAULT_STYLE;
      for (const k of g.kids) if (k.sa) delete k.sa.gen;   // nothing to capture: the shapes start again
      for (const o of SA.outline(g.sa.items)) delete o.item.fmt;
    });
  };
  /** Convert to Shapes: the same shapes, as an ordinary group */
  DG.toShapes = (g) => {
    g = g || DG.current();
    if (!g) return;
    E().commit('Convert to Shapes', () => { delete g.sa; for (const k of g.kids) { delete k.sa; } g.name = 'Group ' + g.name.split(' ').pop(); });
    refreshPane();
  };
  /** Delete on shapes of one diagram removes their items (their sub-items move up); true when handled */
  DG.deleteKids = (shapes) => {
    const g = shapes.length && DG.of(shapes[0]);
    if (!g || DG.isDiagram(shapes[0]) || !shapes.every((s) => s.sa && s.sa.item && DG.of(s) === g)) return false;
    const ids = [...new Set(shapes.map((s) => s.sa.item))];
    change(g, 'Delete Shape', () => { for (const id of ids) ops.remove(g, id); });
    E().select([g.id]);
    return true;
  };
  /* an edit on the slide goes back to the item: its first paragraph is the item, the rest its sub-items */
  let editing = null;
  let editingText = null;
  L.bus.on('edit-start', () => { editing = L.te && L.te.state ? L.te.state.id : null; const k = editing && E().shape(editing); editingText = k && k.tx ? T.plain(k.tx) : null; });
  L.bus.on('edit-end', () => {
    const id = editing;
    editing = null;
    const k = id && E().shape(id), g = k && DG.of(k);
    if (!g || g === k) return;
    if (!k.sa) {
      /* PowerPoint's own drawing: the item whose text the shape showed */
      const before = (editingText || '').replace(/\s+/g, ' ').trim();
      const hit = before && SA.outline(g.sa.items).find((o) => o.item.text.replace(/\s+/g, ' ').trim() === before);
      const now = T.plain(k.tx).replace(/\s+/g, ' ').trim();
      if (!hit || now === before) return;
      officeEdited(g);
      L.hist.push(L.N('Typing'));
      hit.item.text = now;
      DG.relayout(g); E().renderShape(g.id); E().touched(); refreshPane();
      return;
    }
    const r = DG.locate(g, k.sa.item);
    if (!r) return;
    const paras = (k.tx ? k.tx.ps : []).map((p) => ({ t: T.paraText(p), lvl: p.lvl || 0 }));
    const top = paras.filter((p) => !p.lvl).map((p) => p.t);
    const subs = paras.filter((p) => p.lvl).map((p) => p.t);
    L.hist.push(L.N('Typing'));
    if (k.sa.role === 'child') r.item.kids = subs.concat(top).map((t, i) => Object.assign(r.item.kids[i] || newItem(), { text: t }));
    else {
      r.item.text = top.join(' ');
      if (subs.length || ((SA.get(g.sa.layout) || {}).id === 'blockList' && r.item.kids.length)) r.item.kids = subs.map((t, i) => Object.assign(r.item.kids[i] || newItem(), { text: t }));
    }
    DG.relayout(g);
    E().renderShape(g.id);
    E().touched();
    refreshPane();
  });

  /* a diagram read from a file shows the shapes stored in it; the first time it is selected they are laid out
     here, so that each shape knows its item (clicks, on-slide typing, Delete) */
  /* selecting a diagram opens the sidebar on its text pane, once each time it becomes selected (closing the pane
     keeps it closed while the same diagram stays selected) */
  let selected = null;
  /* a new design or colour scheme: shades and gradients are worked out from the design's colours */
  L.bus.on('slides-changed', (e) => {
    if (!e || !e.design) return;
    let n = 0;
    for (const s of L.pres.slides) for (const g of s.shapes) if (DG.isDiagram(g) && !g.sa.office) { DG.relayout(g, M.design(L.pres, s)); n++; }
    if (n) E().render();
  });
  L.bus.on('selection', () => {
    const g = DG.current();
    if (g && !g.sa.office && g.kids.some((k) => !k.sa)) { DG.relayout(g); E().renderShape(g.id); }
    if (g && g.id !== selected) DG.showPane();
    selected = g ? g.id : null;
  });

  /* ---------------------------------------------------------------- the text pane */
  let paneG = null;
  function rowsOf(g) { return SA.outline(g.sa.items); }
  function renderPane(b) {
    L.clear(b);
    const g = DG.current();
    paneG = g ? g.id : null;
    if (!g) { b.append(h('div', { class: 'tp-note', text: 'Select an IntelliArt graphic to type its text here.' }), h('div', { class: 'tp-row' }, ui.button('Insert IntelliArt...', () => ui.exec('insertDiagram'), { class: 'btn' }))); return; }
    b.append(h('div', { class: 'tp-h', text: 'Type your text here' }));
    b.append(h('div', { class: 'sa-tools' }, ...['diagramAddShape', 'diagramPromote', 'diagramDemote', 'diagramMoveUp', 'diagramMoveDown'].map((id) => ui.tbButton(id))));
    const list = h('div', { class: 'sa-pane', role: 'tree', 'aria-label': 'IntelliArt text' });
    for (const row of rowsOf(g)) {
      const inp = h('input', { type: 'text', class: 'sa-row', value: row.item.text, placeholder: '[Text]', 'aria-label': L.t('Item, level {0}', row.level + 1), 'data-item': row.item.id, style: `margin-left:${row.level * 16}px` });
      inp.addEventListener('focus', () => { paneItem = row.item.id; selectItem(g, row.item.id); L.hist.breakCoalesce(); });
      inp.addEventListener('input', () => DG.setText(g, row.item.id, inp.value));
      inp.addEventListener('keydown', (e) => paneKey(e, g, row, inp));
      list.append(h('div', { class: 'sa-line', role: 'treeitem' }, h('span', { class: 'sa-bul', text: '•', style: `margin-left:${row.level * 16}px` }), inp));
    }
    b.append(list);
    b.append(h('div', { class: 'tp-note', text: 'Enter adds an item, Tab and Shift+Tab move it in and out a level, Alt+Shift+↑/↓ move it.' }));
    /* the layouts of the same kind, the colours and the styles, each drawn as it would look */
    const lay = SA.get(g.sa.layout) || SA.LAYOUTS[0];
    b.append(h('div', { class: 'tp-h', text: 'Layout' }), DG.layoutGrid(g, (l) => l.cat === lay.cat, 4),
      h('div', { class: 'tp-row' }, ui.button('More Layouts...', () => ui.exec('diagramLayout'), { class: 'btn small' })));
    b.append(h('div', { class: 'tp-h', text: 'Colors' }), DG.colorsGrid(g, 3));
    b.append(h('div', { class: 'tp-h', text: 'IntelliArt Styles' }), DG.stylesGrid(g, 3));
    b.append(h('div', { class: 'tp-row' }, ui.button('Reset Graphic', () => DG.reset(), { class: 'btn small' }), ui.button('Convert to Shapes', () => DG.toShapes(), { class: 'btn small' })));
    const want = paneItem && L.$(`.sa-row[data-item="${paneItem}"]`, list);
    if (want && paneFocus) { want.focus(); want.setSelectionRange(want.value.length, want.value.length); }
  }
  let paneFocus = false;
  function paneKey(e, g, row, inp) {
    e.stopPropagation();
    const go = (name) => { e.preventDefault(); paneFocus = true; DG.op(name, g, row.item.id); paneFocus = false; };
    if (e.key === 'Enter') { e.preventDefault(); paneFocus = true; DG.op('after', g, row.item.id); paneFocus = false; }
    else if (e.key === 'Tab') go(e.shiftKey ? 'promote' : 'demote');
    else if (e.altKey && e.shiftKey && e.key === 'ArrowUp') go('up');
    else if (e.altKey && e.shiftKey && e.key === 'ArrowDown') go('down');
    else if (e.key === 'Backspace' && !inp.value && rowsOf(g).length > 1) go('remove');
    else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const all = L.$$('.sa-row', inp.closest('.sa-pane'));
      const n = all[all.indexOf(inp) + (e.key === 'ArrowUp' ? -1 : 1)];
      if (n) n.focus();
    } else if (e.key === 'Escape') { e.preventDefault(); inp.blur(); E().select([g.id]); }
  }
  function refreshPane(force) {
    const TP = L.panes && L.panes.task;
    if (!TP || TP.current !== 'diagramText' || !TP.el || TP.el.hidden) return;
    const b = TP.body;
    const focused = b.contains(document.activeElement);
    if (focused && !force) {
      /* typing: only the values change, the rows stay */
      const g = DG.current();
      if (g && g.id === paneG) return;
    }
    paneFocus = paneFocus || focused;
    renderPane(b);
    paneFocus = false;
  }
  DG.showPane = (on) => { const TP = L.panes && L.panes.task; if (!TP) return; if (on === false) { if (TP.current === 'diagramText') L.app.toggleTask(false); return; } TP.show('diagramText'); };
  if (L.panes && L.panes.task) L.panes.task.register({ id: 'diagramText', title: 'IntelliArt', render(b) { renderPane(b); }, refresh(b, reason) { if (reason === 'selection') { const g = DG.current(); if (g && g.id === paneG && b.contains(document.activeElement)) return; } renderPane(b); } });

  /* ---------------------------------------------------------------- galleries for the pane, the toolbar and the ribbon */
  /** a grid of pictures, one button per choice; pick(value) on a click */
  function grid(cols, cells, cls, pick) {
    const el = h('div', { class: 'sa-pick ' + cls, style: `grid-template-columns:repeat(${cols}, 1fr)` });
    for (const [value, name, html, on] of cells) {
      const b = h('button', { type: 'button', class: 'sa-cell' + (on ? ' on' : ''), 'aria-label': name, 'aria-pressed': on ? 'true' : 'false', 'data-tip': name, html });
      b.addEventListener('pointerdown', (e) => e.preventDefault());
      b.addEventListener('click', () => pick(value));
      el.append(b);
    }
    return el;
  }
  const three = [1, 2, 3].map((i) => ({ id: 'c' + i, text: '', kids: [] }));
  DG.layoutGrid = (g, which, cols, done) => grid(cols, SA.LAYOUTS.filter(which || (() => true)).map((l) => [l.id, l.name, DG.thumb(l.id, 60, 44, { colors: g && g.sa.colors, style: g && g.sa.style }), !!g && g.sa.layout === l.id]),
    'sa-lays', (k) => { if (done) done(); DG.set('layout', k, g); });
  /** the colour choices this design can show (an accent too pale for the slide would repeat another) */
  DG.colorsGrid = (g, cols, done) => {
    const shown = DG.colorChoices(design());
    if (g && !shown.some(([k]) => k === g.sa.colors)) shown.unshift([g.sa.colors, DG.colorsLabel(g.sa.colors)]);
    return grid(cols, shown.map(([k, n]) => [k, n, DG.thumb('process', 72, 28, { colors: k, style: g && g.sa.style, items: three }), !!g && g.sa.colors === k]), 'sa-colors', (k) => { if (done) done(); DG.set('colors', k, g); });
  };
  /** the styles, a grid for each design language */
  DG.stylesGrid = (g, cols, done) => h('div', { class: 'sa-styles' }, ...DG.STYLE_GROUPS.flatMap(([lang, title]) => [h('div', { class: 'sa-sub', text: title }),
    grid(cols, DG.STYLES.filter((st) => DG.styleLang(st[0]) === lang).map(([k, n]) => [k, n, DG.thumb('process', 72, 34, { colors: g && g.sa.colors, style: k, items: three }), !!g && g.sa.style === k]),
      '', (k) => { if (done) done(); DG.set('style', k, g); })]));

  DG.layoutMenu = (r) => {
    const g = DG.current();
    ui.openMenu([{ custom: (close) => h('div', { class: 'sa-menu-grid' }, DG.layoutGrid(g, null, 5, close)) }, '-', 'diagramLayout'], r);
  };
  DG.colorsMenu = (r) => { const g = DG.current(); ui.openMenu([{ custom: (close) => h('div', { class: 'sa-menu-grid' }, DG.colorsGrid(g, 4, close)) }], r); };
  DG.styleMenu = (r) => { const g = DG.current(); ui.openMenu([{ custom: (close) => h('div', { class: 'sa-menu-grid' }, DG.stylesGrid(g, 4, close)) }], r); };

  /* ---------------------------------------------------------------- commands */
  const C = (id, def) => ui.cmd(id, def);
  const inDiagram = () => !!DG.current() && E().view !== 'master';
  C('diagramAddShape', { label: 'Add Shape', icon: 'addShape', tip: 'Add Shape After', enabled: inDiagram, run: () => DG.op('after') });
  C('diagramAddAfter', { label: 'Add Shape &After', icon: 'addShape', enabled: inDiagram, run: () => DG.op('after') });
  C('diagramAddBefore', { label: 'Add Shape &Before', enabled: inDiagram, run: () => DG.op('before') });
  C('diagramAddAbove', { label: 'Add Shape Ab&ove', enabled: inDiagram, run: () => DG.op('above') });
  C('diagramAddBelow', { label: 'Add Shape Be&low', enabled: inDiagram, run: () => DG.op('below') });
  C('diagramPromote', { label: 'Promote', icon: 'promote', enabled: inDiagram, run: () => DG.op('promote') });
  C('diagramDemote', { label: 'Demote', icon: 'demote', enabled: inDiagram, run: () => DG.op('demote') });
  C('diagramMoveUp', { label: 'Move Up', icon: 'moveUp', enabled: inDiagram, run: () => DG.op('up') });
  C('diagramMoveDown', { label: 'Move Down', icon: 'moveDown', enabled: inDiagram, run: () => DG.op('down') });
  C('diagramTextPane', { label: 'Text Pane', icon: 'taskpane', enabled: inDiagram, checked: () => !!(L.panes && L.panes.task.current === 'diagramText' && L.panes.task.el && !L.panes.task.el.hidden), run: () => { const on = ui.checked('diagramTextPane'); DG.showPane(!on); } });
  C('diagramLayout', { label: 'Change &Layout...', icon: 'layout', enabled: inDiagram, run: () => { const g = DG.current(); DG.gallery((k) => DG.set('layout', k, g), g.sa.layout); } });
  C('diagramColors', { label: 'Change Colors', icon: 'colorPic', enabled: inDiagram, run: () => {} });
  C('diagramStyle', { label: 'IntelliArt Styles', icon: 'themes', enabled: inDiagram, run: () => {} });
  C('diagramReset', { label: 'Reset Graphic', icon: 'resetGraphic', enabled: inDiagram, run: () => DG.reset() });
  C('diagramToShapes', { label: 'Convert to Shapes', icon: 'toShapes', enabled: inDiagram, run: () => DG.toShapes() });
})();
