# Toolkit latency wave: rows 011-116, 011-117, 011-118 and 007-55

From `research/edit-latency.md` (011-115) and `research/watch-mode-comparison.md` (011-119). The human (2026-10-22) held these rows until 011-119; it found Squeal right in 100 of 100 steps where `vitest --watch` gave 15 false passes and testmon 3, and every slow case came from the catch-up route. Workers: `--runner claude --model opus --effort xhigh`. No version raise and no `npm run build` in a worker tree; the coordinator raises and builds at integration. Verify with `npm run lint`, `npm run typecheck` and `squeal run --all --wait`.

Wave 15 (coordinator 04a258b0) owns `yields.ts`, `sharing.ts`, `tiers.ts`, `scheduler.ts`, `setup.ts`, `store-results.ts`, `hold.ts`, `hold-rows.ts`, `daemon-loop/head.ts`, `revision/reconcile.ts`, `status/open.ts`, `delivery/attribution.ts`, `types/store.ts` and parts of `ledger.ts` (`settle`, `commit`) until it lands (cand/0.1.266). No row here edits them; 011-118 builds on the candidate's `ledger.ts` where it must touch those parts.

## 011-116: what an edit reaches is the edit's work, up to the cut

Use /worker. Shape: slice. Outcome: a test file that an edit reaches only transitively or through an observed read or listing runs as the edit's work, under the same cut, not as catch-up.

Read: 011 C4 step 4 (as amended for 011-25), `research/edit-cut.md`, `research/watch-mode-comparison.md` 3 and 5.2. Seam: `editWork` in `src/core/scheduler/edit-cut.ts`; today `others` draws only from `direct`. Lead: draw from what the revision reached (direct importers first, then transitive importers and observed readers), shortest first, unknown last, and keep the `runner.tierSize` cap. A file reached only through a declared `inputs` glob stays catch-up. Own `edit-cut.ts`, `refinement.ts` if needed, `test/scheduler/edit-cut*.test.ts`, and one C4 step 4 sentence.

Done when: with every pool permit held by another holder, an edit of a file that one test reads at run time starts that test's tier within the edit bound, and no quiet holds it; a transitive importer under 1 s shares the edit's tier instead of a backlog tier; declared-input-only readers stay catch-up; an `edit-cut*.test.ts` assertion changes only where it held a transitive importer or reader as catch-up, with a comment naming this row.

## 011-118: a checkpoint counts a file made current by a lookup as done

Use /worker. Shape: repair. Outcome: `run --all` completes once its last file is current, whether a run or a lookup made it so.

Read: 011 C4 Explicit checkpoints; `research/edit-latency.md` 1 and 3 (E8, and the open question on revisions 69 and 73). Seam: `src/core/scheduler/checkpoints.ts` (`done`) and its callers in `src/core/scheduler/ledger.ts`. Lead: find the lookup path that makes a file current without reaching `checkpoints.done`. Own `checkpoints.ts`, `ledger.ts`, `test/scheduler/checkpoint*.test.ts`.

Done when: E8's sequence as a scheduler test (a `run --all` while the file runs on a scratch-file key, then the scratch file removed) completes the checkpoint at the lookup; `notes.md` in the worker tree says whether the revisions 69 and 73 pending state is the same defect, or proposes a row for it.

## 007-55: pytest sees the imports of the Python processes a test starts

Use /worker. Shape: slice. Outcome: an edit of a module that a test reaches only through `python -m` or a console script re-keys and runs that test, and a break there fails it.

Read: 007 D4 and D6, `research/edit-latency.md` 2 (E9), and how `src/runners/observe/spawn.cjs` follows Node children. Seam: `src/runners/pytest/runtime/squeal_pytest.py` and `src/runners/pytest/adapter-observed.ts`. Lead: the plugin sets an environment variable with the current test file and a startup hook on the child's `PYTHONPATH`, so that each child records its import edges under that test file. The edges count as direct importers. Own `src/runners/pytest/**`, `test/runners/pytest/**`, its fixtures, and the 007 D4 and D6 text.

Done when: a fixture test runs `subprocess.run([sys.executable, "-m", "pkg"])`, and an edit of `pkg/cli.py` re-keys and runs it; a break there fails it; a console-script entry point passes the same test; the tests pass on Python 3.10 and 3.13.

## 011-117: editor scratch files cancel no tier and start no quiet

Use /worker. Shape: slice. Outcome: a revision whose only changes are editor scratch files re-keys as now, but cancels no tier in flight and starts or restarts no quiet.

Read: 011 C2 and C4 step 5; `research/edit-latency.md` 1 and 3; `research/watch-mode-comparison.md` 3 (14 s thrown away and a 20.3 s quiet per vim open). Names: vim `.<name>.sw[a-p]` and `4913`, emacs `.#<name>`, untracked and not ignored. Seam: `cancelsBacklog` in `src/core/scheduler/backlog.ts` (a scratch-only revision changes no input that counts), and `quietQueued` in `quiet.ts` with its caller in `src/core/scheduler/revision.ts`. Own `backlog.ts`, `quiet.ts`, `src/core/scheduler/revision.ts`, one new module for the names, their tests, and one C4 step 5 sentence. Leave `refinement.ts` and `edit-cut.ts` (011-116) and `yields.ts` (wave 15) alone; if you need a change there, ask the coordinator.

Done when: create and remove `D/.x.swp` (and `D/.#x`) while a backlog tier of a file that lists `D` runs; the tier completes and stores, and no quiet starts. A real edit in the same revision still cancels. A result whose listing differs at its end is still discarded.
