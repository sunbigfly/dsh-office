/* Keep the native menu keyboard/submenu behavior when moving items to More. */
(function () {
  'use strict';
  function fitCount(widths, budget, moreWidth) {
    if (widths.reduce((sum, width) => sum + width, 0) <= budget) return widths.length;
    let used = moreWidth, count = 0;
    for (const width of widths) { if (used + width > budget) break; used += width; count++; }
    return count;
  }
  function install(header, controls, L) {
    let bar = L.app?.menuBar;
    if (!bar?.menus?.length) return () => {};
    const menus = [...bar.menus];
    const tools = header.querySelector('.toolbar'), formatRow = document.querySelector('.rdf-format-row');
    for (const row of [formatRow, document.querySelector('#drawrow')].filter(Boolean)) {
      row.tabIndex = 0; row.setAttribute('aria-label', '工具栏，可左右滚动');
      row.addEventListener('keydown', event => {
        if (event.target !== row || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
        event.preventDefault(); event.stopPropagation(); row.scrollBy({ left: event.key === 'ArrowRight' ? 120 : -120 });
      });
    }
    let shown = menus.length;
    function fit() {
      if (!header.clientWidth) return;
      // The app starts hidden, then translates its labels asynchronously.
      // Measure a native, off-layout menu using the current language/fonts;
      // never reuse zero widths or pre-translation English measurements.
      const measure = document.createElement('div');
      measure.style.cssText = 'position:fixed;left:-10000px;top:0;visibility:hidden;pointer-events:none;width:max-content';
      header.appendChild(measure);
      const sample = L.ui.menuBar(measure, [...menus, { label: '更多', items: [] }]);
      const measured = [...sample.children].map(node => node.getBoundingClientRect().width);
      measure.remove(); L.ui.menus = bar.menus;
      if (!measured.some(Boolean)) return;
      const moreWidth = measured.pop(), widths = measured, toolsWidth = tools?.scrollWidth || 0;
      const available = header.clientWidth - controls.getBoundingClientRect().width - 16;
      const allMenus = widths.reduce((sum, width) => sum + width, 0);
      // Keep optional insert/view shortcuts in the scrolling formatting row
      // whenever they would squeeze the menus or the save controls.
      const toolsInHeader = formatRow && tools && allMenus + toolsWidth > available ? false : true;
      if (tools && formatRow) {
        if (toolsInHeader && tools.parentElement !== header) header.insertBefore(tools, controls);
        if (!toolsInHeader && tools.parentElement !== formatRow) formatRow.appendChild(tools);
      }
      const budget = available - (toolsInHeader ? toolsWidth : 0);
      const count = fitCount(widths, budget, moreWidth);
      if (count === shown) return;
      const activeIndex = [...bar.children].indexOf(document.activeElement);
      const visible = menus.slice(0, count);
      if (count < menus.length) visible.push({ label: '更多', items: () => menus.slice(count).map(menu => ({ label: menu.label, sub: menu.items })) });
      L.ui.closeMenus();
      const next = L.ui.menuBar(header, visible);
      bar.replaceWith(next); bar = next; shown = count; L.app.menuBar = next;
      // Preserve native accelerators for entries now inside More.
      const byKey = next.openByKey;
      next.openByKey = key => {
        const index = menus.findIndex(menu => /&([^&])/.exec(menu.label)?.[1].toLowerCase() === key.toLowerCase());
        if (index < count || index < 0) return byKey(key);
        const rect = next.lastElementChild.getBoundingClientRect();
        L.ui.closeMenus(); L.ui.openMenu(menus[index].items, { left: rect.left, bottom: rect.bottom }, { selectFirst: true });
        return true;
      };
      if (activeIndex >= 0) next.children[Math.min(activeIndex, next.children.length - 1)].focus();
    }
    window.addEventListener('resize', fit);
    if (typeof ResizeObserver === 'function') {
      const observer = new ResizeObserver(fit); observer.observe(header); observer.observe(controls);
      window.addEventListener('pagehide', () => observer.disconnect(), { once: true });
    }
    fit(); return fit;
  }
  window.DSHOfficeMenus = { fitCount, install };
})();
