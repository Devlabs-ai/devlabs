'use strict';

/**
 * Editor files for Kubernetes labs. They live in the learner's lab home — the
 * terminal's working directory — so `kubectl apply -f <path>` works as soon as a
 * file is saved. Paths are relative to that home; dot entries (and the
 * backend-managed .devlabs dir) are hidden and unreachable.
 *
 * The learner controls this tree from the shell, so every path segment must be
 * a real directory (never a symlink), files are opened with O_NOFOLLOW, and the
 * resolved folder must still sit inside the home. Otherwise `ln -s /etc x` would
 * let the API read or clobber files outside it.
 */

const fs = require('fs');
const path = require('path');
const k8sCluster = require('./k8sCluster');
const labShell = require('./labShell');

const MAX_FILE_BYTES = 256 * 1024;
const MAX_ENTRIES_PER_DIR = 200;
const MAX_FOLDERS_LISTED = 300;
const MAX_DEPTH = 6;
const SEGMENT_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$/;

interface LabFileEntry {
  name: string;
  path: string;
  size: number;
  updatedAt: number;
}

class LabFileError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function splitRel(raw: unknown, allowEmpty: boolean): string[] {
  if (raw == null || raw === '') {
    if (allowEmpty) return [];
    throw new LabFileError(400, 'path is required');
  }
  if (typeof raw !== 'string') throw new LabFileError(400, 'path must be a string');
  const trimmed = raw.trim().replace(/^~(\/|$)/, '').replace(/^\/+|\/+$/g, '');
  if (!trimmed) {
    if (allowEmpty) return [];
    throw new LabFileError(400, 'path is required');
  }
  const parts = trimmed.split('/').filter(Boolean);
  if (parts.length > MAX_DEPTH) throw new LabFileError(400, `Paths can be at most ${MAX_DEPTH} levels deep`);
  for (const seg of parts) {
    if (!SEGMENT_RE.test(seg)) {
      throw new LabFileError(
        400,
        `"${seg}" is not allowed — use letters, digits, ".", "_" and "-" (no leading dot).`,
      );
    }
  }
  return parts;
}

function lstatOrNull(p: string): import('fs').Stats | null {
  try {
    return fs.lstatSync(p);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
}

function assertInsideHome(home: string, target: string): void {
  const realHome = fs.realpathSync(home);
  const real = fs.realpathSync(target);
  if (real !== realHome && !real.startsWith(realHome + path.sep)) {
    throw new LabFileError(409, 'Path escapes your lab home');
  }
}

/** Walk folder segments from the home, refusing symlinks; optionally mkdir missing ones. */
function resolveDir(home: string, parts: string[], create: boolean): string {
  let cur = home;
  for (let i = 0; i < parts.length; i += 1) {
    const next = path.join(cur, parts[i]);
    const st = lstatOrNull(next);
    if (!st) {
      if (!create) throw new LabFileError(404, `Folder ~/${parts.slice(0, i + 1).join('/')} not found`);
      fs.mkdirSync(next, { mode: 0o755 });
      labShell.giveToLearner(next);
    } else if (!st.isDirectory()) {
      throw new LabFileError(409, `~/${parts.slice(0, i + 1).join('/')} is not a folder`);
    }
    cur = next;
  }
  assertInsideHome(home, cur);
  return cur;
}

function resolveFile(
  home: string,
  rawPath: unknown,
  createDirs: boolean,
): { abs: string; rel: string; name: string } {
  const parts = splitRel(rawPath, false);
  const name = parts.pop() as string;
  const dirAbs = resolveDir(home, parts, createDirs);
  return { abs: path.join(dirAbs, name), rel: [...parts, name].join('/'), name };
}

function entryFor(abs: string, rel: string, name: string): LabFileEntry {
  const st = fs.lstatSync(abs);
  return { name, path: rel, size: st.size, updatedAt: st.mtimeMs };
}

function assertRegularFile(abs: string, rel: string): import('fs').Stats {
  const st = lstatOrNull(abs);
  if (!st) throw new LabFileError(404, `~/${rel} not found`);
  if (!st.isFile()) throw new LabFileError(409, `~/${rel} is not a regular file`);
  return st;
}

function homeFor(ns: string): string {
  return k8sCluster.resolveLearnerHome(ns);
}

function listDir(ns: string, rawDir: unknown): { dir: string; folders: string[]; files: LabFileEntry[] } {
  const home = homeFor(ns);
  const parts = splitRel(rawDir, true);
  const dirAbs = resolveDir(home, parts, false);
  const dir = parts.join('/');
  const folders: string[] = [];
  const files: LabFileEntry[] = [];
  for (const name of fs.readdirSync(dirAbs)) {
    if (!SEGMENT_RE.test(name)) continue;
    const st = lstatOrNull(path.join(dirAbs, name));
    if (!st) continue;
    if (st.isDirectory()) folders.push(name);
    else if (st.isFile()) {
      files.push({ name, path: dir ? `${dir}/${name}` : name, size: st.size, updatedAt: st.mtimeMs });
    }
    if (folders.length + files.length >= MAX_ENTRIES_PER_DIR) break;
  }
  folders.sort((a, b) => a.localeCompare(b));
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dir, folders, files };
}

