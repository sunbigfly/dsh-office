import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { MAX_BYTES, ownerFiles } from './files.js';

export const name = 'office';
export const inject = ['connection', 'webServer', 'sessions', 'sessionPersistence'];
const root = dirname(fileURLToPath(import.meta.url));
const assetVersion = createRequire(import.meta.url)('./package.json').version;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8' };
const prefix = '/dsh-office/';
const responseHeaders = { 'cache-control': 'no-store, private', 'x-content-type-options': 'nosniff' };

/** Only immutable public editor assets are served here, never workspace files,
 * session data, credentials, config, node_modules, or a filesystem proxy. */
export async function assetResponse(request) {
  const url = new URL(request.url), raw = url.pathname;
  if (!['GET', 'HEAD'].includes(request.method)) return new Response(null, { status: 405 });
  if (!raw.startsWith(prefix) || /%|\\|\/\//.test(raw) || raw.split('/').some(part => part === '.' || part === '..')) return new Response(null, { status: 404 });
  const key = raw.slice(prefix.length), embedded = key.startsWith('embed/');
  if (!embedded && !key.startsWith('vendor/')) return new Response(null, { status: 404 });
  if (embedded && !['embed/bootstrap.js', 'embed/bridge.js', 'embed/menu-layout.js', 'embed/editor.css'].includes(key)) return new Response(null, { status: 404 });
  const file = resolve(root, key);
  if (!file.startsWith(root + sep)) return new Response(null, { status: 404 });
  try {
    const info = await stat(file); if (!info.isFile()) return new Response(null, { status: 404 });
    let body = await readFile(file);
    const headers = { 'content-type': MIME[extname(file)] ?? 'application/octet-stream', 'x-content-type-options': 'nosniff', 'access-control-allow-origin': '*', 'cross-origin-resource-policy': 'cross-origin', 'referrer-policy': 'no-referrer', 'cache-control': 'public, max-age=3600' };
    if (extname(file) === '.html') {
      // The editor has an opaque sandbox origin. CSP permits only our static
      // vendor path, so document links cannot reach DSH APIs or the Internet.
      const base = url.origin + prefix;
      const csp = `default-src 'none'; script-src ${base}; style-src ${base} 'unsafe-inline'; img-src ${base} data: blob:; font-src ${base} data:; connect-src ${base} data: blob:; worker-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
      let html = body.toString().replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/i, '');
      // Ledger and Lectern omit optional head/body tags. Normalize their
      // editor shell before adding the same bootstrap and styles as Quire.
      if (!/<head(?:\s|>)/i.test(html)) html = html.replace(/(<html\b[^>]*>)/i, '$1<head>');
      if (!/<\/head>/i.test(html) && /<div id="app"/.test(html)) html = html.replace('<div id="app"', '</head><body><div id="app"');
      html = html.replace('<head>', `<head><script src="${prefix}embed/bootstrap.js?v=${assetVersion}"></script>`);
      html = html.replace('</head>', `<link rel="stylesheet" href="rdf-theme.css"><link rel="stylesheet" href="${prefix}embed/editor.css?v=${assetVersion}"></head>`);
      html = html.replace(/(<script src="\.\.\/common\/suite\.js"><\/script>)/, `$1<script src="${prefix}embed/menu-layout.js?v=${assetVersion}"></script><script src="${prefix}embed/bridge.js?v=${assetVersion}"></script>`);
      html = html.replace('<script src="js/app.js">', '<script src="../common/office-fonts.js"></script><script src="js/app.js">');
      // A package update must also refresh previously cached editor scripts.
      html = html.replace(/(src|href)="([^"?]+\.(?:js|css))"/g, (_all, attr, path) => `${attr}="${path}?v=${assetVersion}"`);
      body = Buffer.from(html);
      headers['content-security-policy'] = csp;
      headers['cache-control'] = 'no-store';
    }
    return new Response(request.method === 'HEAD' ? null : body, { headers });
  } catch { return new Response(null, { status: 404 }); }
}

export function apply(ctx) {
  const files = ownerFiles({ session: async id => ctx.sessions.get(id)?.header ?? (await ctx.sessionPersistence.stat(id))?.header });
  ctx.effect(() => ctx.connection.fetch.register({ path: '/api/dsh-office', methods: ['POST'], requestBody: 'streaming', async fetch(request) {
    try {
      let size = 0; const chunks = [];
      for await (const bytes of request.body ?? []) { size += bytes.length; if (size > Math.ceil(MAX_BYTES / 3) * 4 + 4096) return Response.json({ error: '文件超过编辑上限。' }, { status: 413, headers: responseHeaders }); chunks.push(bytes); }
      const result = await files(JSON.parse(Buffer.concat(chunks).toString()));
      return Response.json({ result }, { headers: responseHeaders });
    } catch (error) { return Response.json({ error: error.status ? error.message : '文件操作失败，请刷新后重试。' }, { status: error.status ?? 400, headers: responseHeaders }); }
  } }));
  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/dsh-office', async handler(req, res) {
    const host = req.headers.host;
    if (typeof host !== 'string' || !/^[A-Za-z0-9.\[\]:-]+$/.test(host)) { res.writeHead(400); res.end(); return; }
    const origin = new URL(ctx.webServer.getOrigin()).protocol + '//' + host;
    const response = await assetResponse(new Request(new URL(req.url, origin), { method: req.method }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(response.body ? Buffer.from(await response.arrayBuffer()) : undefined);
  } }));
}
