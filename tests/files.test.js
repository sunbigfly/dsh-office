import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, symlink, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ownerFiles, officeType, hash } from '../files.js';
import { assetResponse } from '../index.js';
const version = JSON.parse(await readFile(new URL('../package.json', import.meta.url))).version;

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-office-files-')), workspace = join(root, 'workspace');
  await mkdir(workspace); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(workspace, 'sample.docx'), '# Original\n');
  const files = ownerFiles({ session: async id => id === 'own' ? { cwd: workspace } : null });
  return { root, workspace, files, request: { sessionId: 'own', path: 'sample.docx' } };
}
test('three Office formats match case-insensitively and Markdown stays native', () => {
  for (const [path, type] of [['a.DOCX', 'quire'], ['a.xlsx', 'ledger'], ['a.pptx', 'lectern']]) assert.equal(officeType(path), type);
  for (const path of ['a.md', 'a.MD', 'a.doc', 'a.pdf', 'a.docx.exe', '/x.md/folder']) assert.equal(officeType(path), null);
});
test('owner edit saves atomically and an old editor cannot overwrite newer content', async t => {
  const f = await fixture(t), source = await f.files({ action: 'read', ...f.request });
  assert.equal(Buffer.from(source.data, 'base64').toString(), '# Original\n');
  const data = Buffer.from('# Edited 中文\n');
  const saved = await f.files({ action: 'write', ...f.request, revision: source.revision, data: data.toString('base64') });
  assert.equal(saved.revision, hash(data)); assert.deepEqual(await readFile(join(f.workspace, 'sample.docx')), data);
  await assert.rejects(f.files({ action: 'write', ...f.request, revision: source.revision, data: source.data }), { status: 409 });
  assert.deepEqual(await readdir(f.workspace), ['sample.docx']);
});
test('native write adapter rejects missing sessions, traversal, symlinks and malformed data', async t => {
  const f = await fixture(t); await writeFile(join(f.root, 'secret.docx'), 'outside'); await symlink(join(f.root, 'secret.docx'), join(f.workspace, 'link.docx'));
  await mkdir(join(f.root, 'outside')); await writeFile(join(f.root, 'outside', 'x.docx'), 'outside'); await symlink(join(f.root, 'outside'), join(f.workspace, 'elsewhere'));
  for (const change of [{ sessionId: 'foreign' }, { path: '../secret.docx' }, { path: 'link.docx' }, { path: 'elsewhere/x.docx' }, { path: 'a.pdf' }, { path: 'a.md' }]) await assert.rejects(f.files({ action: 'read', ...f.request, ...change }));
  const source = await f.files({ action: 'read', ...f.request });
  await assert.rejects(f.files({ action: 'write', ...f.request, revision: source.revision, data: 'invalid=' }));
  assert.equal((await readFile(join(f.root, 'secret.docx'))).toString(), 'outside');
});
test('full-file read enforces the cap before returning bytes', async t => {
  const f = await fixture(t), files = ownerFiles({ session: async () => ({ cwd: f.workspace }), maxBytes: 2 });
  await assert.rejects(files({ action: 'read', ...f.request }), { status: 413 });
});
test('static handler exposes only public editor assets and sandbox CSP excludes APIs and Internet', async () => {
  const get = path => assetResponse(new Request('http://team.local:18620' + path));
  const page = await get('/dsh-office/vendor/quire/index.html');
  assert.equal(page.status, 200); const html = await page.text();
  assert.ok(html.includes('/dsh-office/embed/bootstrap.js')); assert.ok(html.includes('/dsh-office/embed/bridge.js'));
  assert.ok(html.includes(`embed/bridge.js?v=${version}`));
  assert.ok(html.includes(`embed/editor.css?v=${version}`));
  assert.ok(html.includes(`rdf-theme.css?v=${version}`));
  assert.ok(html.indexOf(`common/office-fonts.js?v=${version}`) < html.indexOf(`src="js/app.js?v=${version}"`));
  const csp = page.headers.get('content-security-policy'); assert.ok(csp.includes('http://team.local:18620/dsh-office/'));
  assert.ok(!csp.includes('https://vibeoffice.work')); assert.ok(!csp.includes("'unsafe-eval'"));
  for (const path of ['/dsh-office/index.js', '/dsh-office/package.json', '/dsh-office/embed/secret.js', '/dsh-office/vendor/%2e%2e/index.js']) assert.equal((await get(path)).status, 404);
  assert.equal((await assetResponse(new Request('http://team.local/dsh-office/embed/bridge.js', { method: 'POST' }))).status, 405);
});

test('Word, Excel and PowerPoint receive the same embedded menu, theme and HTTP bootstrap', async () => {
  for (const app of ['quire', 'ledger', 'lectern']) {
    const page = await assetResponse(new Request(`http://team.local:18620/dsh-office/vendor/${app}/index.html`));
    const html = await page.text();
    assert.equal((html.match(/<head>/g) || []).length, 1, app);
    assert.equal((html.match(/<\/head>/g) || []).length, 1, app);
    for (const path of ['embed/bootstrap.js', 'embed/menu-layout.js', 'embed/bridge.js', 'embed/editor.css', 'common/office-fonts.js', 'rdf-theme.css']) assert.ok(html.includes(path + `?v=${version}`), `${app}: ${path}`);
    assert.ok(html.indexOf('embed/bootstrap.js') < html.indexOf('common/look.js'), app);
    assert.ok(html.indexOf('embed/editor.css') < html.indexOf('<div id="app"'), app);
  }
});
