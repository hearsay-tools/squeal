# 015 wave 10: an early pass, and the pass's last long turns

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.321. Two workers on disjoint seams. W1 starts at once. W2 times turns, so it starts after 016's eval run ends, to keep its measurements off the evals' load.

## W1: 015-57

Use /worker. Shape: slice. Starts from main. Outcome: CRAP and "no test runs it" tell PASS and RESOLVED as soon as the current records in hand prove them, and failures still wait for every record.
- Read `spec.md` D5, D6 and D9 (**Pending and unknown**, **A pass proven early**, **First judgement**, **Delivery**), the 2026-10-25 lines in `status.md`, and board row 015-57.
- **Lead.** `src/core/code/crap/file.ts` decides a source's condition (pending until every loader has a current record; unknown on a cause). `judge.ts` makes the states and `kindOf` the transitions. `walk.ts` turns a pending or unknown condition into states. A first edit: let a pending or unknown source pass its partial union to the judge, and judge a function `pass` only when that union already proves it.
- **Owns.** `src/core/code/crap/**` and its tests, except `test/code/crap/chain-load.test.ts`, which W2 owns. Leave `src/core/code/pass/**` alone (W2). Ask me before you change a delivered text, a store query or a record.
- **Done when.** The row's done-when, red first. Notes go in `tasks/015-57/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## W2: 015-55 and 015-56

Use /worker. Shape: slice. Starts from main once 016's eval run has ended. Outcome: an edit pass, a pull included, keeps every turn under 100 ms on an incident-size store, and the cause of CI's one 443 ms recount turn is named.
- Read `spec.md` D2 and D4 (**The pass**, **A quiet pass in parts**), board rows 015-55 and 015-56, `tasks/015-48/notes.md`, and `reviews/0.1.321.md`.
- **Lead.** 015-56 first: record which phase each long turn falls in, in `chain-load.test.ts`'s recount, then run it until a long turn shows. For 015-55, the edit pass's last transaction in `runPass` (`src/core/code/pass/pass.ts`) and its first turn (the plan, `oldBodies`, the files rows). The staged parts and `CodeStateRepo.adopt` from 015-48 are the pattern; an edit pass also writes moves, transitions and edits, so its switch must hold them too.
- **Owns.** `src/core/code/pass/**`, `test/code/pass/**` and `test/code/crap/chain-load.test.ts`. Leave the rest of `src/core/code/crap/**` alone (W1). Ask me before a new store method, query, table or index; never raise `user_version` or a result key.
- **Done when.** Both rows' done-when, red first. Notes go in `tasks/015-55/notes.md`, with the turn times and the load of each measurement. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the affected tests' verdict; paste both, and name any check still pending or unknown. No `squeal run --all` and no local full suite: CI runs the full suite (`docs/process.md`, test runs on a shared host, 2026-10-25). Do not build bundles or raise the version.

**Checks from 2026-10-25.** The human's policy of that date (`docs/process.md`, test runs on a shared host) replaces every `squeal run --all --wait` and locked full run in this file's earlier briefs. A worker reads its affected tests through `squeal status --wait`. A reviewer runs targeted checks and reads the candidate's CI. A release waits for passing full-suite CI on the exact commit it tags.

**Agreements for W1 (2026-10-25).** Request `5f7111dc`: a source judged early keeps the signature of the records it read in an optional `early` field of its coverage summary, with no summary version raise; no text change. Progress `0ef8ccd0`, accepted: only a function whose last state is a failure is judged early, and only fail -> pass is written.

## 015-59: review of candidate 0.1.324 (wave 10 W1)

Use /reviewer. Candidate `cand/0.1.324`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: 015-57 (three commits and its notes) and one build commit (bundles, version 0.1.324). Write `docs/specifications/015-coverage-complexity/reviews/0.1.324.md` and commit it on your branch.

Read `spec.md` D5, D6 and D9 (**Pending and unknown**, **A pass proven early**, **First judgement**), the 2026-10-25 lines in `status.md`, board row 015-57, this file's W1 with its agreements, and `tasks/015-57/notes.md`.

Check, with proof where you can:
1. **Sound.** An early pass is never wrong: with records still to come, a function told FAIL -> PASS never reads `fail` again at the same blob, and no failure of any kind is told before every record is in. Records at another blob, or that cannot confirm the source's bytes, are never used.
2. **Told once.** The full judgement does not tell again what the early one told; a source is not judged early again until its records in hand change; a daemon restart judges it early at most once more.
3. **Narrow.** A passing, pending or unknown state, and a failure that only a threshold change passes, keep their last judgement until every record is in. A shown value never rises after an early judgement.
4. **Compatible.** The summary field is additive: an older daemon reads the summary and drops the field. Every text with every record in is byte-identical to main.
5. **Cost.** An edit to a widely imported file does not judge every source again at each arriving record.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R12: repair of review 0.1.324 (015-57, round 1 FAIL)

