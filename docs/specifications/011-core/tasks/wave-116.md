# Wave 116: `Scheduler.idle()` goes (row 011-371)

Coordinator 4c0bbe28, 2026-11-16. Approved by the human on 2026-11-15 (row 011-371) and 2026-11-16 ("Idle sweep: Approve all"). Base: main with rows 011-378 to 011-381 landed: no test calls `Scheduler.idle()`.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Run vitest with a `timeout` and make sure each run ends; state the load with every timing. Stop your Squeal daemon before you finish and leave no process running. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, `package.json`.

## W1: row 011-371

Use /worker. Shape: slice. Effort medium.

Outcome: `Scheduler.idle()` is gone; `rest()` is the scheduler's one wait, and tests wait with `rest()` or the test-only quiet point.

Read: board row 011-371; `GLOSSARY.md` "Rest"; `tasks/011-371/survey.md` (row D); `reviews/011-380-b4-b6.md` N1; `tasks/011-378/notes.md`.

Work:
1. Remove `idle()` from `src/core/types/scheduler.ts` (line 461) and `src/core/scheduler/scheduler.ts` (the method at about line 895, the `#idle` list and its two resolve loops), and anything left with no other use. Check `git grep -nE "\.idle\(\)"` and `"idle"` type picks over `src/`, `test/`, `evals/` and `scripts/` for Scheduler callers (other classes' `idle()` stay). Behaviour preserved: no tier, order, width, status payload, note text, CLI output or key change.
2. Review `011-380-b4-b6.md` N1: in `test/scheduler/scheduler-rest.test.ts` (lines 46, 77, 124), either add a barrier after the stored result and before the scheduler's own work ends and show `rest()` stays pending through it, or narrow the three comments to the record-completion fact the cases now check. Do not put `quiet()` in place of `rest()` in the assertions under test.
3. `GLOSSARY.md` "Rest": drop any mention of `idle()`.

Done when: `git grep -nE "scheduler\??\.idle\(|Pick<Scheduler, \"idle\">"` finds nothing; `key-format` without a raise; lint, typecheck, the model test once, `scheduler-rest.test.ts` 3 of 3, and `squeal status --wait 60000` on the changed paths (report pending as pending); `tasks/011-371/notes.md` says what was removed and which N1 option was taken. This changes `src/`, so the candidate gets a version raise.
