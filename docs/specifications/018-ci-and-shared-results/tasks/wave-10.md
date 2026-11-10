# Spec 018 wave 10: shared results reach a running daemon; recording cost measured by itself

The human, 2026-11-10, after `research/shared-proof.md`: "Squeal fix: Yes" (row 018-28), "CI cost: Self-report row" (row 018-29). The two rows touch disjoint files and run in parallel.

## 018-28 a reader import re-keys at once; status names the cause; default branch without origin/HEAD

Use /worker. Shape: repair.

Outcome: a fresh cezar clone on the CI's Node gets every exported file current at its first daemon start, not only after a restart.

Evidence: `research/shared-proof.md` Q2 and Q3. At the first start 31 of 1,449 exported files were current, 1,449 after a restart; status called the rest "content differs". The reader (`src/core/shared/reader.ts`) imports after the daemon keyed its files; the imported observed entries do not re-key them until a restart. Separately, `upstreamOf` (`src/core/shared/choose.ts:32-48`) needs `refs/remotes/origin/HEAD`; a checkout whose remote was removed and added again lacks it, so the reader stops ("no remote names its default branch").

Read: `spec.md` D11 and D14; `src/core/daemon/daemon.ts` near line 830 (`createSharedReader`, `imported:`); the observation re-key the daemon already does for another worktree's observation (`observedMs`, task 003-26 in `src/core/daemon/lifecycle.ts`); `src/core/status/import-lines.ts`.

Items, each with a failing test first:
1. After an import adds observed entries, the daemon re-keys the affected files in the same pass, as at start (reuse the existing observation re-key path if it fits).
2. Status names that cause (results imported, keys not yet recomputed) instead of "content differs", if any window remains.
3. Without `refs/remotes/origin/HEAD`, the reader finds the remote's default branch another safe way (for example the remote's advertised HEAD through the git call it already makes, or `init.defaultBranch`), with the reader's stop and timer; the note keeps naming `git remote set-head origin --auto` when nothing works.

Owns: `src/core/shared/*`, the daemon wiring around the reader, `src/core/status/import-lines.ts`, their tests. Leave alone: `src/runners/vitest/ci-runtime/*`, `src/core/ci/*` (row 018-29).

Done when: a test with a fixture remote and a published export shows every exported file current after one daemon start; the origin/HEAD case passes; lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.

## 018-29 `squeal ci record` reports its own overhead

Use /worker. Shape: slice.

Outcome: each recording states how much time Squeal's hooks added, so recording's cost in CI is read from each run, not estimated from history.

Evidence: `research/shared-proof.md` Q1: about +16% Vitest shard time from history (95% CI 12 to 21%, n=18 vs 30), against D8's +3% target, unconfirmed.

Read: `spec.md` D8 and D9; `src/runners/vitest/ci-runtime/evidence.cjs`, `descriptors.cjs`, `children.cjs`, `vitest-ci.cjs`, `coverage.cjs`; `src/core/ci/parts.ts` (part format 4), `src/cli/ci.ts`.

Starting seam: time the hooks' own work (hashing reads, writing evidence, the coverage provider's share if separable) per process with `process.hrtime` or `performance.now`, sum it into the part as an optional field, and print one line at the end of `ci record` and in `ci export` ("Squeal's recording took N s of CPU in M processes, P% of the test time"). The field is informational: it never changes keys, the export's content or a refusal. Reading an older part without it stays valid.

Owns: `src/runners/vitest/ci-runtime/*`, `src/core/ci/parts.ts`, `src/cli/ci.ts`, `src/cli/ci-export.ts`, their tests. Leave alone: `src/core/shared/*`, the daemon (row 018-28).

Done when: a test records a fixture run and finds the overhead in the part and in both commands' output; existing ci record and export tests pass; lint, typecheck, `squeal status --wait 60000` on changed paths. No build, no full suite.
