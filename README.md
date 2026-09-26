# RedHanded

RedHanded turns an eligible `abhiraj75/kora-store` bug report into a verified repair pull request. It stops at `PR_CREATED`. It has no merge, auto-merge, deployment, rollback, release, or default-branch write operation.

The workflow is:

```text
issue or structured report
  -> immutable baseline
  -> meaningful failing reproduction
  -> frozen reproduction
  -> candidate patch
  -> fresh independent verification
  -> repair branch and pull request
  -> stop for human review
```

## What is implemented

- A persistent run state machine with explicit failure outcomes and one active run per repository.
- Server-side repository, issue, label, evidence-mode, and report validation.
- A developer-owned reproduction contract for the coupon pricing path.
- Immutable reproduction, candidate, evidence, and report artifacts with SHA-256 identities.
- Complete staged-tree inspection. Only `src/cart.js` and one frozen `repro/issue-N.test.js` addition may ship.
- Fresh baseline and candidate workspaces. The same frozen assertion runs red on the base and green on the candidate. The pinned existing suite runs separately.
- A Docker verifier with no network, a read-only repository mount, resource limits, no Linux capabilities, and no GitHub credentials.
- A GitHub Git Data API publisher that accepts only a run ID, rechecks the base commit, creates a unique branch, verifies remote blobs, creates one PR, reconciles retries, and stops.
- TrueForge MCP tools and normal or publication-approval agent profiles.
- A transport-neutral event seam. WhatsApp is not implemented.

## Install

Requirements:

- Node.js 22 or later for RedHanded.
- Git.
- Docker for the default verifier. The verifier image defaults to `node:22.12.0-alpine`, which matches the storefront sandbox runtime.
- A running TrueForge server with a Daytona sandbox provider, the `redhanded-fix` skill, and an MCP connector named `redhanded-guard`.
- A GitHub token from a dedicated identity, scoped to `abhiraj75/kora-store` with Issues and Pull requests read/write plus Contents read/write. Do not grant Actions, Administration, Deployments, or Releases permissions.

```bash
npm install
cp .env.example .env
npm run preflight
```

Load `.env` through your process manager. RedHanded does not parse or commit it.

## Configure TrueForge

Register the MCP connector so it starts this repository's stdio server:

```bash
npm run mcp
```

The connector and skill names must match `REDHANDED_MCP_SERVER_NAME` and `redhanded-fix`. Then create or update the agent:

```bash
npm run trueforge:setup
```

For the optional hackathon profile, require a real TrueForge approval before `publish_verified_pr`:

```bash
npm run trueforge:setup -- --approval
```

The approval binds to a run whose candidate and evidence are already frozen. It authorizes PR publication only. Denial performs no remote mutation. The exact manifest fields and SDK calls follow the current [Create an Agent](https://trueforge.dev/create-agent/overview), [Use an agent](https://trueforge.dev/api/use-agent), and [Sandbox](https://trueforge.dev/sandbox) documentation. The setup script uses `@truefoundry/trueforge-sdk` 0.2.0.

## Run an issue

The TrueForge agent calls the guard tools in this order:

1. `start_run`
2. `submit_reproduction`
3. `submit_patch`
4. `verify_run`
5. `publish_verified_pr`
6. `get_run`

The same operations are available from the CLI:

```bash
npm run redhanded -- start --issue 1 --evidence tests-only --session sess-example
npm run redhanded -- reproduce --run RUN_ID --file reproduction.json
npm run redhanded -- patch --run RUN_ID --file candidate.patch
npm run redhanded -- verify --run RUN_ID
npm run redhanded -- publish --run RUN_ID
npm run redhanded -- get --run RUN_ID
```

Use `start --report report.json` for a structured raw report. The restricted integration creates one labelled issue, then follows the same pipeline. Existing issue URLs never create duplicate issues.

The coupon reproduction JSON is structured data, not executable model-authored code:

```json
{
  "kind": "module-export-call",
  "module": "src/cart.js",
  "export": "total",
  "args": [[
    { "name": "Handloom Kurta", "price": 1200, "qty": 1 },
    { "name": "Canvas Sneakers", "price": 800, "qty": 1 }
  ], "SAVE10"],
  "expected": 1800
}
```

## Evidence

Each run stores these files under `.redhanded/runs/RUN_ID/artifacts/`:

- `reproduction.test.js`: exact frozen bytes used before and after.
- `candidate.patch`: the only proposed application patch.
- `candidate-src-cart.js`: exact tested application bytes used by the publisher.
- `manifest.json`: machine-readable base, candidate, tests, timings, paths, modes, and hashes.
- `report.md`: concise human-readable verification result.

`tests-only` requires real red, green, regression, and acceptance results and prints no screenshot URL. `visual` refuses publication unless a trusted browser evidence provider supplies before and after assertions, artifacts, and accessible URLs. This repository does not silently downgrade a visual run after a browser failure.

## Tests and negative demos

```bash
npm test
```

The suite uses local temporary repositories and a mocked GitHub service. It covers the happy path, already-passing and invalid reproductions, vague or ineligible reports, protected paths, traversal, renames, symlinks, binaries, early exits, artifact tampering, fake verification claims, stale bases, duplicate publication, visual evidence failure, approval denial, and the absence of merge or deployment tools. It never attempts a destructive live write.

For a real integration, configure TrueForge, Daytona, Docker, the MCP connector, the skill, and the dedicated GitHub identity, then run issue 1 through a TrueForge session. The current machine can run the local and mocked test suite. A live TrueForge and GitHub publication test requires those operator-owned credentials and services.

## Publishing and repository settings

The owner must protect `main`, disallow bypass for the RedHanded identity, require pull requests, disable auto-merge for that identity, and make sure branch pushes do not trigger production deployment. GitHub repository permissions are not branch-scoped by themselves. The narrow publisher and repository rules establish the boundary together.

The publisher never uses `git push`, never gives credentials to candidate code, and never updates an existing ref. It creates a new `redhanded/issue-N-RUN` ref from the verified base. If `main` moved, it rejects the run as stale. A developer reviews and merges outside RedHanded.

## Threat boundary and limits

Issue text, comments, model output, patches, and candidate code are untrusted. The control process owns policy, state, credentials, frozen evidence, and publication. Candidate code runs only through the sandbox executor. The test-only local executor exists for deterministic fixtures and is not a production security boundary.

The fixed checks prove the specified coupon behavior and existing regression cases. They do not prove every application behavior or make arbitrary malicious programs safe. The initial policy supports one repository, `src/cart.js`, a maximum of two attempts, and a small diff budget.

TrueForge's Daytona sandbox isolates the model's coding workspace. RedHanded's Docker verifier independently checks the submitted patch. The official TrueForge SDK does not expose a documented API for the control service to commandeer the agent's active Daytona sandbox, so this implementation keeps the verifier behind its own explicit executor boundary.

## WhatsApp

WhatsApp remains deferred. `src/events.js` defines provider-neutral events, and `WHATSAPP_NEXT.md` lists the adapter work. No Twilio, WhatsApp, Telegram, phone-number, or webhook dependency is installed.

## AI assistance

AI tools helped draft parts of this repository. The implementation and tests require human review before production use.
