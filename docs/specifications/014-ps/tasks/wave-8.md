# 014 wave 8: the quality scan's rows

From `quality/2026-10.md` and the human's two decisions of 2026-10-22: drop `leftover-temp` and `--leftovers`, with 014-36; run this wave after the 6b evals end. One candidate, one review, one release. Workers: `--runner claude --model opus --effort xhigh`. Verdict: `squeal run --all --wait`; no `npm run build` in a worker tree.

Order: 014-45, 014-36 and 014-41 run in parallel on disjoint files. 014-42 and 014-43 take one worker, started on the integration branch after 014-45 is on it, because they share `discover.ts`, `flags.ts`, `proc.ts` and `model.ts` with it.

## 014-45 drop `leftover-temp` and `squeal ps --leftovers`, then the slices

Use /worker. Shape: slice, subtraction first. **Outcome:** `squeal ps` has no `leftover-temp` flag and no `--leftovers` option; the files section keeps `stale-socket` and `stale-pool-mark`; then slices 1 to 8 of `quality/2026-10.md` (row 014-44). **Read:** `quality/2026-10.md`, drop candidate 1 and the slices; spec goal 4, D1, D7, D8. **Seam:** delete `src/core/ps/flags-leftovers.ts`; move `names` and `lstatOrNull` into the shared module of slice 5; remove `cwds` and `unixSockets` from `source.ts`, `proc.ts` and `darwin.ts`, `PsUnknown.paths`, and the `--leftovers` path of `src/cli/ps.ts` (an unknown option now: exit 2). The shape stays `v: 1` unless a reader breaks; name it if one does. One commit for the drop, then one per slice. Leave `work.ts` to 014-41, slice 1's `lastSeenAt` included. **Owns:** `src/core/ps/` but `work.ts`, `src/cli/ps.ts`, `src/cli/ps-index.ts`, `test/ps/`, `test/cli/ps*.test.ts`, `test/e2e/ps.test.ts`, the one line of `src/core/capacity/cores.ts` that builds a `Sample`, if slice 4 needs it (011-98's file; 04a258b0 agreed, 2026-10-22), and the spec text on leftovers (goal 4, D1, D7, D8). **Done when:** `grep -rn leftover src/core/ps src/cli/ps.ts` finds nothing; `squeal ps --leftovers` exits 2; `test/harness/ps-bundle.test.ts` passes; each slice meets its own done-when.

## 014-36 the test suite removes the temp directories a killed run left

Use /worker. Shape: slice, probe first. **Outcome:** a run killed after its tests made temp directories leaves them under one parent, and the next run removes it. **Read:** `quality/2026-10.md` row 014-36. **Seam:** `test/global-teardown.ts` (the suite's `globalSetup`) and its `sweepDeadRuns`. First step: a probe that a fork worker's `os.tmpdir()` follows a `TMPDIR` set in the global setup. **Owns:** `test/global-teardown.ts`, its test, and the `globalSetup` line of `vitest.config.ts` if it must change. **Leave alone:** `src/`, every test helper, `test/ps/`. **Done when:** the row's done-when in `quality/2026-10.md`.

## 014-41 `squeal ps` reads the store's meta rows through the store's own decoders

Use /worker. Shape: slice. **Outcome:** `work.ts` defines no meta decoder. **Read:** `quality/2026-10.md` row 014-41. **Seam:** `src/core/ps/work.ts` `tokenOf`, `slowOf`, `lanesOf`, `harnessOf`, `aliveOf`; each writer's module exports its value decoder (lead: `readDaemonUsed` in `src/core/daemon/last-use.ts`). **Owns:** `work.ts`, the export lines in `src/core/store/repos/worktrees.ts`, `src/core/store/repos/runs.ts`, `src/core/slow/state.ts`, `src/core/slow/slot.ts` and `src/core/delivery/harness-process.ts`, slice 1's `lastSeenAt`, their tests. **Leave alone:** the rest of `src/core/ps/`. **Done when:** the row's done-when.

## 014-42 and 014-43, one worker

Use /worker. Shape: slice. Starts on the integration branch once 014-45 is on it and 011's wave 12 (0.1.261) is on main, rebased onto that main: 0.1.261 rewrites `src/harness/shared/ensure.ts` and changes the lock wait in `src/core/daemon/open.ts` (011-32), so 014-43 (h) reads the lock waits as they stand after it (04a258b0, 2026-10-22). **Outcome:** one reader of the installed Squeal versions (014-42), and no restated name or bound in `src/core/ps` (014-43 (c) to (h); (a) and (b) went with the drop). **Read:** `quality/2026-10.md` rows 014-42 and 014-43. **Owns:** the files those rows name, and spec D7's `no-lock` line. **Done when:** both rows' done-whens.

## 014-46 review of wave 8

`/reviewer` on the candidate, `--runner codex --model gpt-6.1-sol --effort high`.
