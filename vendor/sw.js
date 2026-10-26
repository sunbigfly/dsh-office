/* VibeOffice service worker: the published site, cached for offline use, one version per page.
 * Works only on the allowed origins (cached()): https://vibeoffice.work/, and 127.0.0.1 on any port, to try a
 * published copy locally. common/suite.js registers it there alone, from every page of the web edition (never in
 * the desktop app); its scope is public/, which is / on the site.
 *
 * VERSION is 'dev' in the repository. Publishing (../cf-vibeoffice/sync-cf-pages.sh) runs tools/web-release.sh on
 * the copy it deploys, which stamps the site's version here and in common/suite.js (v<yyyy>.<mm>.<dd>-<6 hex>) and
 * packs updater/web-<version>.zip: every file of the site but this one and updater/. A new version changes this
 * file, so browsers install the new worker.
 *
 * Anywhere else, or unstamped (VERSION 'dev', as in the repository and so on the dev server, tools/serve.py on
 * 127.0.0.1:8760), nothing is cached and no request is answered here, so every request reaches the server;
 * activating deletes whatever an earlier worker cached.
 *
 * Published:
 * - Install: download the version's zip, the whole site in one file, and unpack it into the cache
 *   "vibeoffice-<version>" with the apps' own ZIP engine (common/zip.js: the browser's inflate, or its own in
 *   JavaScript), every file checked against the size and CRC-32 the zip's directory records, its Content-Type
 *   from its extension. One file means one consistent version, whatever the server does meanwhile. Any failure
 *   (offline, a short download, a damaged zip, storage full) fails the install: the half-filled cache is deleted,
 *   the earlier worker goes on serving, and the browser tries again on a later visit. Progress goes to every open
 *   page as { type: 'vo-cache', state: 'progress', update, progress (0 to 1: the download, then the unpacking),
 *   received and total (the zip's bytes; total 0 if the server didn't say), version }, then { state: 'failed',
 *   error } or, once the new worker has taken over (activate, so a reload gets the new version), { state: 'done',
 *   update }; the Start Center shows it, and offers a reload after an update. The new worker takes over at once
 *   (skipWaiting, clients.claim), which is safe because of the next point.
 * - Each page keeps the version it was loaded with: a page (client) is served only from its own version's cache,
 *   recorded in the cache "vibeoffice-clients" (client id → version), so a page that is open while an update
 *   lands never mixes files of two versions. Navigations (a new page, a reload) get the newest version. No
 *   "reload to update" prompt is needed: the update applies to each page the next time it loads.
 * - Old versions' caches are deleted once no open page uses them: on activation and on each navigation. Deleting
 *   caches is never done during install, because until the new worker activates, the earlier one still serves the
 *   open pages from its cache. Nothing is deleted while a newer worker is installing or waiting (it is filling a
 *   cache this worker doesn't know about).
 * - Fetch: GET requests for the site's own files are answered from the cache, offline too; a folder (quire/) is
 *   its index.html. updater/ (the update checks and the zips), sw.js, other sites, other methods and anything not
 *   in the zip go to the network untouched; a navigation to a page not in the zip that the network can't answer
 *   (offline) goes to the Start Center.
 */
'use strict';

importScripts('common/zip.js');   // L.zip, the apps' ZIP engine; a change to it is a change to this worker too

const VERSION = 'dev';   // stamped by tools/web-release.sh
/** the origins this worker caches on: the published site, and 127.0.0.1 (any port) for a published copy served locally */
const cached = (url) => url.origin === 'https://vibeoffice.work' || url.hostname === '127.0.0.1';
const ON = VERSION !== 'dev' && cached(self.location);
const PREFIX = 'vibeoffice-';
const CLIENTS = PREFIX + 'clients';
const SCOPE = new URL(self.registration.scope);
const cacheOf = (version) => PREFIX + version;
const keyOf = (path) => new URL(path, SCOPE).href;
const PATH = /^(?!updater\/)(?!sw\.js$)[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*(\/[A-Za-z0-9_@+-][A-Za-z0-9._@+-]*)*$/;
const MAX_ZIP = 200 * 1024 * 1024;

/** tell every open page of the site, controlled by a worker or not (the first visit's page isn't) */
async function tell(message) {
  for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
    client.postMessage({ type: 'vo-cache', version: VERSION, ...message });
  }
}

