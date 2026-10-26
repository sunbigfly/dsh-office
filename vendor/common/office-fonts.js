/* Shared RDF font ordering, grouping and lazy previews for all office editors. */
(function () {
  'use strict';
  const L = window.L, { h } = L;
  const commonFontAliases = [
    ['宋体', 'SimSun'], ['黑体', 'SimHei'], ['微软雅黑', 'Microsoft YaHei'],
    ['楷体', 'KaiTi'], ['仿宋', 'FangSong'], ['Times New Roman'], ['Arial'], ['Calibri'],
  ];
  function commonFonts(names) {
    return commonFontAliases.map(aliases => aliases.map(alias => names.find(name => name.toLowerCase() === alias.toLowerCase())).find(Boolean)).filter(Boolean);
  }

  function fontPreviews(menu, names) {
    if (!menu) return;
    const common = new Set(commonFonts(names));
    let lastGroup;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const row = entry.target;
        observer.unobserve(row);
        const preview = row.querySelector('.rdf-font-preview');
        const name = row.dataset.fontFamily;
        const request = L.rdfFontPreview ? L.rdfFontPreview(name) : Promise.resolve(name);
        request.then(family => {
          if (!preview.isConnected) return;
          preview.style.fontFamily = JSON.stringify(family);
          preview.textContent = 'Aa 中文';
        }).catch(() => { if (preview.isConnected) preview.textContent = '不可预览'; });
      }
    }, { root: menu });
    L.$$('.m-item', menu).forEach((row, index) => {
      const group = common.has(names[index]) ? '常用字体' : '全部字体';
      if (group !== lastGroup) {
        row.before(h('div', { class: 'rdf-font-group', role: 'presentation' }, group));
        lastGroup = group;
      }
      row.dataset.fontFamily = names[index];
      const label = row.querySelector('.m-lbl');
      label.title = names[index];
      const preview = h('span', { class: 'rdf-font-preview', 'aria-hidden': 'true' }, '…');
      label.after(preview);
      observer.observe(row);
    });
    return () => observer.disconnect();
  }

  L.officeFonts = {
    common: commonFonts,
    preview: fontPreviews,
    options(extra = []) {
      const families = new Map();
      for (const name of [...L.FONT_LIST, ...(L.rdfFontFamilies || []), ...extra]) {
        if (typeof name === 'string' && name && !families.has(name.toLowerCase())) families.set(name.toLowerCase(), name);
      }
      const all = [...families.values()].sort((a, b) => a.localeCompare(b, 'zh-CN'));
      const common = commonFonts(all);
      return common.concat(all.filter(name => !common.includes(name)));
    },
  };
})();
