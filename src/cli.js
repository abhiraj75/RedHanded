#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { createApp } from './app.js';

const [command, ...rest] = process.argv.slice(2);
const options = parse(rest);
const app = createApp();

try {
  let result;
  if (command === 'start') result = await app.startRun({
    issue: options.issue && (/^\d+$/.test(options.issue) ? Number(options.issue) : options.issue),
    rawReport: options.report ? JSON.parse(await readFile(options.report, 'utf8')) : undefined,
    evidenceMode: options.evidence || process.env.REDHANDED_EVIDENCE_MODE || 'tests-only', trueforgeSessionId: options.session
  });
  else if (command === 'reproduce') result = await app.submitReproduction(required(options.run, '--run'), JSON.parse(await readFile(required(options.file, '--file'), 'utf8')));
  else if (command === 'patch') result = await app.submitPatch(required(options.run, '--run'), await readFile(required(options.file, '--file'), 'utf8'));
  else if (command === 'verify') result = await app.verifyRun(required(options.run, '--run'));
  else if (command === 'publish') result = await app.publishVerifiedPr(required(options.run, '--run'));
  else if (command === 'get') result = await app.getRun(required(options.run, '--run'));
  else usage();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ error: error.code || 'ERROR', message: error.message, details: error.details || {} }, null, 2)}\n`);
  process.exitCode = 1;
}

function parse(args) { const out = {}; for (let i = 0; i < args.length; i += 2) out[args[i].replace(/^--/, '')] = args[i + 1]; return out; }
function required(value, flag) { if (!value) throw new Error(`${flag} is required`); return value; }
function usage() { throw new Error('usage: redhanded <start|reproduce|patch|verify|publish|get> [options]'); }
