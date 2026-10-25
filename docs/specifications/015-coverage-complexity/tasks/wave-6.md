# 015 wave 6: the seed is sliced, and the chain-load test stops failing on runner speed

Briefed by coordinator 52e58f23 on 2026-10-25, after 0.1.309. One worker.

## W1: 015-47

Use /worker. Shape: repair. Starts from main at 0.1.309. Outcome: no coverage turn holds the daemon's main thread over 100 ms at a recount or at coverage's start, and `chain-load.test.ts` no longer fails CI on a slow runner alone.
- Read `spec.md` D9 ("First judgement") and D10, `status.md` (2026-10-25), `tasks/015-45/notes.md` (Residue), `reviews/0.1.309.md` (Inputs for the next wave), `reviews/0.1.297.md` and `reviews/0.1.297-r2.md` (B1, B2: the start and reseed rules), and board row 015-47.
- **First commit, the test.** `test/code/crap/chain-load.test.ts` asserts 100 ms off CI and 250 ms when `process.env.CI` is set. Its log line stays as it is. The 200-sources case read 63 to 119 ms on GitHub's runners at 0.1.309.
- **The seed.** The seed's progress (the list of `crap` states, the counts per file, the upsert of pending states) outlives a step, within `STEP_BUDGET_MS`. No file is judged before its functions are seeded. A recount's judgement stays quiet (R6). Lead: `crap/seed.ts` and its call in `crap/step.ts`.
- Keep one daemon-owned `Pace`. Keep every result or record notification able to revoke a partial map or seed at once.
- **Owns.** `src/core/code/crap/**`, `src/core/code/pass/index.ts`, `src/core/code/store/**`, and their tests. Ask me before you edit anything else, or change a record's bytes, `COVERAGE_PROVIDER_VERSION` or a result key.
- **Done when.** The row's done-when on the board is a test, red first. The seed is measured on 011-197's stores, with the load. Each part is its own commit. Notes go in `tasks/015-47/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## 015-50: review of candidate 0.1.311 (wave 6)

Use /reviewer. Candidate `cand/0.1.311`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: 015-47 (five commits: the chain-load CI bound, the seed over steps, 32-file units, the walk's writes in budget, notes) and one build commit (bundles, version 0.1.311). Write `docs/specifications/015-coverage-complexity/reviews/0.1.311.md` and commit it on your branch.

Read `spec.md` D9 and D10, `status.md` (2026-10-25), `tasks/015-47/notes.md` (with its decisions 1 to 6), `reviews/0.1.309.md`, and `reviews/0.1.297.md` and `reviews/0.1.297-r2.md` (B1, B2).

Check, with proof where you can:
1. **The seed.** It goes on over steps within `STEP_BUDGET_MS`, and no file is judged before every file is seeded. A recount's judgement stays quiet (R6), and B1's and B2's start and reseed rules hold. A recount, coverage switched off or a closed store drops a partial seed; a record or result notice revokes the loader map and keeps the seed only where that is safe. An edit during a seed loses no function and misses no new `fail`.
2. **The walk.** Its writes go 16 files at a time inside the step's transaction. A reader between steps sees either the step before or the whole step, never a half-judged summary.
3. **The test.** `chain-load.test.ts` asserts 100 ms off CI and 250 ms when `process.env.CI` is set; its log line is unchanged.
4. One daemon-owned `Pace` stays. Final states match main's after the same inputs. Records, result keys, `COVERAGE_PROVIDER_VERSION` and every complexity-only text are byte-identical to main.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R10: repair of 015-47 after review 0.1.311 (B1)

Use /worker, resumed (worker 34afe933). Shape: repair. On your branch `cez/34afe933`; the coordinator cherry-picks the commits onto `cand/0.1.311`. Outcome: a function present when a seed began keeps its quiet first judgement when an edit renames or moves it before the seed reaches its file (D2, D9), and a function an edit really added still reads as a first-seen fail.
- Read `reviews/0.1.311.md` (B1, its reproduction and "Inputs for the repair") and your notes' decision 3, which B1 overturns.
- **Lead.** `functionsOf` in `crap/seed.ts:103-104` matches the seed's original names and occurrences; follow the moves the complexity pass recognized (same body hash, D2) for files the seed has not reached. Do not seed every current function after each edit: that hides real new fails.
- **Owns.** As in W1: `src/core/code/crap/**`, `src/core/code/pass/index.ts`, `src/core/code/store/**`, and their tests. Ask before anything else. 015-49's worker edits `pass/too-big.ts` and the failed-count write in `pass/**` by agreement; stay out of those.
- **Done when.** Red first, through `createCodePass`: a same-file rename and a cross-file move before either source is seeded stay quiet; the same after seeding stays quiet; an added function still fails first-seen. Seed budget, immediate result and record invalidation, the 16-file walk batches and the one `Pace` stay. Decision 3 in `tasks/015-47/notes.md` is rewritten. Lint, typecheck and `squeal run --all --wait` pass; paste the output. No bundles, no version.
