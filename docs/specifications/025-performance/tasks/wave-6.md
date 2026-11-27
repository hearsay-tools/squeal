# Wave 6: benchmark spread, per-call work counts, repository on Vite 8.4.0 (rows 025-25, 025-27, 025-28)

Approved by the human 2026-11-27. Row 025-29 (latency tests local only) is already done by row 021-40
(`remote.alwaysLocal`, released in 0.1.654). Evidence: `research/hook-slowdown.md` (025-26),
`research/bench-provider.md` (025-22). The three rows run in parallel on disjoint files. None edits
`docs/board.md` or runs `pnpm run build` in its tree. Any direct `vitest` run gets `timeout 600`; verify with
`squeal status --wait 60000 <changed-path>...`. Final message: decisions the brief did not settle and the evidence
for each done-when.

## 025-25: the repository runs on Vite 8.4.0 (slice; opus medium)

The installed Squeal on this host is 0.1.654 (Claude Code and Codex caches), which has the 0.1.645 fix, so moving
is safe now. Move `vite` in `package.json`/`pnpm-lock.yaml` from the 8.3.2 pin to 8.4.0; keep 8.3 covered by turning
the test alias into `vite-8.3` (`npm:vite@8.3.8`) in `test/runners/vitest/sources-vite-load.test.ts`; drop the
`minimumReleaseAgeExclude` entry in `pnpm-workspace.yaml` if Vite 8.4.0 is now old enough. Make key-format see a
Vitest/Vite lock move: add `vitest` to the packages the vitest component's dependency lines come from
(`test/keys/validity/components.ts` or `compare.ts`; the 025-23 worker's option A), so the release side installs its
own lock. Owns those files. Done when: typecheck and the Vitest adapter tests pass on 8.4.0;
`test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass (time them); the new test still covers 8.3.

## 025-27: the benchmark names a change only above its run-to-run spread (slice; opus medium)

In `bench/`: paired runs (`--ref` twice or more) default to `--repeat 3`; the scorecard comparison shows each
metric's spread across runs (min to max) and marks a change as noise when the ranges overlap; hook rows show p50
beside p95; each cell records machine speed (the SHA-256 calibration before and after the cell, and CPU steal from
`/proc/stat`) in `cell.json` and prints it. Update `bench/README.md` ("Subsets first" and the scorecard section).
Owns `bench/*.mjs`, `bench/boat-run.sh`, `bench/README.md` and `test/bench/`, not `bench/results/`. Done when: the
bench tests show the noise marking on a stored three-run result (the 025-26 runs under
`research/probes/hook-slowdown/` are real input) and the recorded machine speed; lint passes.

## 025-28: a test that counts the work of each hook and `squeal status` against a real daemon (slice; opus high)

A new test under `test/harness/` starts a real daemon (`squeal start`) on a seeded store like `latency.test.ts`'s,
runs each Claude Code hook and `squeal status`, and counts SQL statements and file calls per call, comparing them
with limits committed beside the test (61 for PreToolUse and 117 for PostToolBatch at 0.1.653, per
`research/hook-slowdown.md`; measure the rest). Reuse the SQL/file counter of
`research/probes/hook-slowdown/` or `research/probes/hook-latency/runtime/`. More work per call must fail on any
machine; fewer must pass with a note to lower the limit. It must not assert time. Owns the new test and its
helper. Done when: the test passes at main, fails when one extra statement is added to a hook (show it), and runs
in under a minute; it is added to `remote.alwaysLocal` only if it reads this machine.

Use /worker.

## Wave 6.5: Squeal's Vitest path has a second Vite 8.4.0 break (row 025-30; repair; opus high)

Moving the repository to Vite 8.4.0 (025-25, candidate `cand/025-wave6` at `93a5faeb5`) turns three tests red that
pass on main with Vite 8.3.2, every run: `test/scheduler/busy-merge.test.ts` (both cases: "expected null not to be
null" at lines 66 and 117) and `test/scheduler/runtime-files-rollback.test.ts` (the result transaction never runs,
`rolledBack` stays false). These tests run Squeal's own source, which already has the 0.1.645 `load` fix, so a
second Vite 8.4.0 change breaks Squeal's runs (observed runtime reads, held keys): users on Vite 8.4.0 lose results
there today. Find every Vite 8.4.0 incompatibility in `src/runners/vitest/` and what it calls (the harness errors,
`h.errors`, and Vite 8.3.8 vs 8.4.0 `dist/node` diffs of the APIs Squeal touches: plugin container, module graph,
environments, `fetchModule`, transform hooks), fix each so both 8.3 and 8.4 work, and add a test per break that
fails on 8.4.0 without the fix (the `vite-8.3` alias keeps 8.3 covered). Then run every test file under
`test/runners/vitest/`, `test/scheduler/` and `test/daemon/` on this tree (Vite 8.4.0) and list any other failure
that passes on main. Owns `src/runners/vitest/`, `src/core/runner-host/` if the break is there, and their tests;
ask before touching other `src/` files. Done when: the three tests pass on 8.4.0; the new tests fail without the fix;
typecheck and the Vitest adapter tests pass. Use /worker.
