# Wave 48

From main after the quality scans of 2026-10-26 (`83b5f8de9`), 2026-10-26. Two rows on disjoint seams, both from `quality/2026-10-26-a.md` and `-b.md`. Rows 011-234, 011-235 and gh-99 wait for the human; 011-238 and 011-241 touch the named wait and wait for 011-234's decision; 011-240 may wait for a key-format raise. Host load is about 4 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-239, one HEAD reader, and the idle pass reads HEAD in reftable repositories

Use /worker. Shape: slice. Row 011-239; `quality/2026-10-26-a.md` slice 6, `quality/2026-10-26-b.md` slice 9, `tasks/011-201/notes.md`.

Outcome: one function reads HEAD (git directory, else `git rev-parse --verify -q HEAD`, exit 1 as unborn), and the idle pass uses it, so a reftable repository writes no `head-move.` row when HEAD did not move.

Seam: `passHead` (`src/core/watcher/candidates.ts:177-182`). First edit, offered as a lead: move it beside `readGitHead` in `src/core/status/git-head.ts` as an async `gitHead(root)`, then call it at `src/core/scheduler/head-move.ts:18`, in `readHead` (`src/core/daemon-loop/head.ts`) and in `treePrint` (`src/core/delivery/stopped.ts`). Keep `readGitHead` and `statusIdentity` synchronous and free of child processes.

Owns those five files and their tests. Not yours: `src/core/retry/`, `src/core/store/`, `src/core/daemon/`, `src/runners/`, `test/scheduler/model-*` (W2), `src/cli/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when a reader that gives `null` from the git directory makes the idle pass write no `head-move.` row while HEAD stays; a reftable fixture where Git can make one (skipped here, Git 2.43); `grep -rn "rev-parse --verify -q HEAD" src` finds one place; the watcher, daemon-loop and delivery tests pass.

## W2: 011-242, dead helpers gone and one owner for repeated rules

Use /worker. Shape: slice. Row 011-242; `quality/2026-10-26-b.md` slices 1, 2, 4 to 8, 10 and 12 (slice 3 is 011-241's, 9 is W1's, 11 is done).

Outcome: each slice as the scan words it, with no line, JSON field, key or adapter version change.

Seam: start with slice 1, `publishedYields` (`src/core/scheduler/yields.ts:513-520`), then the slices in order, one commit each.

Owns the files the slices name: `src/core/scheduler/yields.ts`, `src/core/status/next-step.ts`, `src/core/retry/records.ts`, `gate.ts`, `text.ts`, `src/core/scheduler/retries.ts`, `src/core/status/outstanding-text.ts`, `src/core/text.ts`, `src/core/state/slow-text.ts`, `src/core/store/open.ts`, `src/core/daemon/open.ts`, `store-file.ts`, `test/scheduler/model-*`, `src/core/types/runner.ts`, comments only in the three runners' `run.ts`, and their tests. Not yours: W1's five files, `src/cli/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when each slice holds; `test/keys/key-format.test.ts` passes with no version moved (comments on a validity path included); the model test gives the same output before and after slice 10; the affected tests pass.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. Squeal's selection of a source path can miss readers (row 011-233): run each test file that imports a changed module directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the slices, the evidence and the commits. Make no CPU load on purpose.
