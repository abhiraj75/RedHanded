import path from 'node:path';
import { invariant } from './errors.js';

export function normalizeIssueReference(value, expectedRepository) {
  if (Number.isInteger(value) && value > 0) return { repository: expectedRepository, issue: value };
  const match = String(value).match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/(\d+)\/?$/);
  invariant(match, 'INVALID_ISSUE', 'Issue must be a positive number or canonical GitHub issue URL');
  invariant(match[1].toLowerCase() === expectedRepository.toLowerCase(), 'WRONG_REPOSITORY', `Only ${expectedRepository} is allowed`);
  return { repository: match[1], issue: Number(match[2]) };
}

export function validateIssue(issue, policy) {
  invariant(!issue.pull_request, 'OUT_OF_SCOPE', 'The reference points to a pull request, not an issue');
  const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name);
  invariant(labels.includes(policy.requiredLabel), 'MISSING_LABEL', `Issue requires the ${policy.requiredLabel} label`);
  const text = `${issue.title || ''}\n${issue.body || ''}`.toLowerCase();
  invariant(!/\b(feature|enhancement|new capability|add support)\b/.test(text), 'FEATURE_REQUEST', 'Feature requests are outside RedHanded scope');
}

export function validateReport(report, policy) {
  invariant(report && typeof report === 'object', 'INVALID_REPORT', 'Report is required');
  invariant(report.repository?.toLowerCase() === policy.repository.toLowerCase(), 'WRONG_REPOSITORY', `Only ${policy.repository} is allowed`);
  for (const key of ['observedBehavior', 'expectedBehavior']) {
    invariant(typeof report[key] === 'string' && report[key].trim().length >= 8, 'VAGUE_REPORT', `${key} needs a concrete description`);
  }
  invariant(report.reproductionInputs && typeof report.reproductionInputs === 'object', 'VAGUE_REPORT', 'Concrete reproduction inputs are required');
}

export function validateReproduction(contract, issueNumber) {
  invariant(contract && contract.kind === 'module-export-call', 'INVALID_REPRODUCTION', 'Only module-export-call reproductions are supported');
  invariant(contract.module === 'src/cart.js', 'INVALID_REPRODUCTION', 'The reproduction must exercise src/cart.js');
  invariant(contract.export === 'total', 'INVALID_REPRODUCTION', 'The coupon MVP reproduction must call total');
  invariant(Array.isArray(contract.args) && contract.args.length === 2, 'INVALID_REPRODUCTION', 'Reproduction args must contain cart items and coupon code');
  invariant(typeof contract.expected === 'number' && Number.isFinite(contract.expected), 'INVALID_REPRODUCTION', 'Expected total must be a finite number');
  const bytes = reproductionBytes(contract, issueNumber);
  return { contract: structuredClone(contract), bytes, path: `repro/issue-${issueNumber}.test.js` };
}

export function reproductionBytes(contract, issueNumber) {
  const args = JSON.stringify(contract.args);
  const expected = JSON.stringify(contract.expected);
  return `// Frozen by RedHanded for issue #${issueNumber}.\nimport { test } from 'node:test';\nimport assert from 'node:assert/strict';\nimport { total } from '../src/cart.js';\n\ntest('issue #${issueNumber} reproduction', () => {\n  assert.equal(total(...${args}), ${expected});\n});\n`;
}

export function validateChangedPaths(changes, reproPath, policy) {
  invariant(changes.length > 0, 'EMPTY_PATCH', 'Candidate patch has no changes');
  const allowed = new Set([...policy.allowedApplicationPaths, reproPath]);
  for (const change of changes) {
    const normalized = change.path.replaceAll('\\', '/');
    invariant(normalized === path.posix.normalize(normalized) && !normalized.startsWith('../') && !path.posix.isAbsolute(normalized), 'PATH_TRAVERSAL', `Unsafe path ${change.path}`);
    invariant(allowed.has(normalized), 'PROTECTED_PATH', `${change.path} is outside the repair policy`);
    invariant(change.status !== 'D' && change.status !== 'R' && change.status !== 'C', 'UNSUPPORTED_CHANGE', `${change.path} cannot be deleted, renamed, or copied`);
    const safeMode = change.status === 'A'
      ? change.oldMode === '000000' && change.newMode === '100644' && normalized === reproPath
      : change.oldMode === '100644' && change.newMode === '100644';
    invariant(safeMode, 'UNSUPPORTED_MODE', `${change.path} has a forbidden mode change`);
    invariant(!change.binary, 'BINARY_CHANGE', `${change.path} cannot be binary`);
  }
}

export function parseTestSummary(output) {
  const value = (name) => Number(output.match(new RegExp(`(?:#|ℹ)\\s+${name}\\s+(\\d+)`))?.[1] ?? -1);
  const summary = { tests: value('tests'), pass: value('pass'), fail: value('fail'), cancelled: value('cancelled'), skipped: value('skipped'), todo: value('todo') };
  const accounted = summary.pass + summary.fail + summary.cancelled + summary.skipped + summary.todo;
  invariant(summary.tests > 0 && accounted === summary.tests, 'INCOMPLETE_TEST_REPORT', 'Test process did not emit a complete Node test summary', summary);
  return summary;
}
