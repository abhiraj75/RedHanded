import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { mustRun } from '../src/process.js';
import { RunStore } from '../src/run-store.js';
import { GitWorkspace } from '../src/workspace.js';
import { LocalFixtureExecutor } from '../src/executor.js';
import { Verifier } from '../src/verifier.js';
import { Publisher } from '../src/publisher.js';
import { RedHandedGuard } from '../src/guard.js';
import { DEFAULT_POLICY, STATES } from '../src/constants.js';
import { normalizeIssueReference, validateIssue, validateReport, validateReproduction, validateChangedPaths, parseTestSummary } from '../src/policy.js';
import { publicRunEvent } from '../src/events.js';
import { sha256 } from '../src/util.js';

const brokenCart = `export const COUPONS = { SAVE10: 0.10 };\nexport function subtotal(items) { return items.reduce((sum, item) => sum + item.price * item.qty, 0); }\nexport function total(items, code) { const amount = subtotal(items); const rate = COUPONS[code]; return rate ? amount * rate : amount; }\n`;
const fixedCart = brokenCart.replace('amount * rate', 'amount * (1 - rate)');
const contract = { kind: 'module-export-call', module: 'src/cart.js', export: 'total', args: [[{ name: 'A', price: 1200, qty: 1 }, { name: 'B', price: 800, qty: 1 }], 'SAVE10'], expected: 1800 };

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'redhanded-fixture-'));
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'tests')); await mkdir(path.join(root, 'repro'));
  await writeFile(path.join(root, 'src', 'cart.js'), brokenCart);
  await writeFile(path.join(root, 'tests', 'cart.test.js'), `import { test } from 'node:test'; import assert from 'node:assert/strict'; import { total } from '../src/cart.js'; test('no coupon', () => assert.equal(total([{price: 5, qty: 2}]), 10));\n`);
  await writeFile(path.join(root, 'package.json'), '{"type":"module","scripts":{"test":"node --test tests"}}\n');
  await writeFile(path.join(root, 'repro', 'README.md'), 'frozen checks\n');
  await mustRun('git', ['init', '--quiet', '-b', 'main'], { cwd: root });
  await mustRun('git', ['config', 'user.email', 'fixture@example.com'], { cwd: root });
  await mustRun('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await mustRun('git', ['add', 'src/cart.js', 'tests/cart.test.js', 'package.json', 'repro/README.md'], { cwd: root });
  await mustRun('git', ['commit', '--quiet', '-m', 'fixture'], { cwd: root });
  const sha = await mustRun('git', ['rev-parse', 'HEAD'], { cwd: root });
  await writeFile(path.join(root, 'src', 'cart.js'), fixedCart);
  const patch = await mustRun('git', ['diff', '--', 'src/cart.js'], { cwd: root });
  await writeFile(path.join(root, 'src', 'cart.js'), brokenCart);
  return { root, sha, patch: `${patch}\n` };
}

class FakeGitHub {
  constructor(baseSha) { this.baseSha = baseSha; this.blobs = new Map(); this.pulls = []; this.mutations = []; }
  async getIssue(_repo, number) { return { number, html_url: `https://github.com/abhiraj75/kora-store/issues/${number}`, title: 'SAVE10 coupon calculates the wrong total', body: 'Cart: Handloom Kurta (₹1,200) + Canvas Sneakers (₹800), subtotal ₹2,000, shipping free.\nApplied coupon SAVE10.\nExpected total: ₹1,800\nActual total shown: ₹200', labels: [{ name: 'redhanded' }], user: { login: 'reporter' } }; }
  async createIssue() { throw new Error('not used'); }
  async getRef(_repo, branch) { return { object: { sha: branch === 'main' ? this.baseSha : this.branchSha } }; }
  async getCommit() { return { tree: { sha: 'base-tree' } }; }
  async createBlob(_repo, content) { const key = `blob-${sha256(content).slice(0, 12)}`; this.blobs.set(key, content); this.mutations.push('createBlob'); return { sha: key }; }
  async createTree(_repo, _base, entries) { this.entries = entries; this.mutations.push('createTree'); return { sha: 'candidate-tree' }; }
  async createCommit() { this.mutations.push('createCommit'); return { sha: 'candidate-commit' }; }
  async createRef() { this.branchSha = 'candidate-commit'; this.mutations.push('createRef'); return {}; }
  async getContent(_repo, pathname) { return { sha: this.entries.find((entry) => entry.path === pathname).sha }; }
  async listPulls() { return this.pulls; }
  async createPull() { this.mutations.push('createPull'); const pr = { number: 42, html_url: 'https://github.com/abhiraj75/kora-store/pull/42', head: { sha: 'candidate-commit' } }; this.pulls = [pr]; return pr; }
}

