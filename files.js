import { constants } from 'node:fs';
import { open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';

export const MAX_BYTES = 32 * 1024 * 1024;
export const TYPES = Object.freeze({ docx: 'quire', xlsx: 'ledger', pptx: 'lectern' });
export function officeType(path) { return TYPES[/\.([^.\/\\]+)$/.exec(path)?.[1]?.toLowerCase()] ?? null; }
export const hash = data => createHash('sha256').update(data).digest('hex');
export function denied(message, status = 400) { throw Object.assign(new Error(message), { status }); }
const inside = (root, path) => { const r = relative(root, path); return r !== '' && !isAbsolute(r) && r !== '..' && !r.startsWith('..' + sep); };

/** Only the native owner connection can reach this adapter. LAN members use
 * the multi-user plugin's existing authenticated, descriptor-safe content API. */
export function ownerFiles({ session, maxBytes = MAX_BYTES }) {
  const locks = new Set();
  async function locate(request) {
    if (!request || !['read', 'write'].includes(request.action) || typeof request.sessionId !== 'string' || request.sessionId.length > 160 || typeof request.path !== 'string' || request.path.includes('\0') || !officeType(request.path)) denied('文件参数无效。');
    const header = await session(request.sessionId);
    if (typeof header?.cwd !== 'string') denied('会话工作目录不可用。', 404);
    const root = await realpath(header.cwd), target = resolve(root, request.path);
    if (!inside(root, target)) denied('文件不在此会话工作目录内。', 403);
    const parent = await realpath(dirname(target));
    if (parent !== root && !inside(root, parent)) denied('文件目录超出工作区。', 403);
    const path = resolve(parent, basename(target));
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await file.stat();
      if (!stat.isFile()) denied('仅支持普通文件。');
      if (stat.size > maxBytes) denied('文件超过 32 MB 编辑上限。', 413);
      const data = await file.readFile();
      if (data.length > maxBytes) denied('文件超过编辑上限。', 413);
      const after = await file.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || after.ctimeMs !== stat.ctimeMs) denied('文件正在更新，请重新打开。', 409);
      return { path, parent, data, revision: hash(data), stat };
    } finally { await file.close(); }
  }
  return async request => {
    const current = await locate(request);
    if (request.action === 'read') return { path: current.path, revision: current.revision, data: current.data.toString('base64'), size: current.data.length };
    if (Object.keys(request).some(key => !['action', 'sessionId', 'path', 'revision', 'data'].includes(key)) || !/^[a-f0-9]{64}$/.test(request.revision ?? '') || typeof request.data !== 'string' || request.data.length > Math.ceil(maxBytes / 3) * 4) denied('保存参数无效。');
    const data = Buffer.from(request.data, 'base64');
    if (data.length > maxBytes || data.toString('base64') !== request.data) denied('文件内容无效。');
    if (locks.has(current.path)) denied('此文件正在保存，请稍后重试。', 409);
    locks.add(current.path);
    let temporary;
    try {
      // A second read after taking the lock prevents two stale editors from
      // overwriting each other. A conflict always preserves the editor draft.
      const fresh = await locate(request);
      if (fresh.revision !== request.revision) denied('文件已被其他操作更新，请重新打开后再保存。', 409);
      temporary = resolve(fresh.parent, '.dsh-office-' + randomUUID());
      const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, fresh.stat.mode & 0o777);
      try { await file.writeFile(data); await file.sync(); } finally { await file.close(); }
      const final = await locate(request);
      if (final.revision !== request.revision || final.stat.ino !== fresh.stat.ino || final.stat.dev !== fresh.stat.dev) denied('文件在保存期间发生变化，请重新打开。', 409);
      await rename(temporary, fresh.path); temporary = undefined;
      return { saved: true, revision: hash(data) };
    } finally { if (temporary) await unlink(temporary).catch(() => {}); locks.delete(current.path); }
  };
}
