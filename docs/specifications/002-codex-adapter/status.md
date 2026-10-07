# 002 Codex adapter: status

Stage: approved (2026-10-07, by the human; waves on `docs/board.md`, briefs under `tasks/`)
Started: 2026-10-07

## Decisions so far

- Codex is the second harness, ahead of Pi and OpenCode, because the human's Cezar workers run on Codex today and get nothing from Squeal (ADR 0004, 2026-10-07).
- Researched and built in parallel with 003 (node:test runner). The two cross only at `squeal init` and the policy file; that seam is one later row, never a wave-1 row of either spec.
- The adapter implements `HarnessDelivery` from `src/core/types/delivery.ts` as the Claude Code adapter does. Nothing in `src/core` changes for a harness; a finding that seems to need a core change is an open question for the spec, not a decision.
- Cezar drives Codex through `codex app-server` (JSON-RPC over stdio), not `codex exec`. Both paths must work; the research says what each exposes.
- Codex has no idle wake (001 research, `claude-code-integration.md` section 7, docs only). The vision accepts pull at the next turn; whether any channel wakes an idle Codex session is a research question, not a goal.

## Amendments after approval

- 2026-10-07, at approval: open questions 1 to 3 are the wave-0 research row 002-11; 4 waits for a host where bubblewrap works; 5 is measured in dogfooding; 6 (a policy-gated `codex queue` wake) stays with the human and is not planned.

- 2026-10-07, wave 0 (002-10): the harness-neutral hook logic is `src/harness/shared/` (context, ensure, sweep, primer, text, deliver, deny, prompt, session, stop, waiter, hook); the Claude Code hooks keep their stdin fields, output shapes, fork detection and every `CLAUDE_*` read. No behaviour change; bundles rebuilt as 0.1.15.
- 2026-10-07, wave 0 (002-11, `research/wave-0-checks.md`): D1, D4 and goal 6 amended. The Codex plugin has its own `.agents/plugins/marketplace.json`; commands are one string with `${PLUGIN_ROOT}` literal; the fast path tests `$PWD` and never `CLAUDE_PROJECT_DIR`; plugin trust survives a version raise and a test pins the `hooks.json` hashes; `--print-launcher-config` emits `hooks.state` from a ported hash. SessionEnd at TUI exit is not guaranteed when the TUI's thread lives in Codex's managed daemon, so goal 6 leaves the TUI to expiry. Open questions 1 to 3 closed; row 002-17 added for trust through `config/batchWrite`.
- 2026-10-07, before wave 1 (coordinator): D2 amended. No `harness` field on the consumer record: nothing reads it, and it would be a schema step.

## Research

Complete 2026-10-07: `research/codex-hooks.md`, `research/codex-sessions-and-wake.md`, every question tagged, experiments on Linux only. The spec is written from these files.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `../../decisions/0003-delivery-model.md`, `../../decisions/0004-codex-and-node-test-next.md`
- Prior findings: `../001-core-loop/research/claude-code-integration.md` (section 7), `../001-core-loop/research/pull-advances-push.md` (question 4), `../001-core-loop/research/daemon-under-harnesses.md`
- Spec 001 D9, the Claude Code adapter this one mirrors: `../001-core-loop/spec.md`
