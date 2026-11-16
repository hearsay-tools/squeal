# Wave 115: class-B and class-C files wait at the quiet point (rows 011-380, 011-381)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Idle sweep: Approve all"). Base: main with rows 011-378 (the quiet point, `test/helpers/quiet-point.ts`) and 011-379 (class-A swaps) landed. One worker per slice, three at a time, each on its own file list; the lists are disjoint. Slices are dispatched in this order: B1, B2, B3; then B4, B5, B6; then B7 and C1 to C4.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`, every `src/` file, `test/helpers/quiet-point.ts` (a gap in it is a message to me, with the failing file), and every file outside your slice's list.

## Every slice

Use /worker. Shape: slice. Effort medium.

Read: board rows 011-371, 011-380, 011-381; `tasks/011-371/survey.md` ("Method", your slice's list); `tasks/011-378/notes.md` (the quiet point's contract, "For the next rows"); `GLOSSARY.md` "Rest".

Work: in each listed file, each `x.scheduler.idle()` becomes the builder's `quiet()` (`h.quiet()`, `side.quiet()`), or `settle` for the catch-up family where the file already uses it. A host-clock file that fails may need `quiet({ through: [...] })` for a named wake; a file that keeps a run open on purpose needs `rest()` there. Class C also moves the file to `clock: "virtual"` and moves the clock to each timed wake the probe named, as rows 011-363 and 011-368 did. Keep each case's meaning; a case that cannot keep it is reverted and named in the notes. Run each file 3 times (one pass is not evidence).

Done when: every listed file passes 3 of 3 (load stated); `git grep -nE "scheduler\??\.idle\("` over the listed files shows none; `tasks/011-380/<slice>.md` or `tasks/011-381/<slice>.md` lists each file and any case reverted with its reason; lint, typecheck and `squeal status --wait 60000` on the changed paths (report pending as pending).

## Slices

- **B1** (row 011-380): the survey's B1 list (harness files outside `test/scheduler/`).
- **B2, B3, B4** (row 011-380): the survey's lists (harness files under `test/scheduler/`). B2 also takes `busy-hold.test.ts` (review `011-378-379.md` N1: it waits for the lock to free, not for the run to end, then reads the result; move it to the quiet point or poll the result).
- **B5, B6** (row 011-380): the survey's lists (the catch-up family).
- **B7** (row 011-380): the survey's list; also give each other builder it names a call counter and `quiet()`, as `tasks/011-378/notes.md` "For the next rows" says (about five lines each).
- **C1 to C4** (row 011-381): the survey's lists; virtual clock as above.

## R1 (B1 to B3): review of cand/011-380-b1-b3

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-380-b1-b3` at `fb87ff5822a5356b21c58cb75bee67f61da03034`; candidate CI run 43925583116. Test files and notes only: no `src/` change, no version raise. Range `999390321..fb87ff5822a5356b21c58cb75bee67f61da03034`: workers 53963056 (B1, two commits), 59182a73 (B2, four) and e5d56a10 (B3, two), cherry-picked without conflict. Read: board rows 011-371, 011-378, 011-380; this file; `tasks/011-378/notes.md` (the quiet point's contract); `tasks/011-380/B1.md`, `B2.md`, `B3.md`; `reviews/011-378-379.md` (R2, N1).

Check, each as proven, plausible or unverified:

1. Each listed file's change is `scheduler.idle()` to the builder's `quiet()` and nothing else, apart from the named exceptions; each case keeps its meaning; no file of another slice changed.
2. **The named exceptions:** `backlog-tiers` "cancels a backlog tier for an edit" waits with `quiet({ through: ["pump"] })` (failed every time without it: does the named wake hide a run the case depends on, or is it the run the case waits for?); `busy-hold` now waits at the quiet point after the lock frees (review N1); `busy-merge`'s side uses `quiet()` without `settle`.
3. **Slower hosts.** CI showed with `claims-slow-slot` that a wait that ends at the same point here can end early on a slower runner. Name any file in this range whose wait could still read a result before the run that writes it ends.

Coordinator at the candidate: lint and typecheck pass; six files from the three slices pass (29 tests, load 14); 135 test files still call `scheduler.idle()` (rows 011-380 B4 to B7 and 011-381). Workers: each slice's files 3 of 3 (B1 25 files at load 5 to 22; B2 30 files at load 9 to 20; B3 28 files at load 13 to 25). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/011-380-b1-b3.md` and commit it on your branch.

