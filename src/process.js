import { spawn } from 'node:child_process';
import { RedHandedError } from './errors.js';
import { sanitizeEnv } from './util.js';

export function run(command, args, { cwd, input, timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: sanitizeEnv(), shell: false, windowsHide: true });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; }); child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code, signal) => { clearTimeout(timer); resolve({ code, signal, stdout, stderr }); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}

export async function mustRun(command, args, options) {
  const result = await run(command, args, options);
  if (result.code !== 0) throw new RedHandedError('COMMAND_FAILED', `${command} ${args[0] || ''} failed`, result);
  return result.stdout.trim();
}
