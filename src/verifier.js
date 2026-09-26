import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { invariant, RedHandedError } from './errors.js';
import { parseTestSummary, validateChangedPaths } from './policy.js';
import { now, sha256, stableJson } from './util.js';

export class Verifier {
  constructor({ workspace, executor, store, policy, visualEvidenceProvider = null }) {
    Object.assign(this, { workspace, executor, store, policy, visualEvidenceProvider });
  }

  async suite(root) {
    // The bounded storefront's developer-owned regression command is pinned here
    // so a candidate cannot rewrite package.json and change what verification runs.
    const result = await this.executor.run(root, 'node', ['--test', 'tests/cart.test.js']);
    if (result.timedOut) throw new RedHandedError('EXECUTION_TIMEOUT', 'Regression suite timed out');
    if (result.overflow) throw new RedHandedError('OUTPUT_LIMIT', 'Regression suite exceeded output limit');
    const summary = parseTestSummary(`${result.stdout}\n${result.stderr}`);
    return { ...result, summary, passed: result.exitCode === 0 && summary.fail === 0 && summary.cancelled === 0 };
  }

  async reproduction(root, reproduction) {
    const result = await this.executor.run(root, 'node', ['--test', reproduction.path]);
    if (result.timedOut) throw new RedHandedError('EXECUTION_TIMEOUT', 'Reproduction timed out');
    if (result.overflow) throw new RedHandedError('OUTPUT_LIMIT', 'Reproduction exceeded output limit');
    const output = `${result.stdout}\n${result.stderr}`;
    const summary = parseTestSummary(output);
    return { ...result, summary, meaningfulAssertionFailure: result.exitCode !== 0 && summary.fail === 1 && /AssertionError/.test(output) };
  }

  async verify(run, patch, reproduction) {
    const startedAt = now();
    const baseline = await this.workspace.create(run.repository, run.baseCommit);
    const candidate = await this.workspace.create(run.repository, run.baseCommit);
    try {
      const baselineReproPath = path.join(baseline, ...reproduction.path.split('/'));
      await mkdir(path.dirname(baselineReproPath), { recursive: true });
      await writeFile(baselineReproPath, reproduction.bytes, { flag: 'wx' });
      const before = await this.reproduction(baseline, reproduction);
      invariant(before.meaningfulAssertionFailure, 'INVALID_RED', 'Original code did not fail the frozen behavioral assertion');

      const tree = await this.workspace.applyCandidate(candidate, patch, reproduction);
      validateChangedPaths(tree.changes, reproduction.path, this.policy);
      invariant(tree.changedLines <= this.policy.maxChangedLines, 'PATCH_BUDGET_EXCEEDED', `Candidate changes ${tree.changedLines} lines; limit is ${this.policy.maxChangedLines}`);
      invariant(await this.workspace.read(candidate, reproduction.path) === reproduction.bytes, 'FROZEN_REPRO_CHANGED', 'Frozen reproduction bytes changed');

      const after = await this.reproduction(candidate, reproduction);
      invariant(after.exitCode === 0 && after.summary.pass === 1, 'GREEN_FAILED', 'Candidate did not pass the frozen reproduction');
      const regression = await this.suite(candidate);
      invariant(regression.passed, 'REGRESSION_FAILED', 'Candidate regression suite failed', regression.summary);

      let visual = { required: run.evidenceMode === 'visual', available: false, reason: 'Tests-only mode selected by operator' };
      if (run.evidenceMode === 'visual') {
        invariant(this.visualEvidenceProvider, 'VISUAL_EVIDENCE_UNAVAILABLE', 'Visual mode requires a trusted browser evidence provider');
        visual = await this.visualEvidenceProvider.capture({ baseline, candidate, run, reproduction });
        invariant(visual?.before?.path && visual?.after?.path && visual.before.observed !== visual.after.observed, 'VISUAL_EVIDENCE_INCOMPLETE', 'Trusted before/after browser evidence is incomplete');
      }

      const evidence = {
        schemaVersion: 1, runId: run.id, repository: run.repository, issue: run.issue,
        trueforgeSessionId: run.trueforgeSessionId || null, baseCommit: run.baseCommit,
        candidateTree: tree.tree, candidatePatchSha256: sha256(patch), reproductionSha256: sha256(reproduction.bytes),
        changedPaths: tree.changes.map((entry) => entry.path), changedLines: tree.changedLines,
        baseline: run.baseline, red: compact(before), green: compact(after), regression: compact(regression),
        acceptance: compact(after), visual, nodeVersion: process.version, startedAt, completedAt: now()
      };
      evidence.identity = sha256(stableJson(evidence));
      return evidence;
    } finally { await this.workspace.cleanup(baseline); await this.workspace.cleanup(candidate); }
  }
}

function compact(result) {
  return { exitCode: result.exitCode, signal: result.signal, timedOut: result.timedOut, overflow: result.overflow,
    summary: result.summary, passed: result.exitCode === 0, meaningfulAssertionFailure: result.meaningfulAssertionFailure || false };
}
