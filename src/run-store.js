import path from 'node:path';
import { mkdir, open, rm, readdir } from 'node:fs/promises';
import { STATES, TRANSITIONS, TERMINAL_STATES } from './constants.js';
import { RedHandedError, invariant } from './errors.js';
import { atomicJson, exists, newRunId, now, readJson } from './util.js';

export class RunStore {
  constructor(root) { this.root = path.resolve(root); }
  runDir(id) { return path.join(this.root, 'runs', id); }
  runPath(id) { return path.join(this.runDir(id), 'run.json'); }
  artifactPath(id, name) { return path.join(this.runDir(id), 'artifacts', name); }

  async create(input) {
    const id = newRunId();
    const timestamp = now();
    const run = {
      schemaVersion: 1, id, state: STATES.RECEIVED, attemptCount: 0,
      createdAt: timestamp, updatedAt: timestamp, history: [{ state: STATES.RECEIVED, at: timestamp }],
      ...input
    };
    await atomicJson(this.runPath(id), run);
    return run;
  }

  async get(id) {
    invariant(typeof id === 'string' && /^run-[a-f0-9-]{36}$/.test(id), 'INVALID_RUN_ID', 'Invalid run identifier');
    invariant(await exists(this.runPath(id)), 'RUN_NOT_FOUND', `Unknown run ${id}`);
    return readJson(this.runPath(id));
  }

  async save(run) {
    run.updatedAt = now();
    await atomicJson(this.runPath(run.id), run);
    return run;
  }

  async transition(run, next, detail = {}) {
    invariant((TRANSITIONS[run.state] || []).includes(next), 'INVALID_TRANSITION', `${run.state} cannot transition to ${next}`);
    run.state = next;
    Object.assign(run, detail);
    run.history.push({ state: next, at: now() });
    return this.save(run);
  }

  async activeFor(repository) {
    const runsRoot = path.join(this.root, 'runs');
    if (!await exists(runsRoot)) return null;
    for (const id of await readdir(runsRoot)) {
      if (!/^run-/.test(id) || !await exists(this.runPath(id))) continue;
      const run = await readJson(this.runPath(id));
      if (run.repository === repository && !TERMINAL_STATES.has(run.state)) return run;
    }
    return null;
  }

  async lockRepository(repository, fn) {
    await mkdir(path.join(this.root, 'locks'), { recursive: true });
    const lockPath = path.join(this.root, 'locks', `${repository.replaceAll('/', '__')}.lock`);
    let handle;
    try { handle = await open(lockPath, 'wx'); }
    catch (error) {
      if (error.code === 'EEXIST') throw new RedHandedError('REPOSITORY_BUSY', `A repair is already active for ${repository}`);
      throw error;
    }
    try { return await fn(); }
    finally { await handle.close(); await rm(lockPath, { force: true }); }
  }
}
