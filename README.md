# RedHanded

**Catches your bug red-handed. Then fixes it.**

A coding agent, built on TrueFoundry's TrueForge, that can't ship a fix it hasn't proven.
A developer describes a change in the TrueForge chat; RedHanded raises the GitHub issue, reproduces the problem with a failing check in a sandbox, makes the change, and opens a PR with proof. Nothing merges until a human approves.

- Target repo the agent acts on: github.com/abhiraj75/kora-store
- `skills/redhanded-fix/` : the fix procedure (TrueForge skill)
- `agent/instructions.md` : the agent's system prompt
- `guard/` : coming next

## AI tools used
Parts of this repository were drafted with AI assistance (Claude) and reviewed by the team.
