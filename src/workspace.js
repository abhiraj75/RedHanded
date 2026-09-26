import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mustRun, run } from './process.js';
import { RedHandedError, invariant } from './errors.js';

export class GitWorkspace {
  constructor({ repositoryUrl = (repo) => `https://github.com/${repo}.git` } = {}) { this.repositoryUrl = repositoryUrl; }

  async create(repository, baseCommit) {
    const root = await mkdtemp(path.join(os.tmpdir(), 'redhanded-verify-'));
    try {
      await mustRun('git', ['clone', '--quiet', '--no-checkout', '--filter=blob:none', this.repositoryUrl(repository), root]);
      await mustRun('git', ['config', '--local', 'core.autocrlf', 'false'], { cwd: root });
      await mustRun('git', ['config', '--local', 'core.hooksPath', 'NUL'], { cwd: root });
      await mustRun('git', ['checkout', '--quiet', '--detach', baseCommit], { cwd: root });
      return root;
    } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  }

  async applyCandidate(root, patch, reproduction) {
    invariant(Buffer.byteLength(patch) <= 131072, 'PATCH_TOO_LARGE', 'Patch exceeds 128 KiB');
    const result = await run('git', ['apply', '--index', '--whitespace=nowarn', '--'], { cwd: root, input: patch });
    if (result.code !== 0) throw new RedHandedError('INVALID_PATCH', 'Candidate patch could not be applied', { stderr: result.stderr });
    const reproPath = path.join(root, ...reproduction.path.split('/'));
    await writeFile(reproPath, reproduction.bytes, { flag: 'wx' });
    await mustRun('git', ['add', '--', reproduction.path], { cwd: root });
    return this.inspect(root);
  }

  async inspect(root) {
    const raw = await mustRun('git', ['diff', '--cached', '--raw', '--no-abbrev', '-z'], { cwd: root });
    const entries = raw.split('\0').filter(Boolean);
    const changes = [];
    for (let i = 0; i < entries.length; i += 2) {
      const meta = entries[i]; const pathname = entries[i + 1];
      const match = meta.match(/^:(\d{6}) (\d{6}) ([0-9a-f]+) ([0-9a-f]+) ([A-Z])(\d*)$/);
      invariant(match && pathname, 'TREE_INSPECTION_FAILED', 'Could not parse candidate tree');
      const binaryProbe = await run('git', ['diff', '--cached', '--numstat', '--', pathname], { cwd: root });
      changes.push({ path: pathname, oldMode: match[1], newMode: match[2], status: match[5], binary: /^-\s+-\s+/.test(binaryProbe.stdout) });
    }
    const status = await mustRun('git', ['status', '--porcelain=v1', '--untracked-files=all'], { cwd: root });
    invariant(status.split(/\r?\n/).filter(Boolean).length === changes.length, 'UNTRACKED_CHANGE', 'Candidate contains changes outside the indexed tree');
    const numstat = await mustRun('git', ['diff', '--cached', '--numstat'], { cwd: root });
    const changedLines = numstat.split(/\r?\n/).filter(Boolean).reduce((sum, line) => {
      const [add, del] = line.split(/\s+/); return sum + Number(add || 0) + Number(del || 0);
    }, 0);
    const tree = await mustRun('git', ['write-tree'], { cwd: root });
    return { changes, changedLines, tree };
  }

  read(root, pathname) { return readFile(path.join(root, ...pathname.split('/')), 'utf8'); }
  cleanup(root) { return rm(root, { recursive: true, force: true }); }
}
