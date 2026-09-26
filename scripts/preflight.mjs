import { access, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const checks = [];
const command = (name, args = ['--version']) => { const result = spawnSync(name, args, { encoding: 'utf8', windowsHide: true }); checks.push({ name, ok: result.status === 0, detail: (result.stdout || result.stderr || '').trim() }); };
command('node'); command('git');
if ((process.env.REDHANDED_VERIFIER_BACKEND || 'docker') === 'docker') command('docker');
const state = path.resolve(process.env.REDHANDED_STATE_DIR || '.redhanded');
try { await mkdir(state, { recursive: true }); await access(state); checks.push({ name: 'state directory', ok: true, detail: state }); } catch (error) { checks.push({ name: 'state directory', ok: false, detail: error.message }); }
checks.push({ name: 'GitHub token', ok: Boolean(process.env.GITHUB_TOKEN), detail: process.env.GITHUB_TOKEN ? 'configured' : 'missing' });
checks.push({ name: 'TrueForge URL', ok: Boolean(process.env.TRUEFORGE_BASE_URL), detail: process.env.TRUEFORGE_BASE_URL || 'missing' });
console.log(JSON.stringify(checks, null, 2));
if (checks.some((check) => !check.ok)) process.exitCode = 1;
