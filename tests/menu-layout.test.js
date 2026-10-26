import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const window = {};
const source = await readFile(new URL('../embed/menu-layout.js', import.meta.url), 'utf8');
vm.runInNewContext(source, { window });
const { fitCount } = window.DSHOfficeMenus;
const widths = [48, 50, 54, 52, 56, 50, 52, 54, 50];

test('wide menus remain intact and smaller spaces move a suffix into More', () => {
  assert.equal(fitCount(widths, 500, 46), 9);
  assert.equal(fitCount(widths, 205, 46), 3);
  assert.equal(fitCount(widths, 150, 46), 2);
  assert.equal(fitCount(widths, 60, 46), 0);
});

test('growing the available width never hides more menus or exceeds the budget', () => {
  let before = 0;
  for (let budget = 46; budget < 600; budget++) {
    const count = fitCount(widths, budget, 46);
    assert.ok(count >= before);
    assert.ok(widths.slice(0, count).reduce((sum, width) => sum + width, 0) + (count < widths.length ? 46 : 0) <= budget);
    before = count;
  }
});

test('an initially hidden editor measures menus after reveal and retains every folded command', () => {
  const listeners = new Map();
  let header, active, itemWidth = 50;
  function element(width = 0) {
    return { children: [], scrollWidth: width, className: '', style: {}, setAttribute() {}, addEventListener() {},
      get lastElementChild() { return this.children.at(-1); },
      getBoundingClientRect() { return { width: header.clientWidth ? width : 0, left: 0, bottom: 28 }; },
      appendChild(node) { node.remove?.(); this.children.push(node); node.parentElement = this; },
      insertBefore(node, reference) { node.remove(); this.children.splice(this.children.indexOf(reference), 0, node); node.parentElement = this; },
      remove() { if (this.parentElement) { const a = this.parentElement.children; a.splice(a.indexOf(this), 1); this.parentElement = null; } },
      replaceWith(next) { const p = this.parentElement, index = p.children.indexOf(this); next.remove(); p.children[index] = next; next.parentElement = p; this.parentElement = null; },
      focus() { active = this; } };
  }
  header = element(); header.clientWidth = 0;
  const controls = element(160), tools = element(100), formatRow = element();
  header.querySelector = () => tools;
  const ui = { closeMenus() {}, menuBar(parent, menus) { const bar = element(); bar.menus = menus; bar.openByKey = () => false; for (const menu of menus) { const item = element(itemWidth); item.textContent = menu.label; bar.appendChild(item); } parent.appendChild(bar); return bar; } };
  const original = [{ label: '&File', items: ['open'] }, { label: '&Edit', items: ['copy'] }, { label: '&View', items: ['zoom'] }, { label: '&Help', items: ['help'] }];
  const L = { app: { menuBar: ui.menuBar(header, original) }, ui };
  header.appendChild(tools); header.appendChild(controls);
  const document = { createElement: () => element(46), querySelector: selector => selector === '.rdf-format-row' ? formatRow : null, get activeElement() { return active; } };
  const window = { addEventListener(name, callback) { listeners.set(name, callback); } };
  vm.runInNewContext(source, { window, document });
  const fit = window.DSHOfficeMenus.install(header, controls, L);
  assert.equal(L.app.menuBar.menus.length, 4);
  header.clientWidth = 300; fit();
  assert.equal(tools.parentElement, formatRow);
  assert.equal(L.app.menuBar.menus.at(-1).label, '更多');
  const visible = L.app.menuBar.menus.slice(0, -1).map(menu => menu.label);
  const folded = L.app.menuBar.menus.at(-1).items().map(menu => menu.label);
  assert.deepEqual([...visible, ...folded], original.map(menu => menu.label));
  header.clientWidth = 390; fit();
  assert.equal(L.app.menuBar.menus.length, 4);
  itemWidth = 80; listeners.get('resize')();
  assert.equal(L.app.menuBar.menus.at(-1).label, '更多', 'labels translated after attach must be measured again');
  assert.ok(L.app.menuBar.menus.length < 4);
  header.clientWidth = 900; listeners.get('resize')();
  assert.equal(L.app.menuBar.menus.length, 4);
  assert.equal(tools.parentElement, header);
});
