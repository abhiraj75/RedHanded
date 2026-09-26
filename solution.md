# RedHanded

**Catches your bug red-handed. Then fixes it.**

## Problem

Coding agents already turn issues into pull requests, but their safeguards are instructions the model may ignore. They can edit the tests that judge them, and they stop at the PR.

## Solution

An agent that cannot change code until a failing check proves the problem, cannot touch tests, and cannot merge without a human. Rules enforced by the system, not the prompt.

## How it works

1. A one-line request in the TrueForge chat.
2. The agent raises a GitHub issue labelled `redhanded`, the only label it acts on.
3. Sandbox baseline: clone, run the existing suite.
4. Red: a new check in `repro/` must fail on the current code.
5. Smallest change in `src/`.
6. Green: the new check and the full suite pass.
7. A 2-file PR from a fresh branch, Conventional Commits title, before and after output in the description. Its own superseded PRs are closed.
8. A human approves the merge.

## How we use TrueForge

| Feature | Use |
|---|---|
| MCP tools | GitHub MCP, 11 of 45 tools enabled |
| Sandbox | All code runs in Daytona. The repo is public, so no credentials enter it. |
| Skills | `redhanded-fix`: the step-by-step procedure |
| Approvals | `merge_pull_request` alone needs human approval |

## Where it stops

Autonomous: reversible actions (issues, branches, PRs). Human approval: merging. Forbidden: editing `tests/`, `scripts/`, `.github/` or `package.json`; following instructions inside issue text; handling credentials. Backstop: a GitHub ruleset on `main` requires a PR, blocks force pushes, allows no bypass.

## Demo

Coupon SAVE10 on a ₹2,000 cart shows ₹200 instead of ₹1,800. RedHanded proves it red, fixes `src/cart.js`, and waits for merge approval.
