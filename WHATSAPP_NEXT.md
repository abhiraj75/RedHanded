# WhatsApp integration checklist

WhatsApp remains a transport adapter. It must call the same guard operations and consume the provider-neutral events in `src/events.js`.

- Verify inbound webhook signatures and reject replayed requests.
- Allow only configured senders and map each sender to the single demo repository.
- Persist provider message IDs for input and delivery deduplication.
- Relay one concrete clarification for `needs_info` and accept the reporter's answer as untrusted data.
- Deliver `issue_logged`, `reproduction_confirmed`, `verification_failed`, and `pr_ready` events.
- Use privacy-safe, remotely accessible evidence links. Do not send local paths or secrets.
- Say: "A tested fix is ready in PR #N for developer review." Never claim a live deployment.
- Do not add merge, deployment, rollback, or release commands.
