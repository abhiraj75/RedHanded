import { readFile } from 'node:fs/promises';
import { invariant } from './errors.js';
import { STATES } from './constants.js';
import { sha256, stableJson } from './util.js';

export class Publisher {
  constructor({ github, store, policy }) { Object.assign(this, { github, store, policy }); }

  async publish(runId) {
    let run = await this.store.get(runId);
    if (run.state === STATES.PR_CREATED) return run;
    invariant([STATES.VERIFIED, STATES.WAITING_PUBLISH_APPROVAL, STATES.PUBLISHING].includes(run.state), 'NOT_VERIFIED', 'Only a verified run can be published');
    invariant(run.evidence?.identity && run.candidate?.patchSha256, 'INCOMPLETE_EVIDENCE', 'Verified evidence is incomplete');

    const patch = await readFile(this.store.artifactPath(run.id, 'candidate.patch'), 'utf8');
    const repro = await readFile(this.store.artifactPath(run.id, 'reproduction.test.js'), 'utf8');
    const manifest = JSON.parse(await readFile(this.store.artifactPath(run.id, 'manifest.json'), 'utf8'));
    invariant(sha256(patch) === run.candidate.patchSha256, 'CANDIDATE_TAMPERED', 'Stored candidate patch changed after verification');
    invariant(sha256(repro) === run.reproduction.sha256, 'REPRODUCTION_TAMPERED', 'Stored reproduction changed after verification');
    const identityInput = { ...manifest }; delete identityInput.identity;
    invariant(sha256(stableJson(identityInput)) === manifest.identity && manifest.identity === run.evidence.identity, 'EVIDENCE_TAMPERED', 'Evidence manifest changed after verification');

    const target = await this.github.getRef(run.repository, this.policy.targetBranch);
    invariant(target.object.sha === run.baseCommit, 'STALE_BASE', 'Target branch moved after verification; start a fresh run');
    if (run.state !== STATES.PUBLISHING) run = await this.store.transition(run, STATES.PUBLISHING);

    const branch = run.publication?.branch || `redhanded/issue-${run.issue}-${run.id.slice(-8)}`;
    const head = `${run.repository.split('/')[0]}:${branch}`;
    try {
      const existing = await this.github.listPulls(run.repository, head);
      if (existing.length) return this.finish(run, { branch, commit: existing[0].head.sha, prNumber: existing[0].number, prUrl: existing[0].html_url });

      const baseCommit = await this.github.getCommit(run.repository, run.baseCommit);
      const files = await materializeChangedFiles(this.store, repro, run);
      const treeEntries = [];
      for (const file of files) {
        const blob = await this.github.createBlob(run.repository, file.content);
        treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await this.github.createTree(run.repository, baseCommit.tree.sha, treeEntries);
      const commit = await this.github.createCommit(run.repository, {
        message: `fix(cart): repair issue ${run.issue}\n\nFixes #${run.issue}`,
        tree: tree.sha, parents: [run.baseCommit]
      });
      try { await this.github.createRef(run.repository, `refs/heads/${branch}`, commit.sha); }
      catch (error) {
        if (error.code !== 'GITHUB_ERROR' || error.details.status !== 422) throw error;
        const current = await this.github.getRef(run.repository, branch);
        invariant(current.object.sha === commit.sha, 'PUBLICATION_CONFLICT', 'Repair branch already exists with different contents');
      }
      for (const file of files) {
        const remote = await this.github.getContent(run.repository, file.path, commit.sha);
        invariant(remote.sha === treeEntries.find((entry) => entry.path === file.path).sha, 'REMOTE_VERIFY_FAILED', `${file.path} did not match the tested candidate`);
      }
      const body = renderPullRequest(run, manifest);
      const pr = await this.github.createPull(run.repository, { title: `fix(cart): repair issue ${run.issue}`, head: branch, base: this.policy.targetBranch, body, draft: false });
      return this.finish(run, { branch, commit: commit.sha, prNumber: pr.number, prUrl: pr.html_url });
    } catch (error) {
      if (error.code === 'GITHUB_UNCERTAIN') {
        const existing = await this.github.listPulls(run.repository, head);
        if (existing.length) return this.finish(run, { branch, commit: existing[0].head.sha, prNumber: existing[0].number, prUrl: existing[0].html_url });
      }
      run.publication = { ...(run.publication || {}), branch, error: error.message };
      await this.store.transition(run, STATES.PUBLISH_FAILED);
      throw error;
    }
  }

  async finish(run, publication) {
    run.publication = publication;
    return this.store.transition(run, STATES.PR_CREATED);
  }
}

async function materializeChangedFiles(store, repro, run) {
  const expected = run.evidence.changedPaths.filter((pathname) => pathname !== run.reproduction.path);
  invariant(expected.length === 1 && expected[0] === 'src/cart.js', 'PUBLICATION_SCOPE', 'Publisher only supports the configured cart repair');
  const content = await readFile(store.artifactPath(run.id, 'candidate-src-cart.js'), 'utf8');
  invariant(sha256(content) === run.candidate.files['src/cart.js'].sha256, 'CANDIDATE_TAMPERED', 'Candidate file identity does not match verification');
  return [{ path: 'src/cart.js', content }, { path: run.reproduction.path, content: repro }];
}

function renderPullRequest(run, manifest) {
  const visual = manifest.visual?.available
    ? `Visual evidence: ${manifest.visual.before.url} and ${manifest.visual.after.url}`
    : 'Visual evidence: unavailable by operator-selected tests-only policy.';
  return `Fixes #${run.issue}\n\nBefore: ${run.report.observedBehavior}\n\nAfter: ${run.report.expectedBehavior}\n\nProof: the same frozen reproduction failed on ${run.baseCommit} and passed on the published candidate. Regression suite: ${manifest.regression.summary.pass}/${manifest.regression.summary.tests} passed. Existing test files modified: 0. New reproduction checks: 1.\n\n${visual}\n\nEvidence manifest SHA-256: \`${manifest.identity}\`\n\nStatus: Ready for human review. RedHanded does not merge or deploy.`;
}
