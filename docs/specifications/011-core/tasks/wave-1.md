# 011 wave 1: the first Triage rows

Approved by the human on 2026-10-17 (`docs/triage/2026-10-17-digest.md`, groups A and B). Dispatch waits for the host: one-minute load below the CPU count, at most 3 workers across the repository (`docs/process.md`, Test runs on a shared host). Standing models from the board. Rows 011-01 and 011-02 are disjoint and run in parallel; 011-03 is the coordinator's docs work.

## 011-01: `why`, `status` and `failures` read beside a store writer

Use /worker. Shape: repair. Outcome: a CLI read never fails or lies because another process writes the store. Read 011 C6, C7, C13 and the two findings files (`../../001-core-loop/research/issue-7.md`, `issue-8-contention.md`) with their probes. Seam: `src/core/status/why.ts:119`, the `results.byKey(key, 0)` call; first edit: a lookup that reads without the `usedAt` UPDATE, then the same for `src/cli/warmup.ts:294`. Second edit: the busy retry in `withStatusStore` (`src/cli/setup/repo.ts` and its callers) with a bound and an exhaustion message that names the wait and `squeal status --wait`. Owns: `src/core/status/why.ts`, `src/core/store/` read paths it needs, `src/cli/setup/repo.ts`, `src/cli/warmup.ts`, tests under `test/status`, `test/store`, `test/cli`. Leave alone: the daemon (001-435's), hooks, `src/core/delivery`. Done when: the regressions of the board row pass, `squeal run --all --wait` is green, lint and typecheck pass, version raised. Stop: the production lock holder is not this row's.

## 011-02: invalidation reasons come before the paths

Use /worker. Shape: slice, display only. Outcome: a reason that lists many paths is readable and complete on demand. Read 011 C5, C6 and `../../001-core-loop/research/issue-13.md` with `research/probes/issue-13/`. Seam: `src/runners/vitest/moved.ts:68` and `:82`, `stability.ts`'s reason, and `listPaths`; first edit: explanation first, five paths and "N more". Then the `UNKNOWN` detail command in `src/core/delivery/format.ts` and the capped unknown-file line in `src/core/status`. Owns: those files and `test/delivery`, `test/status`, `test/runners/vitest` tests. Leave alone: anything that changes which files become `unknown`; `why.ts` (011-01's). Done when: the row's regression crosses `SUMMARY_MAX_CHARS` and passes, full lists remain in `why` and `--json`, suite green, version raised. Stop: a re-run for runner-only touches is a new row.

## 011-03: design, an explicitly awaited test file is promoted

Coordinator, docs only. Outcome: a C-section the human can accept, answering the four questions in the board row from `issue-14-named-wait.md` and `issue-17.md`. Stop: the human's dated acceptance in `status.md`; code rows are written then, never before.