async function harness() {
  const repo = await fixture();
  const state = await mkdtemp(path.join(os.tmpdir(), 'redhanded-state-'));
  const store = new RunStore(state); const github = new FakeGitHub(repo.sha);
  const workspace = new GitWorkspace({ repositoryUrl: () => repo.root });
  const executor = new LocalFixtureExecutor({ timeoutMs: 10000 });
  const verifier = new Verifier({ workspace, executor, store, policy: DEFAULT_POLICY });
  const publisher = new Publisher({ github, store, policy: DEFAULT_POLICY });
  const guard = new RedHandedGuard({ store, github, workspace, verifier, publisher, policy: DEFAULT_POLICY });
  return { repo, state, store, github, workspace, verifier, publisher, guard };
}

test('happy path freezes red proof, verifies exact candidate, publishes one PR, and stops', async () => {
  const h = await harness();
  let run = await h.guard.startRun({ issue: 1, evidenceMode: 'tests-only', trueforgeSessionId: 'sess-1' });
  assert.equal(run.state, STATES.BASELINE_PASSED);
  run = await h.guard.submitReproduction(run.id, contract); assert.equal(run.state, STATES.REPRODUCED);
  run = await h.guard.submitPatch(run.id, h.repo.patch); assert.equal(run.state, STATES.PATCHING);
  run = await h.guard.verifyRun(run.id); assert.equal(run.state, STATES.VERIFIED);
  assert.deepEqual(run.evidence.changedPaths.sort(), ['repro/issue-1.test.js', 'src/cart.js']);
  assert.equal(run.evidence.red.meaningfulAssertionFailure, true);
  assert.equal(run.evidence.green.passed, true);
  assert.equal(run.evidence.regression.summary.pass, 1);
  run = await h.guard.publishVerifiedPr(run.id); assert.equal(run.state, STATES.PR_CREATED);
  assert.equal(run.publication.prNumber, 42);
  assert.deepEqual(h.github.mutations.filter((name) => name === 'createPull'), ['createPull']);
  assert.equal(publicRunEvent(run).message, 'A tested fix is ready in PR #42 for developer review.');
  const retry = await h.guard.publishVerifiedPr(run.id); assert.equal(retry.publication.prUrl, run.publication.prUrl);
  assert.equal(h.github.mutations.filter((name) => name === 'createPull').length, 1);
});

test('reproduction that already passes becomes NEEDS_INFO and no patch is accepted', async () => {
  const h = await harness(); let run = await h.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  run = await h.guard.submitReproduction(run.id, { ...contract, expected: 200 });
  assert.equal(run.state, STATES.NEEDS_INFO);
  await assert.rejects(() => h.guard.submitPatch(run.id, h.repo.patch), (error) => error.code === 'INVALID_STATE');
});

test('a second active repair for the repository is rejected across store reads', async () => {
  const h = await harness();
  const first = await h.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  assert.equal(first.state, STATES.BASELINE_PASSED);
  await assert.rejects(() => h.guard.startRun({ issue: 2, evidenceMode: 'tests-only' }), (error) => error.code === 'REPOSITORY_BUSY');
});

