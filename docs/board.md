# Board

Current and planned tasks. The coordinator keeps this file; workers do not edit it. One task is one worker, one branch, one result. A wave runs its tasks in parallel and ends with a review whose findings shape the next wave.

Status values: `planned`, `running`, `review`, `done`, `dropped`.

## Feature 001: core validation loop

Spec: `specifications/001-core-loop/spec.md`. Sections referenced as D1 to D12.

### Wave 0: scaffold

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-00 package scaffold and interfaces | done | npm package `squeal`, strict TS, ESM, Node >= 22.13, Vitest for tests, Biome for lint and format, GitHub Actions CI (lint, typecheck, test on Node 22 and 24), source layout `src/core`, `src/runners/vitest`, `src/harness/claude-code`, `src/cli`, `plugins/claude-code`, `test/fixtures`. Internal interfaces from the spec as types with doc comments: watcher backend (D2), runner adapter (D4), store access (D8), harness delivery (D9), policy (D11). No implementations beyond stubs that satisfy the type checker. | CI green on the branch, `npm test` runs one placeholder test, types reviewed by the coordinator. |

### Wave 1: foundations (parallel, after wave 0 review)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-10 shared store | running | D8: `node:sqlite` store at `<common-dir>/squeal/store.sqlite`, schema and `user_version` migrations, WAL and busy timeout, repositories for worktrees, revisions, file hashes, test files, checks, results, runs, transitions, consumers and views; pruning. Common-dir resolution without git (D1). | Concurrency test with 4 writers and 4 readers loses nothing; kill-during-write leaves `integrity_check` ok; migration test from version 0. |
| 001-11 hashing and keys | running | D3: git blob hash with the clean-index shortcut and attribute rule, environment hash, check key, closure assembly from runner output plus snapshot and declared inputs, stat cache, reverse index, incremental re-keying on change, add and delete handling. | Unit tests for every rule; key stability across a worktree copy at another path; 5,000 closures re-keyed under 1 s. |
| 001-12 watcher and revisions | review | D2: watcher interface with chokidar (Linux) and @parcel/watcher (macOS) backends, git-derived ignores in three layers, nested worktree exclusion, debounce 100/500 ms, hash-based reconciliation into revisions, 30 s reconciliation pass. | Fixture tests for atomic save, rename storm, new nested worktree, touch without change (no revision), missed event caught by reconciliation. |
| 001-13 Vitest adapter | running | D4: runner interface implementation over `vitest/node`: invalidate, affected (related walk plus setup, config and snapshot additions), closure, enumerate, run via reporter hooks, file-level errors, config-change recreate, exit code reset. Fixture projects. | Every invalidation case in research Q5 has a test; results come only from reporter hooks; one-file warm run under 400 ms on the fixture. |

### Wave 2: semantics (parallel, after wave 1 review)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-20 scheduler and validity | planned | D5: per-check validity, lookup-before-run, ordering, tiers with re-planning, post-tier stability check, baseline lookup then run-missing, `run --all`. | Fixture test: change during a tier discards and re-queues; second worktree bootstrap runs zero tests. |
| 001-21 known state, transitions, delivery views | planned | D6: known-state derivation, fingerprint, transition recording, consumer registration with seeded view, delta computation, message formatting with header and 10,000-character cap. | Break-and-recover between deliveries yields silence; first-seen fail, pass to fail, fail to pass, changed fingerprint each yield exactly one delta line. |
| 001-22 status and why | planned | D7: `squeal status`, `--json`, `squeal why <check>`, human formatter matching the vision example, daemon liveness from heartbeat. | Snapshot tests of both renderings; works with no daemon running. |

### Wave 3: runtime and harness (parallel, after wave 2 review)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-30 daemon and CLI | planned | D10, D11: detached start, exclusive-lock singleton, socket in runtime dir, heartbeat, exit conditions, consumer expiry, policy loading from `squeal.config.json`, `squeal daemon`, `squeal start`, `squeal run --all`, `squeal init`. | Five concurrent starts yield one daemon; SIGKILL and restart within 200 ms; idle exit observed in a test with a short interval. |
| 001-31 Claude Code plugin | planned | D9: plugin manifest, `hooks/hooks.json`, dependency-free hook scripts for SessionStart, PostToolBatch, PreToolUse (policy), Stop, SubagentStart, SubagentStop, SessionEnd, the asyncRewake waiter with per-consumer lock and `-p` guard, `skills/squeal`, `bin/squeal`. | Recorded-JSON tests for every event; p95 hook latency under 80 ms; no store and newer-schema cases exit 0 silently. |

### Wave 4: proof

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-40 end to end | planned | Fixture repository with two worktrees: PASS to FAIL, FAIL to PASS, silence on break-and-recover, inheritance with zero runs, isolation of edits between worktrees. | All scenarios in spec Testing pass in CI. |
| 001-41 dogfooding report | planned | Run Squeal on this repository with Claude Code interactive and `-p`. Record delivery latency, duplicate rate, PreToolUse reactions. Write `specifications/001-core-loop/lessons.md` and resolve open questions 1, 3 and 6. | Report committed; open questions updated in spec. |

## Later

- 002 pytest runner adapter.
- 003 inherited-pass re-verification policy, if dogfooding shows stale escapes.
- 004 Pi and OpenCode adapters.
- macOS verification before any public release.
