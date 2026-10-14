# 008 OpenCode adapter: status

Stage: draft (research; no spec yet)
Started: 2026-10-14

## Decisions so far

- 2026-10-14, the human: start working on OpenCode support. The board's Later list paired Pi and OpenCode as one spec; this spec is OpenCode only, and Pi stays on the Later list. OpenCode is the third harness, after Claude Code (spec 001) and Codex (spec 002). Cezar already runs OpenCode workers (1.18.35 on this host), which get nothing from Squeal today, the same reason ADR 0004 gave for Codex.
- The adapter implements `HarnessDelivery` from `src/core/types/delivery.ts`, as the Claude Code and Codex adapters do. Nothing in `src/core` changes for a harness; a finding that seems to need a core change is an open question for the spec, not a decision.
- The harness-neutral hook logic is `src/harness/shared/` (002 D5). The OpenCode adapter reuses it; what reads OpenCode's own payloads and output shapes lives in `src/harness/opencode/`.
- OpenCode extends through in-process plugins (JavaScript or TypeScript run by OpenCode's Bun runtime), not through hook commands as Claude Code and Codex do. ADR 0003 named it as offering cleaner in-process push. Whether the shared code can run in that process at all (it imports `node:sqlite`, `node:net` and `node:child_process`), or the plugin must hand each event to a Node process or the daemon, is a research question, not a decision.
- An idle wake is a research question, not a goal, as it was for Codex: the vision accepts pull at the next turn.
- Probes that run a real OpenCode never reach the real `HOME` (2026-10-11 lesson: environment-variable scratch homes are not isolation). They run as the throwaway OS user `squeal-e2e`, or the topic answers from docs and source only.
- 2026-10-14, the human: probes run OpenCode on `cliproxy/gpt-6-luna`; researchers mixed, Astra (Codex `gpt-6-astra`) on `opencode-plugins`, Opus on `opencode-sessions-and-wake`.

## Amendments after approval

None yet.