test('syntax and import failures are environment errors, not a valid red result', async () => {
  const h = await harness(); let run = await h.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  const original = h.verifier.reproduction.bind(h.verifier);
  h.verifier.reproduction = async () => ({ exitCode: 1, summary: { tests: 1, pass: 0, fail: 1, cancelled: 0, skipped: 0, todo: 0 }, meaningfulAssertionFailure: false });
  run = await h.guard.submitReproduction(run.id, contract);
  assert.equal(run.state, STATES.ENVIRONMENT_ERROR);
  h.verifier.reproduction = original;
});

test('wrong repository, missing label, feature request, and vague report are refused', () => {
  assert.throws(() => normalizeIssueReference('https://github.com/elsewhere/repo/issues/1', DEFAULT_POLICY.repository), (error) => error.code === 'WRONG_REPOSITORY');
  assert.throws(() => validateIssue({ labels: [], title: 'bug' }, DEFAULT_POLICY), (error) => error.code === 'MISSING_LABEL');
  assert.throws(() => validateIssue({ labels: ['redhanded'], title: 'Feature: add support' }, DEFAULT_POLICY), (error) => error.code === 'FEATURE_REQUEST');
  assert.throws(() => validateReport({ repository: DEFAULT_POLICY.repository, observedBehavior: 'bad', expectedBehavior: 'good' }, DEFAULT_POLICY), (error) => error.code === 'VAGUE_REPORT');
});

test('reproduction schema cannot point at arbitrary modules or exports', () => {
  assert.throws(() => validateReproduction({ ...contract, module: 'scripts/pwn.js' }, 1), (error) => error.code === 'INVALID_REPRODUCTION');
  assert.throws(() => validateReproduction({ ...contract, export: 'exec' }, 1), (error) => error.code === 'INVALID_REPRODUCTION');
});

test('protected, renamed, symlink, binary, and traversing changes are rejected', () => {
  const good = { path: 'src/cart.js', oldMode: '100644', newMode: '100644', status: 'M', binary: false };
  for (const [change, code] of [
    [{ ...good, path: 'tests/cart.test.js' }, 'PROTECTED_PATH'],
    [{ ...good, status: 'R' }, 'UNSUPPORTED_CHANGE'],
    [{ ...good, newMode: '120000' }, 'UNSUPPORTED_MODE'],
    [{ ...good, binary: true }, 'BINARY_CHANGE'],
    [{ ...good, path: '../src/cart.js' }, 'PATH_TRAVERSAL']
  ]) assert.throws(() => validateChangedPaths([change], 'repro/issue-1.test.js', DEFAULT_POLICY), (error) => error.code === code);
});

test('incomplete and early-exit test output is not accepted', () => {
  assert.throws(() => parseTestSummary('looks good'), (error) => error.code === 'INCOMPLETE_TEST_REPORT');
  assert.throws(() => parseTestSummary('# tests 2\n# pass 1\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0'), (error) => error.code === 'INCOMPLETE_TEST_REPORT');
});

test('tampered frozen reproduction and evidence block verification or publication', async () => {
  const h = await harness(); let run = await h.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  run = await h.guard.submitReproduction(run.id, contract); run = await h.guard.submitPatch(run.id, h.repo.patch);
  await writeFile(h.store.artifactPath(run.id, 'reproduction.test.js'), 'tampered\n');
  await assert.rejects(() => h.guard.verifyRun(run.id), (error) => error.code === 'FROZEN_REPRO_CHANGED');

  const h2 = await harness(); let run2 = await h2.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  run2 = await h2.guard.submitReproduction(run2.id, contract); run2 = await h2.guard.submitPatch(run2.id, h2.repo.patch); run2 = await h2.guard.verifyRun(run2.id);
  const manifestPath = h2.store.artifactPath(run2.id, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath)); manifest.changedLines = 0; await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(() => h2.guard.publishVerifiedPr(run2.id), (error) => error.code === 'EVIDENCE_TAMPERED');
  assert.equal(h2.github.mutations.length, 0);
});

