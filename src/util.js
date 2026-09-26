import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

export const now = () => new Date().toISOString();
export const newRunId = () => `run-${randomUUID()}`;
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
export const stableJson = (value) => JSON.stringify(sortObject(value));

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortObject(value[key])]));
}

export async function atomicJson(pathname, value) {
  await mkdir(path.dirname(pathname), { recursive: true });
  const tmp = `${pathname}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(tmp, pathname);
}

export async function readJson(pathname) {
  return JSON.parse(await readFile(pathname, 'utf8'));
}

export async function fileSha256(pathname) {
  return sha256(await readFile(pathname));
}

export async function exists(pathname) {
  try { await stat(pathname); return true; } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

export function sanitizeEnv(extra = {}) {
  const keep = ['PATH', 'SystemRoot', 'WINDIR', 'TMP', 'TEMP', 'LANG', 'LC_ALL'];
  const clean = Object.fromEntries(keep.filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  return { ...clean, CI: '1', NO_COLOR: '1', ...extra };
}
