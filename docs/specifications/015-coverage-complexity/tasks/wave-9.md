# 015 wave 9: a recount and a coverage start keep every turn short

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.317. One worker. Its seam, `src/core/code/**`, is disjoint from 011's wave 40 and 016's wave 4.

## W1: 015-48

Use /worker. Shape: slice. Starts from main. Outcome: no turn of the event loop in a recount or a coverage start is over 100 ms on an incident-size store, and delivery never sees a half-written recount.
- Read `spec.md` D4 (**The pass**, **A file not listed yet**, **The first count**) and D9, board row 015-48, `tasks/015-47/notes.md` "Residue for the next worker", and N1 in `reviews/0.1.311-r2.md`.
- **Lead.** Three costs, each measured on the row: the last `store.transaction` of `runPass` (`src/core/code/pass/pass.ts`, about line 154) writes every state of a recount in one turn (437 ms at load 42), and `coverageStep` follows `await runPass` in the same turn (`pass/index.ts`, `once()`); the first-count check `files.uncounted` at coverage's start is one unit (479 ms cold), which the seed's 32-file batches in `crap/seed.ts` could do; `Seed.follow` reads the moved functions' counts in one call outside the budget and the `Pace`.
- **Owns.** `src/core/code/pass/**`, `src/core/code/crap/**`, and their tests. Read `src/core/code/store/**` through its exports; ask me before a new query, table or index, and never raise `user_version` or a result key. Keep 015-35's first-count rule, 015-36's too-big rule and 015-52's held files as they are.
- **Done when.** The row's done-when, red first: a recount on an incident-size store has no turn over 100 ms (skipped when the host is loaded); the recount, first-count, seed and listing tests pass unchanged; a hook that reads during a recount sees the old states or the new ones, never a mix. Notes go in `tasks/015-48/notes.md`, with the turn times and the load of each measurement. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

**Agreement (2026-10-25, the worker's request `65789ce6`, option (a)).** The worker may add `CodeStateRepo.adopt(worktreeId, staged, measure, removed)` in `src/core/code/store/states.ts` and `types.ts`, with a store test, as its own additive commit before the pass uses it. A quiet pass (first count or recount) stages its new states in budgeted parts under a staging worktree id, then switches them in one transaction and drops the staged rows. Every staged pass first clears its staging id, so a crash's leftovers are never adopted. When `adopt` writes fewer states than were staged (another daemon's prune deleted some), the same switch transaction writes the whole set the old way. No table, index, column, `user_version` or result-key change. An edit pass keeps its one transaction, as residue.

## 015-54: review of candidate 0.1.321 (wave 9)

Use /reviewer. Candidate `cand/0.1.321`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: 015-48 (four code commits and its notes) and one build commit (bundles, version 0.1.321). Write `docs/specifications/015-coverage-complexity/reviews/0.1.321.md` and commit it on your branch.

Read `spec.md` D2, D4 (**The pass**, **A file not listed yet**, **The first count**) and D9, board row 015-48, this file's W1 with its agreement, and `tasks/015-48/notes.md`.

Check, with proof where you can:
1. **No mix.** A reader during a first count or a recount sees the old states or the new ones, never part of each: between parts, at the switch, after a crash between parts (the next pass never adopts leftovers), and when another daemon's prune deletes staged rows between parts (the fallback writes the whole set in the switch).
2. **`adopt`.** It keeps a stored state's last edit as `upsertMany` does, removes every measure of each removed check, and returns the number written. No table, index, column, `user_version` or result-key change. The staging id never equals a worktree id.
3. **Rules kept.** 015-35's first count, 015-36's too-big rule, 015-52's held files and deferred removals, and D2's moves give the same states and transitions as on main. An edit pass, a pull included, still writes in one transaction.
4. **The seed.** `follow` reads within the step budget and the `Pace`; the start's first-count check runs per 32-file unit; no function is judged before every function is seeded.
5. **The bounds.** The new turn bounds in `chain-load.test.ts` and the staged tests hold on this host when it is not loaded, are skipped when it is, and fit CI's bound.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
