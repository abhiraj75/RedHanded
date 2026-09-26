# RedHanded

**Catches your bug red-handed. Then fixes it.**

A coding agent, built on TrueFoundry's TrueForge, that can't ship a fix it hasn't proven.
A bug report arrives on WhatsApp; RedHanded files it on GitHub, reproduces it with a failing check
in a sandbox, fixes it, and sends the proof to the developer's WhatsApp. Nothing reaches the live
site until the developer approves.

- Target repo the agent acts on: github.com/abhiraj75/kora-store
- `skills/redhanded-fix/` : the fix procedure (TrueForge skill)
- `agent/instructions.md` : the agent's system prompt
- `guard/`, `bridge/` : coming next

## AI tools used
Parts of this repository were drafted with AI assistance (Claude) and reviewed by the team.
