import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_POLICY, STATES } from './constants.js';
import { invariant } from './errors.js';
import { normalizeIssueReference, validateIssue, validateReport, validateReproduction } from './policy.js';
import { sha256, stableJson } from './util.js';

export class RedHandedGuard {
  constructor({ store, github, workspace, verifier, publisher, policy = DEFAULT_POLICY }) {
    Object.assign(this, { store, github, workspace, verifier, publisher, policy });
  }

  async startRun({ issue, rawReport, trueforgeSessionId, evidenceMode = 'tests-only' }) {
    invariant(this.policy.evidenceModes.includes(evidenceMode), 'INVALID_EVIDENCE_MODE', 'Evidence mode must be selected before the run');
    return this.store.lockRepository(this.policy.repository, async () => {
      const active = await this.store.activeFor(this.policy.repository);
      invariant(!active, 'REPOSITORY_BUSY', `Run ${active?.id} is already active for ${this.policy.repository}`);
      let issueData;
      if (issue != null) {
        const ref = normalizeIssueReference(issue, this.policy.repository);
        issueData = await this.github.getIssue(ref.repository, ref.issue);
        validateIssue(issueData, this.policy);
      } else {
        validateReport(rawReport, this.policy);
        issueData = await this.github.createIssue(this.policy.repository, {
          title: rawReport.title, body: renderIssue(rawReport), labels: [this.policy.requiredLabel]
        });
      }
      const report = normalizeReport(issueData, rawReport, this.policy.repository);
      validateReport(report, this.policy);
      let run = await this.store.create({ repository: this.policy.repository, issue: issueData.number,
        issueUrl: issueData.html_url, report, trueforgeSessionId: trueforgeSessionId || null, evidenceMode });
      try {
        const ref = await this.github.getRef(run.repository, this.policy.targetBranch);
        run.baseCommit = ref.object.sha;
        const root = await this.workspace.create(run.repository, run.baseCommit);
        try {
          const baseline = await this.verifier.suite(root);
          invariant(baseline.passed, 'BASELINE_FAILED', 'Existing regression suite fails on the immutable base', baseline.summary);
          run.baseline = { exitCode: baseline.exitCode, summary: baseline.summary };
        } finally { await this.workspace.cleanup(root); }
        return this.store.transition(run, STATES.BASELINE_PASSED);
      } catch (error) {
        run.failure = serializeError(error);
        await this.store.transition(run, error.code === 'OUT_OF_SCOPE' ? STATES.OUT_OF_SCOPE : STATES.ENVIRONMENT_ERROR);
        throw error;
      }
    });
  }

  async submitReproduction(runId, proposal) {
    let run = await this.store.get(runId);
    invariant(run.state === STATES.BASELINE_PASSED, 'INVALID_STATE', 'Run is not ready for reproduction');
    run = await this.store.transition(run, STATES.REPRODUCING);
    const reproduction = validateReproduction(proposal, run.issue);
    const root = await this.workspace.create(run.repository, run.baseCommit);
    try {
      const fullPath = path.join(root, ...reproduction.path.split('/'));
      await mkdir(path.dirname(fullPath), { recursive: true });
      await writeFile(fullPath, reproduction.bytes, { flag: 'wx' });
      const result = await this.verifier.reproduction(root, reproduction);
      if (!result.meaningfulAssertionFailure) {
        const state = result.exitCode === 0 ? STATES.NEEDS_INFO : STATES.ENVIRONMENT_ERROR;
        run.failure = { code: result.exitCode === 0 ? 'REPRO_ALREADY_PASSES' : 'INVALID_RED', question: 'What exact input still produces the incorrect total on the current main branch?' };
        await this.store.transition(run, state);
        return this.store.get(run.id);
      }
      const artifact = this.store.artifactPath(run.id, 'reproduction.test.js');
      await mkdir(path.dirname(artifact), { recursive: true });
      await writeFile(artifact, reproduction.bytes, { flag: 'wx' });
      run.reproduction = { path: reproduction.path, contract: reproduction.contract, sha256: sha256(reproduction.bytes), red: { summary: result.summary, exitCode: result.exitCode } };
      return this.store.transition(run, STATES.REPRODUCED);
    } finally { await this.workspace.cleanup(root); }
  }

  async submitPatch(runId, patch) {
    let run = await this.store.get(runId);
    invariant(run.state === STATES.REPRODUCED, 'INVALID_STATE', 'A verified red reproduction is required before a patch');
    invariant(run.attemptCount < this.policy.maxAttempts, 'ATTEMPT_LIMIT', 'Repair attempt limit reached');
    run.attemptCount += 1;
    run = await this.store.transition(run, STATES.PATCHING);
    const reproduction = { path: run.reproduction.path, bytes: await readFile(this.store.artifactPath(run.id, 'reproduction.test.js'), 'utf8') };
    const root = await this.workspace.create(run.repository, run.baseCommit);
    try {
      const baseFile = await this.workspace.read(root, 'src/cart.js');
      const tree = await this.workspace.applyCandidate(root, patch, reproduction);
      const candidateFile = await this.workspace.read(root, 'src/cart.js');
      run.candidate = { patchSha256: sha256(patch), baseFile, tree: tree.tree,
        files: { 'src/cart.js': { sha256: sha256(candidateFile) } } };
      const artifact = this.store.artifactPath(run.id, 'candidate.patch');
      await mkdir(path.dirname(artifact), { recursive: true });
      await writeFile(artifact, patch, { flag: 'wx' });
      await writeFile(this.store.artifactPath(run.id, 'candidate-src-cart.js'), candidateFile, { flag: 'wx' });
      return this.store.save(run);
    } finally { await this.workspace.cleanup(root); }
  }

