# 015 wave 3: the coverage measures follow D6 and D7

Briefed by coordinator 52e58f23 on 2026-10-24, after 0.1.297. One worker. Sources: the residue in `tasks/015-12/notes.md` and `tasks/R6/notes.md`, `reviews/0.1.297-r2.md` N1, `research/child-processes.md` (015-33).

## W1: 015-39, 015-40, 015-33

Use /worker. Shape: slice. Starts from main at 0.1.297. Outcome: a session hears about `crap` and `uncovered` as it hears about complexity, and a too-big edit is told only when it is the session's.
- Read `spec.md` D5, D6, D7 and D9 with their 2026-10-24 amendments, `status.md` (the coordinator's 015-40 wording line), and the board rows 015-33, 015-39 and 015-40.
- **015-39.** Keep each too-big file's edit revision apart from recount row writes (B5's `RecountRecord.tooBigEdits`), so delivery compares the edit's revision with the session's bound and a second recount keeps the first one's edits. Lead: `src/core/code/pass/pass.ts` and `newTooBig` in `src/core/delivery/code-deliver.ts`.
- **015-40.**
  - **STILL FAIL.** The coverage step marks the edit when a judged function's body hash moved (lead: `judgeFiles` in `src/core/code/crap/`, `markEdited`), so D6's first-edit rule and 015-21's text apply.
  - **Blocking.** `wentOverSince` takes the measures (`src/core/delivery/code-since.ts`). Stop's text names each function's measure (`src/harness/shared/stop-code.ts`). The status line stays complexity only.
  - **Told.** The told line and `squeal code --told` count the coverage measures (`code-told.ts`, `code-format.ts`, `src/cli/code*.ts`).
  - **Summary.** A `crap.threshold` change gets a summary line (`recountLine`).
  - Keep every complexity-only text byte-identical.
- **015-33.** `test/runners/observe/recorder.test.ts` ignores `NODE_V8_COVERAGE`.
- **Owns.** `src/core/code/crap/**`, `src/core/code/pass/**`, `src/core/delivery/code-*.ts`, `src/harness/shared/stop-code.ts`, `src/cli/code*.ts`, `recorder.test.ts`, and their tests. Leave `src/core/scheduler/**` and `src/harness/shared/stop.ts` alone.
- **Done when.** Each row's done-when on the board is a test, red first, and each row is its own commit. Write the D6 and D7 amendment text in `tasks/015-40/notes.md`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not build bundles or raise the version.

## 015-41: review of candidate 0.1.299 (wave 3)

Use /reviewer. Candidate `cand/0.1.299`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>` at 0.1.298: 015-33, 015-39 and 015-40 (W1 above, one commit each) and one build commit (bundles, version 0.1.299; 0.1.298 is the 011 coordinator's). Write `docs/specifications/015-coverage-complexity/reviews/0.1.299.md` and commit it on your branch.

Read `spec.md` D6, D7 and D9 with their 2026-10-24 amendments (015-39, 015-40), `status.md` (2026-10-24), `tasks/015-39/notes.md`, `tasks/015-40/notes.md` and `reviews/0.1.297-r2.md` N1.

Check, with proof where you can:
1. **015-40.** `STILL FAIL` for `crap` and `uncovered` once per state, from the complexity pass's edit mark: never for a body git brought, a recount or an edit judged before registration, and still told when records arrive several edits later. `complexity.blocking` and Stop's text; the told line and `squeal code --told` agree; the `crap.threshold` summary comes once, after the re-judgement, with no crossing told. Every complexity-only text and payload is byte-identical to 0.1.298.
2. **015-39.** N1's two probes; a first count clears `tooBigEdits`; the accepted upgrade limit in `status.md`.
3. **015-33** passes with `NODE_V8_COVERAGE` set.

Run the independent full suite under the host lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`, and paste the result. Name each failing file and whether it changed in the range. Label every finding as proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## R7: repair of review 0.1.299 B1, a git body after an own edit (015-40)

Use /worker. Shape: repair. Resumes worker f0ed5308 on its branch `cez/f0ed5308` (at 32cc16d06). Outcome: a coverage `STILL FAIL` comes only for a body the session wrote.
- Read B1 in `reviews/0.1.299.md`: its four steps are the test.
- **The fix.** Make the coverage edit mark apply to the body being judged. When a later change git brought (the pulled record of 015-38, `src/core/code/pass/pulled.ts`) replaced the body after an own edit, that older edit does not qualify the judgement. Keep an own edit across unrelated revisions and late records. Lead: where `crap/step.ts` reads the complexity edits for the judged paths, and `judgeFiles` in `crap/judge.ts`.
- **Owns.** `src/core/code/crap/**`, `src/core/code/pass/**` (reads only, unless a pulled-record accessor is needed) and their tests.
- **Done when.** B1's sequence beside `test/code/crap/still-fail.test.ts` is red first, then green. It also has an own edit after the pull, which tells `STILL FAIL` again. The delayed-record, pre-registration, too-big and complexity-only tests still pass. Commit it as `fix(R7): … (review 0.1.299 B1)`. Lint, typecheck and `squeal run --all --wait` pass; paste the output. Do not change git's FAIL or recovery rules or any complexity-only output. Do not build bundles or raise the version.
