# Wave 3: Vitest's child imports in `direct`, and ignored listings in the key

Two rows, in parallel, on disjoint files. They land as one candidate. Workers do not run `npm run build`.

## 016-22 a Vitest child process's imports reach `direct` (goal 6)

Use /worker. Shape: slice. Outcome: an edit of a path that a Vitest test file's child process imported puts that file in `direct`, after a restart and in a second worktree, as node:test and pytest do since 0.1.313.

Read: `spec.md` goal 6 and D4 (its Vitest sentence); 011 C4 step 4 and C12; `src/core/scheduler/observed.ts` (`observedGrowth` marks `ObservedInputs.direct`, for any runner); `test/kit/packs/vitest.ts` (the K10 gap that cites row 016-22).

Starting seam: `src/runners/vitest/observe.ts`, where a run's observed reads become the report's `observed`. Lead for the first edit: fill `direct` with what a child process imported, the way `src/runners/node-test/adapter-project.ts:189` does. First step: send me a request with your design before you build. It must say where Vitest tells a child process's imports apart from its own reads, and which version it raises (`RECORDER_VERSION`, or none, with the reason).

Owns: `src/runners/vitest/**`; `test/runners/vitest/**`; `test/kit/packs/vitest.ts`; D4's Vitest sentence in `spec.md`.

Leave alone: `src/core/**` (016-23 owns `src/core/scheduler/observed.ts` and `src/core/keys/**`); the other packs.

Done when:
- K10's Vitest `direct` assertions pass after a restart and in a second worktree, and the gap is gone from the pack;
- `squeal run --all --wait` is green.

## 016-23 a git-ignored directory's listing keys the test file that read it

Use /worker. Shape: repair. Outcome: a worktree whose git-ignored directory lists other names than the run that made a result does not inherit that result.

Read: the board row 016-23; `reviews/0.1.313.md`, the next-wave input on ignored listings; `spec.md` D4 (the written-directory bound); 011 C3 and C12.

Starting seam: `src/core/scheduler/observed.ts`, `observedGrowth`: a listing goes into `listed` through `listingPath`, but no ignored entry below it is tracked. Lead: find where a listing path's key is hashed, and make it hash the names the listing returned, also for an ignored directory. First step: send me a request with your design before you build. It must name the key change and say whether `KEY_FORMAT_VERSION` moves (`test/keys/key-format.test.ts`).

Owns: `src/core/scheduler/observed.ts`; `src/core/keys/**`; their tests; a new case in `test/scheduler/`.

Leave alone: `src/runners/**` (016-22); `test/kit/**`.

Done when:
- a test with two worktrees: A lists one name and passes; B lists two names and does not inherit A's PASS;
- the written-directory bound's tests pass unchanged;
- `squeal run --all --wait` is green.

## Review of candidate `cand/0.1.316` (016-22, 016-23)

Use /reviewer. Candidate `cand/0.1.316`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: three commits of 016-22 (worker 523b2258), five of 016-23 (worker 411f4070), the coordinator's 011 C3 and C12 sentences, status lines and rows 016-24 to 016-26, the version raise and the bundle commit. Write `docs/specifications/016-extensions/reviews/0.1.316.md` and commit it alone on your branch.

Read: `spec.md` goal 6 and D4; the two briefs above; `tasks/016-23/notes.md`; 011 spec C3 (the listed-directory sentence) and C12 (the recorder); `reviews/0.1.313.md`, its next-wave input on ignored listings.

Check, with proof where you can:
1. 016-22: a module a Vitest test's child process imports puts the test file in `direct` after a restart and in a second worktree (K10's Vitest steps 7 and 13). The test's own reads and imports, and a Worker thread of its own process, mark nothing. A grandchild's import is marked.
2. 016-22 keeps `RECORDER_VERSION` at 4: no key or kept observed set differs from `squeal--v0.1.313`. The harness reports `direct` as wording only (`test/keys/validity/harness/observe.ts`); say whether that hides any difference a key would carry.
3. 016-23: worktree B with other names in an ignored listed directory does not inherit A's PASS; B with the same names does; a restarted A inherits its own PASS. A tracked listing keys as before.
4. 016-23 keeps `KEY_FORMAT_VERSION` at 20: `test/keys/key-format.test.ts` passes, and only the ignored-listing case's keys differ from `squeal--v0.1.313`.
5. The residuals R1 to R4 in `notes.md` hold as stated, each shown by its test or probe, and rows 016-24 to 016-26 describe them. A residual that is worse than stated is a finding.
6. No test that writes into the ignored directory it lists runs at every revision (the written-directory bound and the new first-seen rule together).
7. Cost: Squeal's own tests that spawn the CLI now get direct marks for the `src/` modules it loads. Say whether an edit's work stays within the K-shortest cap (011 C4 step 4).

Run lint, typecheck, the kit files and `test/scheduler/ignored-listing.test.ts` on Node 22 and Node 24, and the locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
