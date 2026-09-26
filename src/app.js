import path from 'node:path';
import { DEFAULT_POLICY } from './constants.js';
import { RunStore } from './run-store.js';
import { GitHubClient } from './github-client.js';
import { GitWorkspace } from './workspace.js';
import { createExecutor } from './executor.js';
import { Verifier } from './verifier.js';
import { Publisher } from './publisher.js';
import { RedHandedGuard } from './guard.js';

export function createApp(env = process.env, overrides = {}) {
  const policy = Object.freeze({ ...DEFAULT_POLICY,
    repository: env.REDHANDED_TARGET_REPOSITORY || DEFAULT_POLICY.repository,
    targetBranch: env.REDHANDED_TARGET_BRANCH || DEFAULT_POLICY.targetBranch });
  const store = overrides.store || new RunStore(env.REDHANDED_STATE_DIR || path.resolve('.redhanded'));
  const github = overrides.github || new GitHubClient({ token: env.GITHUB_TOKEN });
  const workspace = overrides.workspace || new GitWorkspace();
  const executor = overrides.executor || createExecutor(env);
  const verifier = overrides.verifier || new Verifier({ workspace, executor, store, policy, visualEvidenceProvider: overrides.visualEvidenceProvider });
  const publisher = overrides.publisher || new Publisher({ github, store, policy });
  return new RedHandedGuard({ store, github, workspace, verifier, publisher, policy });
}