Use /worker, resumed (worker ad47a8ec). Shape: repair. Starts from your branch `cez/ad47a8ec`. Read `reviews/0.1.324.md`, B1 and B2 with their reproductions.
- **B1.** Two test files can transform one unchanged source differently, so a later record can add executable lines, not only covered ones. While records are still to come, the early CRAP counts every line of the function's own range from the count as a line to cover, and a line no record in hand shows covered as uncovered. The full judgement keeps its calculation and texts. An early "no test runs it" recovery still needs only one confirmed hit. Add the two-transform regression: completing the loaders never raises the early value and never makes the function fail again.
- **B2.** Check early eligibility against the stored threshold whether or not the file is quiet; `quiet` decides only whether a transition is written. Add the recount-plus-threshold regression.
- **Owns.** As W1. No schema, record, provider-version or text change. Keep the per-source early signature and the cost rule.
- **Done when.** Both regressions red on the candidate and green after, the existing early tests pass, notes updated in `tasks/015-57/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## 015-59 round 2: re-review of candidate 0.1.324 after R12

Use /reviewer, resumed (reviewer eed2d522). Candidate `cand/0.1.324-r2`, pinned to the SHA named in the message: the three round-1 commits and R12's three (regressions, fix, notes), cherry-picked onto main at 0.1.323, and the build commit redone (0.1.323 to 0.1.324). 0.1.323 shares no source file with the range. Round 1 stays as `cand/0.1.324` (02fd25325). Write `reviews/0.1.324-r2.md` and commit it on your branch. This is the last round.

Check, narrowly:
1. **B1.** With records still to come, the early CRAP never falls below the CRAP the whole set gives, transforms that add executable lines included; completing the loaders never raises an early value or makes a function told FAIL -> PASS fail again. The full judgement's calculation and texts are unchanged.
2. **B2.** A failure that only a threshold change passes keeps its state through a quiet recount until every record is in.
3. **Kept.** Round 1's "What fits" still holds: records at another blob or unread are never used; only a failing measure is judged early; told once; the summary field additive; the cost rule.

Run one independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result; name each failing file and whether it changed in the range. Verdict: PASS or FAIL; only a proven break blocks.

**Agreement for W2 (2026-10-26, the worker's request `a76cf7e2`).** An edit pass over more than one 32-file part reads, judges and stages in parts, as the quiet pass does. Moves are matched over all files first, and one switch transaction holds the moves, the state adopt, the transition copy, the edit marks, the pulled record and the meta. An edit of up to 32 files keeps its one transaction. One store commit of its own, with a store test, adds three things. (a) `CodeTransitionRepo.adopt`: in the switch it counts the staged transitions, then copies them with new ids (`INSERT ... SELECT ... ORDER BY id`), so a pass transition sorts after anything appended meanwhile; on a short count it copies nothing and appends the whole set per row. The staged rows are dropped a turn later. (b) A staging-only drop, which refuses any id that is not a staging id. (c) `CodeStateRepo.adopt` carries a staged edit mark: the insert takes it, and the conflict update uses `coalesce(staged, current)`; any path that clears a mark keeps that write in the switch. No table, column, index, `user_version` or result-key change. Measured on main at load 21 to 22: the last turn of a pull of 1,263 files took 267 to 337 ms.

## 015-61: review of candidate 0.1.330 (wave 10 W2)

Use /reviewer. Candidate `cand/0.1.330`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: 015-55 and 015-56 (four commits and their notes) and one build commit (bundles, version 0.1.330). Write `docs/specifications/015-coverage-complexity/reviews/0.1.330.md` and commit it on your branch.

Read `spec.md` D2 and D4 (**The pass**, **A quiet pass in parts**, amended 2026-10-26), board rows 015-55 and 015-56, this file's W2 with its agreement, and `tasks/015-55/notes.md`.

Check, with proof where you can:
1. **No mix.** A reader during an edit pass over several parts, a pull included, sees the old states, transitions and edit marks or the new ones, never part of each: between parts, at the switch, after a crash between parts (leftovers never adopted), and when a prune removes staged rows (the fallback writes the whole set).
2. **Same result.** In parts and in one transaction, the pass writes equal states, transitions, edit marks and moves. Transition history per check still reads oldest first, and delivery's last transition per measure is the pass's.
3. **Store.** `CodeTransitionRepo.adopt` copies with new ids and has the count guard; `dropStaged` refuses a real worktree id; `CodeStateRepo.adopt` carries a mark and never clears one. No table, column, index, `user_version` or result-key change.
4. **The CI bound.** On CI, `chain-load.test.ts` and `pull-load.test.ts` bound the main thread's CPU time in the longest turn. Check what `process.threadCpuUsage ?? process.cpuUsage` reads on CI's Node 22: when it falls back to process time, the coverage writer's worker thread counts too. Read the candidate's CI log for the logged values.

Checks (`docs/process.md`, test runs on a shared host, 2026-10-25): lint, typecheck, build with a clean tree, Squeal's affected results and targeted tests for the failure modes above. No local full suite and no `squeal run --all`; CI run 40252500251 on the candidate is the full suite, so name its result or that it is pending. Spec 016's eval run shares the host until about 04:00Z: run each timing test once at most, and repeat no timing loop. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
