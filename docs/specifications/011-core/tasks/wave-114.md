# Wave 114: class-A files wait with `rest()` (row 011-379)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-16 ("Idle sweep: Approve all"). Base: main at 0.1.524 (row 011-377 landed; it edited `test/scheduler/`, which this row waited for). Row 011-378 (the quiet point, in repair) runs beside this row; it already moved `drive-fixture.ts` and the builder of `fresh-worktree-durations.test.ts`: leave both alone, and leave every file row 011-378 changed.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`, every `src/` file.

## W1: row 011-379

Use /worker. Shape: slice. Effort medium.

Outcome: the survey's A1 files wait with `rest()` (the harness's, the side's or the scheduler's) instead of `Scheduler.idle()`, each ending at the same point as before.

Read: board row 011-379; `tasks/011-371/survey.md` ("Method", "Pilot", the A1 list). Class A needs no quiet point (row 011-378).

Lead: the survey's A1 list (25 files) less `fresh-worktree-durations.test.ts` (row 011-378 moved it through `drive-fixture.ts`), plus `group-lanes-fixture.ts` and `wall-fixture.ts`. Each call `x.scheduler.idle()` becomes the matching `rest()`; nothing else changes. Run each file 3 times (one pass is not evidence, survey "Method" 2). A file that fails or whose wait now ends early is class B after all: revert it, and list it in the notes with the failure for row 011-380.

Owns: the A1 files and the two fixtures. Done when: each moved file passes 3 of 3 (load stated); `git grep -n "scheduler\??\.idle(" ` over the moved files shows none; `tasks/011-379/notes.md` lists each file moved or sent to row 011-380; lint, typecheck and `squeal status --wait 60000` on the changed paths.
