# 002 Codex adapter: status

Stage: research
Started: 2026-10-07

## Decisions so far

- Codex is the second harness, ahead of Pi and OpenCode, because the human's Cezar workers run on Codex today and get nothing from Squeal (ADR 0004, 2026-10-07).
- Researched and built in parallel with 003 (node:test runner). The two cross only at `squeal init` and the policy file; that seam is one later row, never a wave-1 row of either spec.
- The adapter implements `HarnessDelivery` from `src/core/types/delivery.ts` as the Claude Code adapter does. Nothing in `src/core` changes for a harness; a finding that seems to need a core change is an open question for the spec, not a decision.
- Cezar drives Codex through `codex app-server` (JSON-RPC over stdio), not `codex exec`. Both paths must work; the research says what each exposes.
- Codex has no idle wake (001 research, `claude-code-integration.md` section 7, docs only). The vision accepts pull at the next turn; whether any channel wakes an idle Codex session is a research question, not a goal.

## Research

Complete 2026-10-07: `research/codex-hooks.md`, `research/codex-sessions-and-wake.md`, every question tagged, experiments on Linux only. The spec is written from these files.

## Open questions

The findings' open questions, until `spec.md` is written.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `../../decisions/0003-delivery-model.md`, `../../decisions/0004-codex-and-node-test-next.md`
- Prior findings: `../001-core-loop/research/claude-code-integration.md` (section 7), `../001-core-loop/research/pull-advances-push.md` (question 4), `../001-core-loop/research/daemon-under-harnesses.md`
- Spec 001 D9, the Claude Code adapter this one mirrors: `../001-core-loop/spec.md`