/** Every visible folder under the home (breadth-first), for the path picker. */
function listAllFolders(ns: string): string[] {
  const home = homeFor(ns);
  const out: string[] = [];
  const queue: Array<{ abs: string; rel: string; depth: number }> = [{ abs: home, rel: '', depth: 0 }];
  while (queue.length > 0 && out.length < MAX_FOLDERS_LISTED) {
    const { abs, rel, depth } = queue.shift()!;
    let names: string[];
    try {
      names = fs.readdirSync(abs).sort((a: string, b: string) => a.localeCompare(b));
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SEGMENT_RE.test(name)) continue;
      const childAbs = path.join(abs, name);
      const st = lstatOrNull(childAbs);
      if (!st || !st.isDirectory()) continue;
      const childRel = rel ? `${rel}/${name}` : name;
      out.push(childRel);
      if (out.length >= MAX_FOLDERS_LISTED) break;
      if (depth + 1 < MAX_DEPTH) queue.push({ abs: childAbs, rel: childRel, depth: depth + 1 });
    }
  }
  return out;
}

function createFolder(ns: string, rawDir: unknown): string {
  const parts = splitRel(rawDir, false);
  resolveDir(homeFor(ns), parts, true);
  return parts.join('/');
}

function readFile(ns: string, rawPath: unknown): { path: string; content: string } {
  const { abs, rel } = resolveFile(homeFor(ns), rawPath, false);
  const st = assertRegularFile(abs, rel);
  if (st.size > MAX_FILE_BYTES) throw new LabFileError(413, `~/${rel} is too large to open in the editor`);
  const fd = fs.openSync(abs, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    return { path: rel, content: fs.readFileSync(fd, 'utf8') };
  } finally {
    fs.closeSync(fd);
  }
}

function writeFile(ns: string, rawPath: unknown, content: unknown): LabFileEntry {
  if (typeof content !== 'string') throw new LabFileError(400, 'content must be a string');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw new LabFileError(413, 'File is too large (256 KB max)');
  }
  const { abs, rel, name } = resolveFile(homeFor(ns), rawPath, true);
  const existing = lstatOrNull(abs);
  if (existing && !existing.isFile()) throw new LabFileError(409, `~/${rel} is not a regular file`);
  if (!existing && fs.readdirSync(path.dirname(abs)).length >= MAX_ENTRIES_PER_DIR) {
    throw new LabFileError(409, `Too many entries in this folder (${MAX_ENTRIES_PER_DIR} max)`);
  }
  const fd = fs.openSync(
    abs,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_NOFOLLOW,
    0o644,
  );
  try {
    fs.writeFileSync(fd, content, 'utf8');
  } finally {
    fs.closeSync(fd);
  }
  if (!existing) labShell.giveToLearner(abs);
  return entryFor(abs, rel, name);
}

/** Rename or move a file or folder within the home. */
function renameEntry(ns: string, rawFrom: unknown, rawTo: unknown): { path: string; kind: 'file' | 'folder' } {
  const home = homeFor(ns);
  const src = resolveFile(home, rawFrom, false);
  const st = lstatOrNull(src.abs);
  if (!st) throw new LabFileError(404, `~/${src.rel} not found`);
  if (!st.isFile() && !st.isDirectory()) throw new LabFileError(409, `~/${src.rel} cannot be renamed`);
  const kind = st.isDirectory() ? 'folder' : 'file';
  const toRel = splitRel(rawTo, false).join('/');
  if (toRel === src.rel) return { path: src.rel, kind };
  if (kind === 'folder' && toRel.startsWith(`${src.rel}/`)) {
    throw new LabFileError(400, 'A folder cannot be moved inside itself');
  }
  const dst = resolveFile(home, toRel, true);
  if (lstatOrNull(dst.abs)) throw new LabFileError(409, `~/${dst.rel} already exists`);
  fs.renameSync(src.abs, dst.abs);
  return { path: dst.rel, kind };
}

function deleteFile(ns: string, rawPath: unknown): void {
  const { abs, rel } = resolveFile(homeFor(ns), rawPath, false);
  assertRegularFile(abs, rel);
  fs.unlinkSync(abs);
}

/** Recursive; rmSync removes symlinks inside the tree without following them. */
function deleteFolder(ns: string, rawDir: unknown): void {
  const parts = splitRel(rawDir, false);
  const abs = resolveDir(homeFor(ns), parts, false);
  fs.rmSync(abs, { recursive: true, force: false });
}

module.exports = {
  LabFileError,
  listDir,
  listAllFolders,
  createFolder,
  readFile,
  writeFile,
  renameEntry,
  deleteFile,
  deleteFolder,
};
