# 015-58: why every function of a validity harness file reads "no in-process test reaches it"

Use /researcher. Briefed by coordinator 52e58f23 on 2026-10-25.

**Question.** In the coordinator's worktree at revision 251 (main `d8de0754a`, Squeal 0.1.321, coverage on), `squeal code test/keys/validity/harness/assemble.ts` lists all 16 functions as "no in-process test that Squeal runs reaches it", `assemble` included, with CRAP up to 306. A pull delivered `FAIL CRAP` and `FAIL uncovered` for `relist` (line 150, new in 016-24). Is this true, or a false failure? Spec 015 D9 says a false failure is the defect the pending rule exists to prevent.

**Find out, with evidence from the real stores and code, read-only:**
1. Which test files load `assemble.ts` (C3's closures), and whether any of them runs `assemble` in the Vitest worker's own process.
2. For each of them: its current result, whether it has a coverage record at that key, and whether the record names `assemble.ts` and at which blob.
3. Why D9 judged the functions `fail` and not `pending` or `unknown`: the loader conditions `src/core/code/crap/file.ts` saw, and the join in `join.ts`.
4. How many other sources on this host read "no in-process test reaches it" for the same cause.

**Read.** `spec.md` D8 and D9, `research/child-processes.md`, `src/core/code/crap/` (`file.ts`, `join.ts`, `walk.ts`), `src/core/code/coverage/`. Stores: `<common-dir>/squeal/code.sqlite` and the main store, read-only, through `sqlite3 -readonly` or Squeal's own read commands.

**Rules.** No writes to any store, no daemon restarts, no edits outside `research/`. Never run `evals/bin` scripts. Do not make CPU load.

**Done when.** `research/validity-harness-uncovered.md` is committed: the cause with evidence, true or false failure, how many functions it affects, and a recommended fix with its owner (015 or another spec).
