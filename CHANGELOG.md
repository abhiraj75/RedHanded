# Changelog

## [0.1.0] - 2026-09-26

### Added

- Turn an eligible kora-store issue or structured report into a frozen, independently verified repair candidate.
- Publish the exact tested candidate as one repair branch and pull request through a restricted, idempotent GitHub client.
- Configure TrueForge with explicit MCP tool allowlists and an optional approval before PR publication.
- Exercise the happy path and policy failures with local repositories and a mocked GitHub service.

### Changed

- End the RedHanded workflow at `PR_CREATED`; a developer reviews and merges outside the system.
- Defer WhatsApp to a provider-neutral event interface and integration checklist.