## R2 (B4 to B6): review of cand/011-380-b4-b6

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-380-b4-b6` at `861c9da471c8be3eade0f306f1a259b8becefbe9`; candidate CI run 43927655040. Test files and notes only: no `src/` change, no version raise. Stacked on cand/011-380-b1-b3 (`fb87ff582`, review PASS, landing after its CI). Range `fb87ff582..861c9da471c8be3eade0f306f1a259b8becefbe9`: workers 8f984d27 (B4, two commits), ce41e077 (B5, two) and 7ad9c303 (B6, two), cherry-picked without conflict. Read: board rows 011-371, 011-378, 011-380; this file; `tasks/011-378/notes.md`; `tasks/011-380/B4.md`, `B5.md`, `B6.md`; `reviews/011-380-b1-b3.md` (on branch `cez/09791541` until it lands).

Check, each as proven, plausible or unverified:

1. Each listed file's change is `scheduler.idle()` to the builder's `quiet()` and nothing else, apart from the named exceptions; each case keeps its meaning; no file of another slice changed.
2. **The named exceptions:** `runs.test.ts` "discards a tier result whose inputs changed during the run" waits with `quiet({ through: ["pump"] })` (the re-run waits on the pump); `adoption.test.ts` case 1 uses `loop.scheduler.rest()` until the daemon loop gets `quiet()` in B7 (does its lookup-only start make that equivalent?); `observed-direct.test.ts` polls the stored mark for up to 30 s until `preload-worktrees.ts` gets `quiet()` in B7; `scheduler-rest.test.ts`'s three cases check `side.current(path)` in place of `idle()` resolving (the worker calls this a little weaker: does it still catch what those cases were written for?).
3. **Slower hosts.** Name any file in this range whose wait could still read a result before the run that writes it ends.

Coordinator at the candidate: lint and typecheck pass; the four exception files pass (25 tests, 8 skipped opt-in probes, load 13); 49 test files still call `scheduler.idle()` (B7 and row 011-381). Workers: each slice's files 3 of 3 (B4 29 files at load 6 to 15; B5 31 at load 8 to 12; B6 30 at load 7 to 10). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/011-380-b4-b6.md` and commit it on your branch.

## R3 (B7, C1 to C4): review of cand/011-380-381

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/011-380-381` at `871cc22c0943e5bc0f323eb7a3dfd54fe632e1b2`; candidate CI run 43933339988. Test files and notes only: no `src/` change, no version raise. Stacked on cand/011-380-b4-b6 (`861c9da47`, review PASS, landing after main's CI). Range `861c9da47..871cc22c0943e5bc0f323eb7a3dfd54fe632e1b2`: workers 9d5a16b9 (B7), a9d6d872 (C1), e635c69e (C2), cc1cbc68 (C3) and 04d9e9e1 (C4), cherry-picked without conflict. After this range no test calls `Scheduler.idle()`. Read: board rows 011-371, 011-378, 011-380, 011-381; this file; `tasks/011-378/notes.md`; `tasks/011-380/B7.md`; `tasks/011-381/C1.md` to `C4.md`; `reviews/011-380-b4-b6.md` (N1).

Check, each as proven, plausible or unverified:

1. **New shared helpers and fixture options:** `test/scheduler/counted-loop.ts` (the daemon loop with counted calls and `quiet()`), `quiet()` in `preload-worktrees.ts`, `test/scheduler/slow-drive.ts` (`SLOW_DRIVEN`, `idleSlow`, `looks`), the optional virtual clock in `promoted-tier-fixture.ts` and `merge-hold-fixture.ts` (default unchanged for every other user), `warm-up-repo.ts` on the virtual clock. Each keeps its other users' meaning.
2. **Waits through a named wake:** the `run --all --force` cases in `forced-requeue` and `strict-lookup` (`pump`: the checkpoint ends on the pump's next pass), C3's host-clock files (`pump`, `claims`), `backlog-slots` (`pump`). Does any named wake hide a run a case depends on?
3. **Clock choices:** C3 keeps four files and C4 keeps `backlog-slots` on the host clock (real-time limits, two daemons, real durations); C2 uses `idleOn` instead of `idleSlow` where the slow lane would run a case's slow tier early. Is each choice right, and is any case's meaning lost?
4. **Changed checks:** C1's "nothing started" checks now run at the quiet point; C4's `tier-yields` case 2 sets the 60 s run time after the start; C2's `slow-activity` reads `h.now()`. None is weaker.
5. **The two follow-ups** from B5 and B6 (`adoption`, `observed-direct`) now wait at `quiet()`.
6. **Slower hosts.** Name any file in this range whose wait could still read a result before the run that writes it ends.

Coordinator at the candidate: lint and typecheck pass; ten files across the five slices, the model test included, pass (49 tests, load 7); `git grep -nE "scheduler\??\.idle\("` over `test/` finds nothing. Workers: each slice's files 3 of 3 (load 7 to 26). CI is the full suite. Host policy as in `wave-85.md`; never the real `HOME`; run vitest with a timeout; leave nothing running. Write `reviews/011-380-381.md` and commit it on your branch.
