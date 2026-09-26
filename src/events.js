export class EventSink {
  async emit(_event) { throw new Error('EventSink.emit must be implemented by a transport adapter'); }
}

export function publicRunEvent(run) {
  const type = run.state === 'PR_CREATED' ? 'pr_ready'
    : run.state === 'NEEDS_INFO' ? 'needs_info'
    : run.state === 'REPRODUCED' ? 'reproduction_confirmed'
    : run.state === 'VERIFICATION_FAILED' ? 'verification_failed'
    : 'issue_logged';
  return { id: `${run.id}:${run.state}`, type, runId: run.id, issue: run.issue,
    message: type === 'pr_ready' ? `A tested fix is ready in PR #${run.publication.prNumber} for developer review.` : run.failure?.question || run.state,
    prUrl: run.publication?.prUrl || null };
}
