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
