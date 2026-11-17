# 005 wave 21: the per-session view holds what was told, not a copy of every state

Rows 005-105 and 005-106, approved by the human 2026-11-18 ("Yes, after the current change lands"; 0.1.542 landed). Coordinator: session 4d2ecbfc, which also owns the store part since the scheduler coordinator's task ended. One worker, two parts, each its own candidate and review: part 1 lands before part 2 starts.

Source: `research/consumer-view-design.md` (design N: seed the non-pass states, a birth mark per known state), its 16 rules (section 1), its probes (`research/probes/consumer-view-design/`) and its migration (section 4). Read all of it first; build what it recommends, and say where you depart from it and why.

Rules (lessons of `status.md`): no version raise, no `pnpm run build` in your worktree, no full suite. No `user_version` raise: a new table, triggers and indexes are added at the daemon's open when absent, as the write-marker triggers and `STORE_INDEXES` were (a raise makes every released version refuse the store). A new line under `src/core/store/**` needs a validity case (`test/keys/key-format.test.ts`), or lives outside the validity bundle as `view-seed.ts` does. `test/e2e/**` is outside Squeal's coverage here: grep ALL of `test/`; run each e2e file that reads a path you change directly, one at a time, `timeout 900`. A check that needs a commit ID is read from CI, not from a local run. Before you report, read Squeal's complete verdict on your changed paths. Write `~`, never a `/home/<user>/` path; the private-material check also rejects the company name and local project folder names.

## W1 part 1: 005-105, the birth mark (store)

Use /worker. Shape: slice. Outcome: every known state has a birth mark the store keeps without any writer's help, and nothing reads it yet: no behaviour changes.

Build: the table and the two triggers, with `ON CONFLICT DO NOTHING` (the findings: every writer of the states table uses `INSERT OR REPLACE`, which overrides an `INSERT OR IGNORE` inside a trigger); the one-time fill for states that exist; the removed-worktree clean-up list; the read that part 2 needs (a state's birth mark; the checks of a worktree born at or before a mark).

Owns: `src/core/store/schema.ts` and the open path for additive objects, a new store module for the birth mark, `src/core/store/prune.ts` and the removed-worktree list, their tests and validity cases. Leave alone: `src/core/delivery/**`, `src/harness/**`, `src/core/scheduler/**`, `src/core/daemon/**` except the call that makes additive objects at open.

Done when: tests that a rewrite of a state (`INSERT OR REPLACE`) keeps its birth mark, a new state gets one, a retired and re-added check gets a new one or keeps the old as the findings decide (say which); the fill on a store at the released schema, with its time on 1,000,000 synthetic states; an older Squeal reads and writes a store that has the table and triggers (a test with the released bundle if one is at hand, else the SQL an older version runs); a daemon's state commit time with and without the triggers on 32,000 states; `user_version` unchanged.

Final message: the objects as built; the two timings; departures from the findings; check results. Then stop and wait: part 2 starts after part 1 lands.

## W1 part 2: 005-106, the view reads through the birth mark (delivery)

Outcome: a registration seeds the consumer's view with the states that are not `pass` and a registration mark; a check with no view row whose state was born at or before that mark reads as the pass it was. Every delivery, and every one of the 16 rules, is as before.

Build: the seed and the consumer's mark in `registerNow` (replacing 005-103's full seed for new registrations); the reading rule where `planDelta` gets its view; `untold`'s condition; the upgrade path (a consumer registered before the upgrade keeps its full view and reads as today). Spec 001 D6: the one sentence the findings name, with a dated line in `status.md` (the coordinator lands those; give the text).

Owns: `src/core/delivery/{delivery,delta,registered,slots}.ts` and the view's readers, `src/core/store/view-seed.ts`, `src/core/store/repos/consumers.ts`, their tests, the evals parsers only if a text changes (none should). Leave alone: `src/core/delivery/{header,format,late*}.ts`, `src/harness/**`.

Done when: the findings' equivalence probe as a test in the repository: the real `planDelta` on random sequences, the full copy as the reference, zero differences, with a fixed seed and at least 10,000 runs in the suite; a test per rule of section 1; a session registered before the upgrade delivers as today; the mixed-version case of section 4 as a test of what it can miss, so it is on record; the registration's and a delivery's SQL time before and after on 32,000 synthetic states.

Final message: per rule, the test that holds it; the timings; the D6 sentence; check results.