/** run fn on every item, n at a time */
async function pool(items, n, fn) {
  let next = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (next < items.length) await fn(items[next++]); }));
}

/* ------------------------------------------------------------ install: the version's zip into its cache */
const UTF8 = 'charset=utf-8';
const TYPES = { html: 'text/html; ' + UTF8, js: 'text/javascript; ' + UTF8, css: 'text/css; ' + UTF8, json: 'application/json',
  webmanifest: 'application/manifest+json', txt: 'text/plain; ' + UTF8, words: 'text/plain; ' + UTF8, thes: 'text/plain; ' + UTF8,
  md: 'text/markdown; ' + UTF8, xml: 'application/xml', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff2: 'font/woff2', woff: 'font/woff', wasm: 'application/wasm' };
const typeOf = (path) => TYPES[(/\.([^./]+)$/.exec(path) || [])[1]] || 'application/octet-stream';

/** the whole zip, telling progress(received, total) as it comes (total 0 if the server didn't say); a short
 *  download fails */
async function download(url, progress) {
  const res = await fetch(url, { cache: 'no-store' });
  if (res.status !== 200) throw new Error(`${url}: HTTP ${res.status}`);
  const total = res.headers.get('Content-Encoding') ? 0 : +res.headers.get('Content-Length') || 0;   // encoded: the size of something else
  if (total > MAX_ZIP) throw new Error(`${url}: too large`);
  const reader = res.body.getReader(), parts = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.length;
    if (received > MAX_ZIP) throw new Error(`${url}: too large`);
    parts.push(value);
    progress(received, total);
  }
  if (total && received !== total) throw new Error(`${url}: ${received} of ${total} bytes`);
  const zip = new Uint8Array(received);
  let at = 0;
  for (const part of parts) { zip.set(part, at); at += part.length; }
  return zip;
}

/** the files of the zip, strictly: read from its central directory (no repairs), names PATH accepts */
async function filesOf(zip, url) {
  const files = await self.L.zip.read(zip);
  if (files.repaired) throw new Error(`${url}: its directory is damaged`);
  const list = [];
  for (const [path, entry] of files) {
    if (path !== entry.name) throw new Error(`${url}: a name with backslashes, ${JSON.stringify(entry.name)}`);
    if (!PATH.test(path)) throw new Error(`${url}: a name the site can't have, ${JSON.stringify(path)}`);
    list.push(entry);
  }
  if (!files.has('index.html')) throw new Error(`${url}: no index.html`);
  return list;
}

/** whether an earlier version is cached: this install or activation is an update, not the first visit */
const earlier = async () => (await caches.keys()).some((n) => n.startsWith(PREFIX + 'v') && n !== cacheOf(VERSION));

async function precache() {
  const update = await earlier();
  const name = cacheOf(VERSION), url = keyOf(`updater/web-${VERSION}.zip`);
  let told = 0, received = 0, total = 0;
  const report = (progress, force) => {   // the download is the first 80 %, the unpacking the rest
    if (!force && Date.now() - told < 100) return;
    told = Date.now();
    tell({ state: 'progress', update, progress, received, total });
  };
  try {
    await caches.delete(name);   // what an install that failed left
    report(0, true);
    const zip = await download(url, (got, size) => { received = got; total = size; report(size ? 0.8 * Math.min(got / size, 1) : 0); });
    total = received;
    report(0.8, true);
    const files = await filesOf(zip, url);
    const cache = await caches.open(name);
    let done = 0;
    await pool(files, 4, async (entry) => {
      const bytes = await entry.bytes();
      if (bytes.length !== entry.usize || self.L.zip.crc32(bytes) !== entry.crc) throw new Error(`${entry.name}: damaged in the zip (size or CRC-32)`);
      await cache.put(keyOf(entry.name), new Response(bytes, { headers: { 'Content-Type': typeOf(entry.name) } }));
      report(0.8 + 0.2 * (++done / files.length));
    });
    report(1, true);
  } catch (e) {
    await caches.delete(name);
    await tell({ state: 'failed', update, error: String(e.message || e) });
    throw e;
  }
}

