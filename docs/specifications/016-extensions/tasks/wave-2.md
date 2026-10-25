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
