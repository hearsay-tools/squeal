# 005 wave 20: the session start after 0.1.541

Rows 005-102 and 005-103, chosen by the human 2026-11-17 from `research/session-start-cost.md` (rows 3, 4, 5 and 6 of its ranking). Coordinator: session 4d2ecbfc. One worker, two parts, separate commits. Row 005-104 is a researcher (`research/consumer-view-design-brief.md`).

Rules (lessons of `status.md`): no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage here: grep ALL of `test/` for what you change; run each e2e file that reads a path you change directly, one at a time, `timeout 900`. A new line under `src/core/store/**` needs a validity case (`test/keys/key-format.test.ts`); a schema step is append-only (`MIGRATIONS`). Before you report, read Squeal's complete verdict on your changed paths. Write `~`, never a `/home/<user>/` path.

## W1 part 1: 005-102, a start whose registration fails still starts the daemon

Use /worker. Shape: repair. Outcome: when the registration throws (a busy store, any error), the session start still starts the daemon, as main did before 0.1.541.

Read: `research/session-start-cost.md` section 5 ("One finding against that rule"); `src/harness/shared/session.ts` (`startSession`: `ensured` is set before `registerFirst`, and `first.ensure()` runs only after the registration returns); `tasks/005-98/notes.md`.

First edit, as a lead: run the ensure in a `finally` around the registration. Check the same in every start path that registers first: `prompt.ts`, the OpenCode bridge, both Pi starts, Codex.

Done when: a test per start path where the registration throws and the daemon's start was still asked; the hook's exit and output in that case are as on main before 0.1.541; `test/e2e/stop-gap.test.ts` passes.

## W1 part 2: 005-103, a cheaper registration

Outcome: the registration writes the consumer's view in one statement and reads two facts through an index; the rows written and the text are the same.

Read: `research/session-start-cost.md` sections 2 and 3 with their probes (`research/probes/session-start-cost/`, `read-less.mjs`); `src/core/store/repos/consumers.ts:126` (`writeMany`, `ensureCheckId`); `src/core/delivery/delta.ts:113` (`toView`); `registerNow` in `src/core/delivery/delivery.ts`.

1. Seed the view with one `INSERT ... SELECT` from `known_states` in a new store method; `registerNow` calls it where it now calls `views.writeMany` for the seed. Same rows as `toView` gives: prove it with a test that compares both forms on a store with pass, fail, unknown, inherited and imported states and a retired check.
2. A partial index on open runs (the findings' row 6), as a new migration step.
3. The uncounted-files read of the code store (the findings' row 5): the key-only index with the read using it, or a done mark, whichever the findings' numbers and spec 015 favour; say which and why. This file is the code store's (spec 015): keep the change to the one read and its index.

Owns: `src/harness/shared/{session,prompt}.ts`, the OpenCode bridge and Pi start files for part 1 only; `src/core/store/repos/consumers.ts`, `src/core/store/schema.ts` (one appended step), the code store's schema and the one read, `registerNow` (the seed call only), their tests and validity cases. Leave alone: `src/core/daemon/**` (the start's store check is another coordinator's row), `src/core/scheduler/**`, `src/core/delivery/{edits,header,format,late*}.ts`.

Done when: the equality test; query-plan tests that the two reads use their index; a migration test from the released schema; `test/delivery`, `test/store` and the affected harness tests pass; the registration's SQL time on the findings' probe is reported before and after (run the probe on the researcher's store copies only if they still exist; else say not measured).

Final message: per part, what changed; the measured before and after; check results.

## Review brief: candidate 0.1.542

Use /reviewer. Rows 005-102 and 005-103, and the eval result files of 2026-11-17; the range is the candidate's commits over `origin/main` at its base. The repository's history was rewritten on 2026-11-17: use the candidate's own commits, not IDs from older notes.

Decisions made during the work (`tasks/005-103/notes.md`), to hold the code to:

- 005-102: a start whose registration throws still starts the daemon, in every start path that registers first.
- The two indexes are additive, made at open when absent, with no `user_version` raise (the brief's migration step was wrong: a raise makes every released version refuse the store). Made by the daemon's open, never by a hook. An older Squeal reads and writes a store that has them.
- The view seed is one `json_each` statement of the rows the hook read, with check ids from the same read as the states the registration text is made from. Not `INSERT ... SELECT FROM known_states`: under spec 021 D15 the daemon performs the write later, and a state committed between the read and the write would be seeded as told and its news lost.
- The seed lives in `src/core/store/view-seed.ts`, outside the validity bundle.
- `test/evals/atomic-trend.test.ts` lists the 0.1.537 flag (Sol, a4-pending) as accepted: fixed in 0.1.541, 10/10 on its candidate. Two commit IDs in the result files were replaced by their IDs in the rewritten history; the 0.1.541 re-check names a candidate commit that was never on main.

Check: the equality of the seeded view with `writeMany` on every state kind and a retired check; the D15 gap test; the JSON parameter at 32,000 and 200,000 states; an index's creation under a busy store and in a read-only or `create: false` open; the uncounted read with and without its index; a registration that throws at each point, per harness; `test/keys/key-format.test.ts` and the validity cases on the candidate (the worker could not run them: no release tag was an ancestor in its old-history worktree). No full suite; affected files directly; e2e files that read a changed path one at a time, `timeout 900`. Findings file: `reviews/0.1.542.md`, PASS or FAIL, committed. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names.
