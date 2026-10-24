# Wave 28

From main after 0.1.286. Three rows on disjoint seams, run side by side. W1 ships through its own candidate, review and version raise; W2 is a survey that may end in a repair; Q1 writes one file. The coordinator integrates.

## W1: 011-137, a daemon that steps down for newer hooks keeps its running tier's work

Use /worker. Shape: survey, then slice.

Outcome: a daemon that steps down for newer hooks loses no result its running tier finished, and the files it did not finish run in the successor without being picked again.

Read board row 011-137; `research/host-load/2026-10-23.md` (Causes, the step-down line); 011 C4 step 5 and C9 (exits, handover); `tasks/011-30/design.md`, `tasks/011-31/` and `tasks/011-33/` on what a stop and a restart resume.

Survey first, read-only: from a copy of this host's store (copy with `-wal` and `-shm`; never the live file or socket), count for the step-down cancels of 2026-10-23 how many files of each cancelled tier had finished before the cancel, and whether the successor picked the rest again. Put the counts in `tasks/011-137/notes.md`.

Seam: `stepDownNote` and the cancel in `src/core/daemon/lifecycle.ts:460-467` (row 011-31 made a step-down cancel tiers as a stop does). A lead: store the results of files the tier finished before it cancels, then let the successor's queue hold the rest. If the fix makes the successor start later than today, or changes what a stop does, send me a request first with the measured delay.

Owns `src/core/daemon/{lifecycle,daemon,desk}.ts`, the cancel path in `src/core/scheduler/` it needs, `src/runners/vitest/run.ts` cancel causes, their tests, `tasks/011-137/`. Not yours: `test/scheduler/tier-yields-*` (W2), `src/cli/`, `src/core/keys/`, the board, spec text, bundles, version. No `npm run build`. Never run a script under `evals/bin/` or `tasks/*/probe/`.

Done when the row's done-when has a test (a stepping-down daemon's finished files keep their results; its unfinished files run in the successor with no new pick); lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output in your summary, and propose C9 text in the notes.

## W2: 011-169, why a promoted edit did not cut the tier on main CI

Use /worker. Shape: survey; repair only if the cause is real.

Outcome: the one failure of `tier-yields-claim.test.ts:84` on main CI 40055071516 has a named cause, or a measured count shows it is a runner timing flake.

Read board row 011-169; 011 C4 step 5 (what yields a tier) and C15 (promotion); `tasks/011-55/notes.md`; `tasks/011-145/notes.md` (0.1.280's focused turn in `tiers.ts`); `tasks/011-159/notes.md` on `sides()`'s policy.

Seam: `test/scheduler/tier-yields-claim.test.ts:84` polls `tier.cancelled` for 30 s after `promote`. Run that case 200 times alone, then 200 times beside a CPU load of the host's core count (`stress-ng` or a busy loop, under your own process group; stop it by its pgid). Record the event order of any failing run: promote, the cut decision in `src/core/scheduler/tiers.ts`, the claim read.

Owns `test/scheduler/tier-yields-claim*.ts`, `test/scheduler/tier-yields-fixture.ts`, `tasks/011-169/`; a product fix in `src/core/scheduler/tiers.ts` or `yields.ts` only with a regression that fails before it. Not yours: `src/core/daemon/` (W1), the board, spec text, bundles, version. No `npm run build`.

Done when the row's done-when holds. Lint, typecheck and `squeal run --all --wait` pass if you changed code. Paste the counts and the output in your summary.

## Q1: 011-170, quality scan of `squeal--v0.1.273..squeal--v0.1.286`

Use /quality. Shape: quality. Scan spec 011's work landed from 0.1.274 to 0.1.286 against `docs/vision.md` and `docs/styleguide.md`, as `quality/2026-10-23.md` did for 0.1.250 to 0.1.273. 0.1.281 and 0.1.282 were never released, and 0.1.283 is spec 015's; leave 015's code out. Write `011-core/quality/2026-10-24.md`: drop candidates, duplicates and misplaced code, each with its file and line and a proposed row or slice. Edit nothing else.

Known candidates to confirm or reject:
- the `src/cli/status-wait-*` files after 011-146 (`status-wait-paths`, `-focus`, `-focus-answer`, `-focus-lines`, `status-paths`): one decision path or several;
- two readers of the `focused:<worktree>` meta row (`src/core/status/focused.ts`, the CLI's answer);
- `src/core/scheduler/stored-keys.ts`'s header, which still says held fails are not queued (true before 0.1.284);
- the keys read as one (`absentReadAsOne`, 011-158) and 011-105's removal list;
- the duration tie in `reviews/0.1.279.md` N1.

Never run a script under `evals/bin/` or any `tasks/*/probe/`.