self.addEventListener('install', (event) => {
  if (!ON) { self.skipWaiting(); return; }
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

/* ------------------------------------------------------------ which version each page uses */
const known = new Map();   // client id → version, while this worker runs; the cache CLIENTS keeps it across restarts
const clientKey = (id) => keyOf('__clients__/' + encodeURIComponent(id));

async function remember(id, version) {
  known.set(id, version);
  await (await caches.open(CLIENTS)).put(clientKey(id), new Response(version));
}

/** the version a page was loaded with; a page not seen before (loaded from the network, before this worker
 *  controlled it) gets the newest, from now on */
async function versionOf(id) {
  if (known.has(id)) return known.get(id);
  const saved = await caches.match(clientKey(id), { cacheName: CLIENTS });
  if (saved) { const version = await saved.text(); known.set(id, version); return version; }
  await remember(id, VERSION);
  return VERSION;
}

/** forget pages that are gone, then delete every cache no open page's version needs */
async function prune() {
  const open = new Set((await self.clients.matchAll({ type: 'all', includeUncontrolled: true })).map((c) => c.id));
  const map = await caches.open(CLIENTS);
  const used = new Set([cacheOf(VERSION), CLIENTS]);
  for (const request of await map.keys()) {
    const id = decodeURIComponent(new URL(request.url).pathname.split('/').pop());
    const saved = open.has(id) && (await map.match(request));
    if (saved) used.add(cacheOf(await saved.text()));
    else { known.delete(id); await map.delete(request); }
  }
  if (self.registration.installing || self.registration.waiting) return;   // a newer worker is filling its cache
  for (const name of await caches.keys()) if (!used.has(name)) await caches.delete(name);
}

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    if (!ON) {
      for (const name of await caches.keys()) await caches.delete(name);
      await self.clients.claim();
      return;
    }
    const update = await earlier();   // before prune deletes the earlier version's cache
    await self.clients.claim();
    await tell({ state: 'done', update, progress: 1 });
    await prune();
  })());
});

/* ------------------------------------------------------------ answering requests */
/** a file of the site from a version's cache: a folder is its index.html; for a navigation, a folder without
 *  its slash (quire) is sent to it (quire/), and a page without .html is found with it */
async function lookup(version, path, navigate, search) {
  const cacheName = cacheOf(version);
  const file = path === '' || path.endsWith('/') ? path + 'index.html' : path;
  const hit = await caches.match(keyOf(file), { cacheName });
  if (hit || !navigate || /\.[^/]*$/.test(path)) return hit;
  if (await caches.match(keyOf(path + '/index.html'), { cacheName })) return Response.redirect(keyOf(path + '/') + search, 301);
  return caches.match(keyOf(path + '.html'), { cacheName });
}

async function answer(event, path, search) {
  const navigate = event.request.mode === 'navigate';
  let version = VERSION;
  if (navigate) {
    if (event.resultingClientId) event.waitUntil(remember(event.resultingClientId, VERSION));
    event.waitUntil(prune());
  } else if (event.clientId) {
    version = await versionOf(event.clientId);
  }
  try {
    const hit = (await lookup(version, path, navigate, search))
      || (version !== VERSION ? await lookup(VERSION, path, navigate, search) : null);   // not in the page's version (or its cache was evicted): the newest, as the server would answer
    if (hit) return hit;
  } catch (e) {
    console.warn('sw:', e);
  }
  if (!navigate) return fetch(event.request);
  try { return await fetch(event.request); } catch (e) { return Response.redirect(SCOPE.href, 302); }   // offline: the Start Center
}

self.addEventListener('fetch', (event) => {
  if (!ON || event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== SCOPE.origin || !url.pathname.startsWith(SCOPE.pathname)) return;
  let path;
  try { path = decodeURIComponent(url.pathname.slice(SCOPE.pathname.length)); } catch (e) { return; }
  if (path === 'sw.js' || path.startsWith('updater/') || path.startsWith('__clients__/')) return;
  event.respondWith(answer(event, path, url.search));
});
