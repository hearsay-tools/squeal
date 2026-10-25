# Wave 2: two worktrees in the kit, then one write path

Two rows, in parallel, on disjoint files. 016-21 lands first, so the kit guards D4 before it lands (`spec.md` Waves). Workers do not run `npm run build`.

## 016-21 kit scenario K10: two worktrees share one store

Use /worker. Shape: slice. Outcome: a kit scenario shows that what one worktree's run observed reaches a second worktree and a restarted adapter, on every runner.

Read: `spec.md` goals 5 and 6, D1 (later scenarios) and D4; `research/observed-paths.md` Q1, Q4 and O6, O9, O10, O11; `test/kit/driver.ts` (today it touches no store).

Starting seam: `test/kit/driver.ts`. First step: before you build, send me a request with your design. It must say how the driver opens a second worktree and a restarted adapter over one scratch store, with no daemon (a non-goal). It must also say how each run's observations take the path each runner uses today: the core's `src/core/scheduler/observed.ts` for Vitest, the injected stores for node:test and pytest.

The scenario: worktree A's run observes a computed import and a child process's import. Worktree B, and A after a restart, see each in `closure()`. An edit of each puts the test file in `affected`, in `direct` for the child's import (row 007-56).

- Today's differences are KNOWN gaps, each with its D4 line. Fix no adapter.

Owns: `test/kit/**`; the `squeal.config.json` `inputs` entries for `test/kit/**`.

Leave alone: `src/**`.

Done when:
- K10 is PASS or KNOWN on every runner;
- `squeal run --all --wait` is green.

## 016-17 one write path for observed paths (rows 007-47, 007-52, 007-56)

Use /worker. Shape: slice. Outcome: node:test and pytest observations reach the store only through the core's path, under the human's three D4 decisions, and `ObservedStore` is gone.

Read: `spec.md` goals 5 and 6, and D4 with its three decisions of 2026-10-25; `research/observed-paths.md`; `research/ignored-paths.md` Q4; 011 C3 and C7.

Starting seam: `src/core/daemon/node-test-runners.ts:30`. First step: before you build, send me a request with your commit plan. Each commit compiles. The plan covers:
- the written-directory bound, with `mkdtemp` recorded as a create;
- the O8 exemption;
- the core's start-up set and `direct` marks (Q4);
- reading the old meta keys while an older daemon shares the store (Q5);
- both adapter-version raises.

016-21 lands first. You remove each of its KNOWN gaps that D4 closes.

Owns: `src/core/scheduler/observed.ts` and its lines in `keying.ts`; `src/core/daemon/{node-test,pytest}-runners.ts`; `src/runners/{node-test,pytest}/adapter-observed.ts` and their trackers; `src/runners/observe/{recorder.cjs,inputs.ts}`; the adapter versions; their tests; `tasks/016-17/notes.md`.

Leave alone: `test/kit/**` beyond the known lists; `src/harness/**`.

Done when:
- goals 5 and 6 hold, each with a test;
- each runner has two ignored-path cases: one kept, one dropped under a written ancestor;
- `test/keys/validity` shows both raises;
- `squeal run --all --wait` is green.

## Review of candidate `cand/016-21`

Use /reviewer. Candidate `cand/016-21`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: one commit of 016-21 (worker 989d130f, `test/kit/**` only), plus this brief. It changes no bundle and raises no version. Write `docs/specifications/016-extensions/reviews/016-21.md` and commit it on your branch.

Read: `spec.md` goals 5, 6 and 8, D1 and D4; the 016-21 brief above; `reviews/016-12.md`.

Check, with proof where you can:
1. K10 plays what the brief says on every runner: two worktrees over one scratch store, a restart, a computed import and a child process's import, and no daemon.
2. Each KNOWN gap names the line that documents it. Each lists only the assertions it fails: an unrelated failure reads FAIL. Read the pytest and node:test slow `direct` gaps (D4), node:test's base form (004 D5), and Vitest's (011 C12 and goal 6).
3. The store, keys and core step that every play now runs move no K1 to K9 verdict. The driver reaches the core only through `src/core/scheduler/observed.ts` and `keying.ts`. The packs alone import `src/core/daemon/*-runners.ts`.
4. Goal 8 still holds: run `reviews/probes/016-12/key-probe.ts`.
5. No sleep and no load dependence in the new steps.

Run the four kit files on Node 22 and Node 24. No locked full suite: the range is test-only and CI runs the suite. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.

## Review of candidate `cand/0.1.313` (016-17)

Use /reviewer. Candidate `cand/0.1.313`, pinned to the SHA named in the spawn. The range is `origin/main..<SHA>`: thirteen commits of 016-17 (worker aa7eeb16), the coordinator's 011 C4 step 4 sentence and status lines, the version raise and the bundle commit. Write `docs/specifications/016-extensions/reviews/0.1.313.md` and commit it alone on your branch.

Read: `spec.md` goals 5 and 6, D4 with its decisions of 2026-10-25; the 016-17 brief above; `tasks/016-17/notes.md` (questions, residuals, assertion changes); 011 spec C3, C4 step 4 and C7; `reviews/016-21.md` S1.

Check, with proof where you can:
1. node:test and pytest observations reach the store only through the core (`src/core/scheduler/observed.ts`, `keying.ts`): no `ObservedStore`, no adapter-owned meta key, no adapter `store` option.
2. D4's written-directory bound on every runner: `mkdtemp` is a create; node:test and pytest record directory creates and removes; each runner has a kept case and a dropped case.
3. `direct` marks: a child process's imports put the test file in `direct` after a restart and in a second worktree, closure paths included (Q5); node:test splits its record by process. The edit cut counts marks among the K shortest, never as a bare source's fallback; more than K marked files give K edits and catch-up.
4. The record transaction: a throw after `seeStartup` leaves no store row, and the next record writes it. Read the two residuals in `notes.md` and say whether each holds as stated. Complexity under 20 in `record-tier.ts`.
5. The three raises (node:test 10, pytest 4, recorder 4) each show a differing case in `test/keys/validity`; `test/keys/key-format.test.ts` passes.
6. Each changed assertion in `notes.md` keeps the claim it had, or follows a D4 decision it names. An unlisted weakened assertion is a finding.
7. The warm-up: a fresh-repo slow Vitest reader of build output gets no "unkeyed" line; a node:test reader still does.
8. K10 runs on the core's union: removing `writeMarks` fails K10 on node:test slow and pytest.
9. 011's model-based scheduler test passes. No column is added to an existing table (011 C7).

Run lint, typecheck, the kit files on Node 22 and Node 24, and the locked full suite: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
