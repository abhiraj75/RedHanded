import { spawn } from 'node:child_process';
import path from 'node:path';
import { RedHandedError } from './errors.js';
import { sanitizeEnv } from './util.js';

function collect(child, timeoutMs, maxBytes) {
  return new Promise((resolve, reject) => {
    let stdout = Buffer.alloc(0); let stderr = Buffer.alloc(0); let timedOut = false; let overflow = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const add = (key) => (chunk) => {
      if (stdout.length + stderr.length + chunk.length > maxBytes) { overflow = true; child.kill('SIGKILL'); return; }
      if (key === 'stdout') stdout = Buffer.concat([stdout, chunk]); else stderr = Buffer.concat([stderr, chunk]);
    };
    child.stdout.on('data', add('stdout')); child.stderr.on('data', add('stderr'));
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (exitCode, signal) => {
      clearTimeout(timer);
      resolve({ exitCode, signal, timedOut, overflow, stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') });
    });
  });
}

export class LocalFixtureExecutor {
  constructor({ timeoutMs = 120000, maxOutputBytes = 262144 } = {}) { Object.assign(this, { timeoutMs, maxOutputBytes }); }
  async run(workspace, command, args) {
    let executable = command; let commandArgs = args;
    if (process.platform === 'win32' && command === 'npm') {
      executable = process.execPath;
      const npmCli = process.env.npm_execpath || path.resolve(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
      commandArgs = [npmCli, ...args];
    }
    const child = spawn(executable, commandArgs, { cwd: workspace, env: sanitizeEnv(), shell: false, windowsHide: true });
    return collect(child, this.timeoutMs, this.maxOutputBytes);
  }
}

export class DockerExecutor {
  constructor({ image = 'node:22.12.0-alpine', timeoutMs = 120000, maxOutputBytes = 262144 } = {}) {
    Object.assign(this, { image, timeoutMs, maxOutputBytes });
  }
  async run(workspace, command, args) {
    const mount = `${path.resolve(workspace)}:/workspace:ro`;
    const dockerArgs = ['run', '--rm', '--network', 'none', '--read-only', '--tmpfs', '/tmp:rw,noexec,nosuid,size=64m',
      '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges', '--memory', '256m', '--cpus', '0.5',
      '-v', mount, '-w', '/workspace', this.image, command, ...args];
    try {
      const child = spawn('docker', dockerArgs, { env: sanitizeEnv(), shell: false, windowsHide: true });
      return await collect(child, this.timeoutMs, this.maxOutputBytes);
    } catch (error) {
      throw new RedHandedError('SANDBOX_UNAVAILABLE', 'Docker verifier is unavailable', { cause: error.message });
    }
  }
}

export function createExecutor(env = process.env) {
  if (env.REDHANDED_VERIFIER_BACKEND === 'local-fixture') return new LocalFixtureExecutor();
  return new DockerExecutor({
    image: env.REDHANDED_DOCKER_IMAGE,
    timeoutMs: Number(env.REDHANDED_TIMEOUT_MS || 120000),
    maxOutputBytes: Number(env.REDHANDED_MAX_OUTPUT_BYTES || 262144)
  });
}