test('fake verified flags, unknown runs, stale base, and visual evidence gaps cannot publish', async () => {
  const h = await harness();
  await assert.rejects(() => h.guard.publishVerifiedPr('run-00000000-0000-0000-0000-000000000000'), (error) => error.code === 'RUN_NOT_FOUND');
  let run = await h.store.create({ repository: DEFAULT_POLICY.repository, issue: 1, verified: true });
  await assert.rejects(() => h.guard.publishVerifiedPr(run.id), (error) => error.code === 'NOT_VERIFIED');

  const h2 = await harness(); let v = await h2.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  v = await h2.guard.submitReproduction(v.id, contract); v = await h2.guard.submitPatch(v.id, h2.repo.patch); v = await h2.guard.verifyRun(v.id);
  h2.github.baseSha = 'moved';
  await assert.rejects(() => h2.guard.publishVerifiedPr(v.id), (error) => error.code === 'STALE_BASE');
  assert.equal(h2.github.mutations.length, 0);

  const h3 = await harness(); let visual = await h3.guard.startRun({ issue: 1, evidenceMode: 'visual' });
  visual = await h3.guard.submitReproduction(visual.id, contract); visual = await h3.guard.submitPatch(visual.id, h3.repo.patch);
  await assert.rejects(() => h3.guard.verifyRun(visual.id), (error) => error.code === 'VISUAL_EVIDENCE_UNAVAILABLE');
});

test('optional publication approval binds exact evidence and denial publishes nothing', async () => {
  const h = await harness(); let run = await h.guard.startRun({ issue: 1, evidenceMode: 'tests-only' });
  run = await h.guard.submitReproduction(run.id, contract); run = await h.guard.submitPatch(run.id, h.repo.patch); run = await h.guard.verifyRun(run.id);
  run = await h.guard.requestPublicationApproval(run.id);
  assert.match(run.approvalBinding, /^[0-9a-f]{64}$/);
  run = await h.guard.denyPublication(run.id, 'operator denied');
  assert.equal(run.state, STATES.APPROVAL_DENIED);
  assert.equal(h.github.mutations.length, 0);
});

test('MCP source and state machine expose no merge, deploy, release, or default-branch write route', async () => {
  const source = await readFile(new URL('../src/mcp-server.js', import.meta.url), 'utf8');
  const toolNames = [...source.matchAll(/tool\('([^']+)'/g)].map((match) => match[1]);
  assert.deepEqual(toolNames, ['start_run', 'submit_reproduction', 'submit_patch', 'verify_run', 'request_publication_approval', 'publish_verified_pr', 'get_run']);
  assert.equal(toolNames.some((name) => /merge|deploy|release|update_ref/.test(name)), false);
  assert.equal(Object.keys(STATES).some((name) => /MERG|DEPLOY|RELEASE/.test(name)), false);
});

test('TrueForge profiles use the installed TypeScript SDK field names and literal publication approval', async () => {
  const normal = JSON.parse(await readFile(new URL('../trueforge/agent.normal.json', import.meta.url)));
  const approval = JSON.parse(await readFile(new URL('../trueforge/agent.approval.json', import.meta.url)));
  for (const profile of [normal, approval]) {
    assert.ok(profile.mcpServers[0].enableTools.includes('publish_verified_pr'));
    assert.equal(profile.config.sandbox.enabled, true);
    assert.equal(profile.config.dynamicSubAgents.enabled, false);
    assert.equal('mcp_servers' in profile, false);
  }
  assert.deepEqual(normal.mcpServers[0].requireApprovalForTools, []);
  assert.deepEqual(approval.mcpServers[0].requireApprovalForTools, ['publish_verified_pr']);
});
