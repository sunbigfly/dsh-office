import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../embed/bootstrap.js', import.meta.url), 'utf8');
function bootstrap(crypto) {
  const window = { addEventListener() {} }, navigator = {};
  vm.runInNewContext(source, { window, navigator, crypto, Uint8Array, URLSearchParams });
  return window;
}

test('LAN HTTP bootstrap supplies UUID v4 identifiers with secure random bytes', () => {
  let calls = 0;
  const crypto = { getRandomValues(bytes) { calls++; return webcrypto.getRandomValues(bytes); } };
  bootstrap(crypto);
  const ids = Array.from({ length: 100 }, () => crypto.randomUUID());
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(new Set(ids).size, 100);
  assert.equal(calls, 100);
});

test('secure-context UUID implementation is retained', () => {
  const randomUUID = () => 'native-uuid';
  const crypto = { randomUUID };
  bootstrap(crypto);
  assert.equal(crypto.randomUUID, randomUUID);
});

test('legacy theme preferences cannot change the fixed Paper menu layout', () => {
  const { localStorage } = bootstrap({ randomUUID() {} });
  assert.equal(localStorage.getItem('vibeoffice.lang'), 'zh-CN');
  for (const value of ['classic', 'paper2016']) {
    localStorage.setItem('vibeoffice.look', value);
    assert.equal(localStorage.getItem('vibeoffice.look'), 'paper');
  }
  localStorage.removeItem('vibeoffice.look');
  assert.equal(localStorage.getItem('vibeoffice.look'), 'paper');
});

test('the assistant starts hidden without removing its manual enable setting', () => {
  const { localStorage } = bootstrap({ randomUUID() {} });
  assert.equal(JSON.parse(localStorage.getItem('vibeoffice.assistant')).on, false);
  const today = new Date();
  assert.equal(localStorage.getItem('scout.lastHiddenDay'), `${today.getFullYear()}-${today.getMonth() + 1}-${today.getDate()}`);
  localStorage.setItem('vibeoffice.assistant', '{"on":true}'); localStorage.removeItem('scout.lastHiddenDay');
  assert.equal(JSON.parse(localStorage.getItem('vibeoffice.assistant')).on, true);
  assert.equal(localStorage.getItem('scout.lastHiddenDay'), null);
});
