# Wave 9: a gate gets the lint of the files it names (row 017-37, gh-238)

The human, 2026-11-28 (task b468025e card: "Approve all three parts"). Coordinator b468025e. One worker, one candidate with a version raise, review on the exact `cand/<version>` SHA.

## Row 017-37 (worker; shape: slice)

**Outcome.** A gate that names files gets their lint verdict without waiting for a full re-lint, and a lint wait names its real cause.

**Evidence.** `research/lint-gate-stall.md` F1 to F4 and "Proposed fix row": 12 of 271 full re-lints finished within 120 s; 43% of lint wait time is a pool-share or queue-order refusal that status reports as a CPU wait.

**Read.** `docs/styleguide.md`; spec 017 D7 (the pass), D8 (what the agent sees), D9; spec 011 C9 and C15 (named waits); `src/core/lint/pass/parts.ts` (`lintParts`, `readQueue`, `firstOf`), `rekey.ts` (`judgeAll`, quiet set), `cpu-wait.ts` (`refusedCpu`); `src/core/capacity/pool.ts` (`acquire`, `#logRefusal`: three refusal causes); `src/core/lint/surface/` (snapshot, format, report); `src/cli/wait/` (`decide.ts`, `reads.ts`); `src/core/types/lint-delivery.ts`.

**Contract (the coordinator's).**
1. A pending lint-included file that the latest revisions changed runs as an edit part, outside the background ceiling, also while it sits in a first or config keying's quiet set. Every other file keeps the backlog lease.
2. `squeal status --wait <paths>` also waits for the lint of the named paths that lint includes. Text and JSON give their lint apart from the repository count: done, pending, failing, unknown, each with its reason. JSON is additive; the repository-wide `linting` count stays.
3. A refusal the CPU ceiling did not cause (pool share or queue order) is recorded and shown with that reason and no CPU numbers.

**Owns.** `src/core/lint/`, `src/core/capacity/pool.ts`, `src/cli/wait/`, `src/cli/status-wait*.ts`, `src/core/types/lint-delivery.ts`, their tests, `test/evals/*` parsers that read the changed JSON (round-tripped through the real formatters), `docs/specifications/017-lint-checks/tasks/017-37/`. Not `src/harness/`, `src/core/runner-host/`, `src/core/scheduler/`, `src/core/daemon/`, `docs/board.md`, `package.json`, bundles, `spec.md`.

**Done when.**
- Tests fail before and pass after: a config keying leaves N files pending and the pool refuses every backlog lease; an edited included file still reaches `pass` or `fail` while the backlog stays `pending`; `status --wait <file>` returns that file's lint verdict before the backlog finishes; a share refusal with busy CPUs below the limit names the share and no CPU numbers; backlog parts still wait while refused.
- `pnpm run lint`, `pnpm run typecheck`, `squeal status --wait 60000 <changed-path>...` read and reported. Direct `vitest run` names its files under `timeout 600`. No build, no full suite, no bench.
- Commits on the worker branch; the final message lists the spec text D7 and D8 need and every JSON change.

Use /worker.

## Review of candidate 0.1.666 (reviewer; shape: review)

Candidate `cand/0.1.666` at `ff4f449e6` (row 017-37 commits plus the 0.1.666 bundle commit), base `3e52a9fa9` (main when integrated). Read this brief, `research/lint-gate-stall.md` and `tasks/017-37/notes.md`. Check the three contract items and their tests; the two agreed edits outside the brief (`src/core/scheduler/capacity.ts` `backgroundGate().refusal`, `src/cli/named-print.ts` `lint` field) stay additive; an edited file still records no transition from an edit part of a first or config keying; `status --wait` exit code and verdict are unchanged at the deadline; JSON is additive and the evals parser round-trips the real formatter; backlog parts still wait while refused. Use Squeal results and CI run 46085330449; targeted checks only, no full suite, no bench (the bench has no lint cells; the coordinator runs the `@scheduler` pair for the pool change). Write `reviews/0.1.666.md`.

Use /reviewer.
