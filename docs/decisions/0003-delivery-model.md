# 0003. Delivery is a diff against a per-consumer view, through a Claude Code plugin

Date: 2026-10-03
Status: accepted

## Context

Events replayed from a queue can be false by the time an agent reads them: a test that broke at revision 184 and recovered at 186 would be reported as broken. Delivery must reach the agent mid-turn, at tool boundaries, and wake an idle agent. Evidence: `docs/specifications/001-core-loop/research/claude-code-integration.md`.

## Decision

- Squeal records transitions as an audit log but delivers a diff between what each consumer `(worktree, session, agent)` was last told and the current known state, computed at delivery time and labelled with the current revision and pending counts.
- The Claude Code integration ships as a plugin. Primary push is a synchronous `PostToolBatch` hook. Idle push is an `asyncRewake` waiter, interactive sessions only. `PreToolUse` denial is a policy option for regressions, on by default, never for recoveries. `Stop` delivers status and applies completion policy.
- Hook scripts are dependency-free Node, read the store directly, time out at 2 s, and exit silently on error.

## Alternatives considered

- Replay the event queue. Lies after break-and-recover; duplicates across sessions.
- Hooks written into `.claude/settings.json` by an init command. Works, but merges with user-owned JSON, needs a resolvable command path on every machine, and `npx` cold start exceeds the latency budget.
- Monitor tool or plugin monitors. Model-initiated, expire, interactive only; a fallback, not a channel the harness controls.
- Pi or OpenCode first. Both offer cleaner in-process push, but Claude Code was chosen in ADR 0001.

## Consequences

- Each subagent is its own consumer and receives only its own deltas.
- A delivered message is always true at delivery; silence after break-and-recover is by design.
- In `-p` mode there is no idle wake; `PostToolBatch` alone carries delivery.
- The model treats denial reasons as obstacles, not advice, so wording and the default are dogfooding items.