  async verifyRun(runId) {
    let run = await this.store.get(runId);
    invariant(run.state === STATES.PATCHING, 'INVALID_STATE', 'Run has no candidate ready for verification');
    run = await this.store.transition(run, STATES.VERIFYING);
    try {
      const patch = await readFile(this.store.artifactPath(run.id, 'candidate.patch'), 'utf8');
      const bytes = await readFile(this.store.artifactPath(run.id, 'reproduction.test.js'), 'utf8');
      invariant(sha256(bytes) === run.reproduction.sha256, 'FROZEN_REPRO_CHANGED', 'Frozen reproduction was modified');
      const evidence = await this.verifier.verify(run, patch, { ...run.reproduction, bytes });
      const manifestPath = this.store.artifactPath(run.id, 'manifest.json');
      await writeFile(manifestPath, `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
      await writeFile(this.store.artifactPath(run.id, 'report.md'), renderEvidenceReport(run, evidence), { flag: 'wx' });
      run.evidence = evidence;
      return this.store.transition(run, STATES.VERIFIED);
    } catch (error) {
      run.failure = serializeError(error);
      const state = ['SANDBOX_UNAVAILABLE', 'EXECUTION_TIMEOUT', 'OUTPUT_LIMIT', 'INCOMPLETE_TEST_REPORT'].includes(error.code) ? STATES.ENVIRONMENT_ERROR : STATES.VERIFICATION_FAILED;
      await this.store.transition(run, state);
      throw error;
    }
  }

  getRun(runId) { return this.store.get(runId); }
  publishVerifiedPr(runId) { return this.publisher.publish(runId); }
  async requestPublicationApproval(runId) {
    const run = await this.store.get(runId);
    invariant(run.state === STATES.VERIFIED, 'INVALID_STATE', 'Only a verified run can await publication approval');
    return this.store.transition(run, STATES.WAITING_PUBLISH_APPROVAL, { approvalBinding: sha256(stableJson({ runId, candidate: run.candidate.patchSha256, evidence: run.evidence.identity })) });
  }
  async denyPublication(runId, reason = 'Denied by operator') {
    const run = await this.store.get(runId);
    invariant(run.state === STATES.WAITING_PUBLISH_APPROVAL, 'INVALID_STATE', 'Run is not waiting for publication approval');
    return this.store.transition(run, STATES.APPROVAL_DENIED, { approvalDeniedReason: reason });
  }
}

function normalizeReport(issue, raw, repository) {
  if (raw) return { ...raw, repository, issueReference: issue.html_url, reporterReference: raw.reporterReference || null };
  const body = issue.body || '';
  const match = (pattern) => body.match(pattern)?.[1]?.trim();
  const observed = match(/(?:observed|actual(?: total shown)?)\s*:\s*(.+)/i);
  const expected = match(/expected(?: total)?\s*:\s*(.+)/i);
  return { repository, issueReference: issue.html_url, title: issue.title,
    observedBehavior: observed ? `Actual total shown: ${observed}` : issue.title,
    expectedBehavior: expected ? `Expected total: ${expected}` : '',
    reproductionInputs: {
      cart: match(/cart\s*:\s*(.+)/i),
      coupon: match(/(?:applied\s+)?coupon(?:\s*:\s*|\s+)([A-Z0-9_-]+)/i)
    }, reporterReference: issue.user?.login || null };
}

function renderIssue(report) {
  return `Observed: ${report.observedBehavior}\nExpected: ${report.expectedBehavior}\nReproduction inputs: ${JSON.stringify(report.reproductionInputs)}\nReporter: ${report.reporterReference || 'not provided'}`;
}
function serializeError(error) { return { code: error.code || 'ERROR', message: error.message, details: error.details || {} }; }
function renderEvidenceReport(run, evidence) {
  return `# RedHanded verification report\n\nRun: ${run.id}\nIssue: #${run.issue}\nRepository: ${run.repository}\nBase commit: ${run.baseCommit}\nCandidate tree: ${evidence.candidateTree}\nReproduction SHA-256: ${evidence.reproductionSha256}\nEvidence identity: ${evidence.identity}\n\nThe frozen reproduction failed on the base and passed on the candidate. The unchanged regression suite passed ${evidence.regression.summary.pass}/${evidence.regression.summary.tests}. Evidence mode: ${run.evidenceMode}.\n\nChanged paths:\n${evidence.changedPaths.map((item) => `- ${item}`).join('\n')}\n`;
}
