# 003 wave 4 briefs

Two rows in parallel on disjoint files, beside 004-12 (scheduler). Read `docs/vision.md`, `docs/styleguide.md`, spec 003 as amended, `status.md`, and `lessons.md` (the 003-19 dogfooding) first. Do not run `npm run build`; the coordinator builds at integration. Keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start. Run the node:test tests on Node 22 and 24 (nvm is installed). Load on this host is high: re-run a failing file alone before calling the failure yours.

## 003-36 the agent is told node:test is covered

Outcome: with `nodeTest` projects configured, the primer and the skill tell the agent Squeal runs those tests too, and `squeal init`'s printed template never collides with an entry it seeded.

Read: `lessons.md` defects 1 and 7; spec 003 goal 8; `reviews/wave-2.md` N1.

Shape: slice. Test first. Seam: `src/harness/shared/primer.ts:15`, the sentence "Squeal runs this repository's Vitest tests [...]; do not run Vitest [...]": name the runners the loaded policy configures (Vitest alone without `nodeTest`, both with it); find how both harnesses build the primer and give it what it needs. Then the skill, identical by hand in `plugins/claude-code/skills/squeal/SKILL.md` and `plugins/codex/skills/squeal/SKILL.md` (lines 3, 8, 12, 16): static text, so it names node:test as covered where `squeal.config.json` lists `nodeTest` projects. Then `src/cli/init.ts` (seed and templates, about lines 127 to 190) and the seeding it calls: a printed template's name is never a seeded entry's name.

Owns: `src/harness/shared/primer.ts` and its tests, both `SKILL.md`, `src/cli/init.ts` and the node:test seeding it calls, `test/cli/init*`. Leave alone: `plugins/*/skills/squeal/references/**`, `src/cli/run*.ts`, `src/runners/node-test/run/**` (003-37), `src/core/scheduler/**` (004-12). If a recorded hook fixture under `test/harness/recorded/` must change, say so in the report.

Done when: primer tests with and without `nodeTest`; the skill text; an init test whose template name differs from the seed; lint, typecheck, full suite.

Use /worker.

## 003-37 with 004-19: what a test file's process loads belongs to that file

Outcome: a module loaded through `createRequire(<non-module>)`, or by a process the test spawns, joins that test file's observed closure instead of the project's preloads; a slow node:test project's spawned processes are recorded; a closure that reaches nothing beyond the file names itself in a note.

Read: `lessons.md` defects 3 and 6; `docs/specifications/004-slow-suites/tasks/004-13/notes.md` (why a spawned CLI is not observed, three places); spec 003 D3, D5; spec 004 D5's recorder sentence; `test/integration/slow-spawn.test.ts`, which pins today's gap.

Shape: slice. Test first. Seam: `observedClosure` in `src/runners/node-test/run/observed.ts:33`: an edge whose parent is `null` or not a loaded module is a preload root only when it is one of the process's actual preloads (the `--require`/`--import` the run or its environment passed); otherwise it belongs to the test file, since one process runs one test file. Graph files of the same run from other processes (`graph-<i>-<pid>`) belong to the test file too. Then `childEnv` in `run/run.ts:165`: for a project with `slow: true` (004-10's `nodeTest[].slow`) the recorder always goes into `NODE_OPTIONS`; fast projects unchanged. Then defect 6: one note per project naming files whose observed closure is only the file and a manifest, suggesting `inputs`. Resolving `readFileSync(new URL(<literal>, import.meta.url))` statically: report whether it is a small change; do not build it here. Raise `NODE_TEST_ADAPTER_VERSION` if keys change, and say so.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`, `test/integration/slow-spawn.test.ts`, new fixtures under `test/fixtures/node-test/`. Leave alone: `src/runners/observe/**` and `src/runners/vitest/**` (001), `src/core/scheduler/**` (004-12), `src/harness/**` and `src/cli/**` (003-36).

Done when: probes as tests (a `createRequire(package.json)` load re-runs only its file; a slow project's spawned CLI helper edit re-runs its file and `slow-spawn.test.ts` flips; a fast project is unchanged); the note test; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 003-40 a preload phase belongs to the project only at the project's own startup (004 reviews/wave-1.5.md S2, S3)

Outcome: what an `eval` Worker or a process the test spawns loads before its entry stays in that test file's closure; only the project's own preloads go to the environment.

Read: 004 `reviews/wave-1.5.md` S2 and S3 and their probes; `tasks/003-37/notes.md`; spec 003 D5 as amended by 003-39.

Shape: repair. Test first: both probes fail on `e9758a6` on Node 22 and 24, each beside an unrelated second file that must not be affected. Seam: the recorder (`src/runners/node-test/runtime/recorder.cjs:34`) tags `preload` only in the test file's own process during the project's startup, never in a Worker started with `eval: true` and never in a child the test spawned (it knows the run's process, for instance by the pid the runner started, or by a variable the runner sets that a child's own startup clears); `observedClosure` (`run/observed.ts:63`) unchanged in shape. Keep both original S1 probes, the slow spawned-CLI test and `adapter-attribution.test.ts` passing. Raise `NODE_TEST_ADAPTER_VERSION` if keys change; amend spec 003 D5 with a dated `status.md` line.

Owns: `src/runners/node-test/runtime/recorder.cjs`, `src/runners/node-test/run/observed.ts`, `src/runners/node-test/adapter.ts` (the version), `test/runners/node-test/**`, fixtures under `test/fixtures/node-test/`, spec 003 D5 and `status.md`. Leave alone: `src/runners/node-test/run/run.ts` and the rest of `run/` (004-18 is running there), the scheduler, the daemon.

Done when: both probes are tests on Node 22 and 24; existing attribution tests unchanged; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 003-26 another worktree's observed growth re-keys this one without a local edit

Outcome: a worktree with no local edit stops holding a pass under a key that lacks a path another worktree observed, within the reconciliation interval.

Read: `reviews/wave-2.md` S2 and its probe; the board row; `src/runners/node-test/adapter-observed.ts` (`refresh`, `grown`, `preloadsGrew`: growth is reported at the next refinement); `src/core/scheduler/runner-work.ts` (refinements); `src/core/daemon/lifecycle.ts` (the daemon's periodic timers).

Shape: slice. Test first: two schedulers over one store with the `hidden.test.ts` fixture; A runs and records `src/hidden.ts`; B, with no edit, re-keys `hidden.test.ts` and runs it within the interval. Seam: a cheap periodic check (a timer in `lifecycle.ts` beside the others, or the scheduler's own) that a `nodeTest.observed.*` meta key changed since this daemon last read it, and if so queues a runner-only refinement through `RunnerWork` (no revision, no content re-key) that calls the adapters' `affected([])` or a new `refreshObserved()` so `Observed.refresh` reports the grown files and the scheduler re-fetches their closures and keys. Idle cost: one meta read per interval; no work when nothing changed.

Owns: `src/core/scheduler/runner-work.ts`, the method this needs in `src/core/scheduler/scheduler.ts` (not `#select`, `#pump` or lanes), `src/core/daemon/lifecycle.ts` (one timer), `src/runners/node-test/adapter-observed.ts`, `adapter-project.ts`, `src/core/types/runner.ts` (additive), their tests. Leave alone: `src/core/scheduler/observed.ts` and `test/scheduler/first-observation.test.ts` (001-148 is running there), `src/runners/vitest/**` (001-150), `src/runners/node-test/runtime/**` and `run/**`.

Done when: the two-scheduler test; a test that an idle daemon with no observed change does no runner work; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 003-41 the observed timer's news is never lost at startup (004 `reviews/wave-2.5.md` B3)

Outcome: growth another worktree records while this daemon's scheduler is still starting re-keys this worktree once the scheduler can act, without a local edit.

Read: 004 `reviews/wave-2.5.md` B3 and its probe; `tasks/003-26/notes.md`.

Shape: repair. Test first: the review's probe (a timer acknowledging preload growth while the scheduler's baseline is held; B keeps an inherited pass with zero runs past another interval) fails at `068f6de` on Node 22 and 24. Seam: `Scheduler.refreshObserved()` (`src/core/scheduler/scheduler.ts:279`) reports whether it accepted the refinement, or keeps a notification that arrives before `#context` and drains it after the baseline; the daemon callback (`src/core/daemon/daemon.ts`) returns that answer, so the timer (`src/core/daemon/lifecycle.ts`) acknowledges a snapshot only once accepted. Not activity, no revision; keep the timer unref'd and cleared on stop, the after-startup two-file control and the no-growth control.

Owns: `refreshObserved` in `src/core/scheduler/scheduler.ts`, the callback in `src/core/daemon/daemon.ts`, the observed timer in `src/core/daemon/lifecycle.ts`, `src/core/types/scheduler.ts` (the method's return type), `test/scheduler/observed-growth.test.ts`, `test/daemon/observed-timer.test.ts`. Leave alone: everything else (the 001 lane runs in `src/runners/vitest/` and `src/core/scheduler/observed.ts`).

Done when: the probe is a test on Node 22 and 24; lint, typecheck, full suite on Node 24 and 22. Do not run `npm run build`; keep scratch in one `/tmp` directory of your own and remove it; no CPU burners.

Use /worker.

## 003-43 a run that observes a new preload path never stores its result under the environment key that lacks it

Outcome: two worktrees that differ only in a file a preload reaches through a computed load never share a node:test key, before or after either one's first run.

Read: the board row; `test/scheduler/observed-growth.test.ts` "the timer re-keys both files on preload growth after B started" (skipped in `fa858a4`, naming this row) and its `twoWorktrees(true)` setup; the 001 coordinator's sequence (below); spec 003 D3, D5; 001-132 and 001-134's growth rule (`src/core/scheduler/observed.ts`: a file's own observed paths join the key its result is stored under, a path first hashed after the run began certifies nothing), which covers per-file paths but not preloads.

Sequence (001-170's report, 2026-10-09): the `nt` project runs with `--require ./scripts/setup.cjs`, which loads `nt/src/hidden.cjs` through a computed `require`; A's `hidden.cjs` sets 1, B's sets 2, and both test files check 1. Both worktrees compute the same keys (`control.test.mjs` `1be48a59…`, `hidden.test.mjs` `03205bf8…`), stable across fresh repositories, and missing `nt/src/hidden.cjs`. B runs first and stores its fails; its run observes the preload path into `nodeTest.observedPreloads`, but its results sit under the environment key computed before. A starts before the timer re-keys anything, gets the same keys, runs, passes, and its passes replace B's rows (001-170: a local pass heals all), so B reads pass. Before 001-170, A inherited B's fail instead.

Also read `docs/specifications/001-core-loop/reviews/wave-13i.md` B2: with 001-170's heal this window became a proven production false current PASS in the worktree that really failed; its deterministic gated ordering (hold A after its first `closure()`, run B to own FAIL, release A) is your probe. The 001 lane withholds healing while a project's environment has unresolved observed growth as a stopgap; this row is the root fix.

Shape: repair. Probe first, test first: re-enable the skipped case, add the review's gated ordering, and a direct test of the two keys. Seam, to confirm: a node:test run's report carries the preload paths it observed beyond the environment it was keyed with, and its results are stored only under the environment key that includes them (as 001-134 does for per-file growth), or not shared with other worktrees until re-keyed. If the fix needs `src/core/scheduler/**` (records, keying, `observed.ts`), stop and send me the seam and the diff you propose before editing: those are the 001 lane's, and 001-171 is in the ledger.

Owns: `src/runners/node-test/**`, `test/scheduler/observed-growth.test.ts`, `test/runners/node-test/**`, fixtures. Done when: the re-enabled case passes 10 of 10 on Node 24 and 22, and the key test shows A's and B's keys differ once either has observed the preload; lint, typecheck, full suite.

Use /worker.

## 003-44 review of 003-43

Outcome: `reviews/wave-4.md` in this spec folder, committed. Range: `git log --oneline 4bc0d444^..70a99c82` on main, 0.1.82 (003-43's commits, the keyedAt fix agreed with the 001 lane, the bundles). 001's commits around it are out of scope except 001-187's `keys.environmentFiles` and 001-186's `keyedAt`, which 003-43 relies on: check that reliance only.

Questions: (1) Can a node:test result still be stored, inherited or refreshed under a key lacking an environment file its run loaded, by any route: the composite runner's merge, a forced full suite in another worktree (001 `reviews/wave-13j.md` B2), a cancelled, timed-out or crashed run, a policy reload mid-run? (2) The discard bound: after `MAX_DISCARDS` the file is unknown naming the paths; can it loop, starve other files, or stay unknown after the environment settles? (3) `rekeyEnvironments` under the lock in `#fly`: can a revision or refinement in between move the keys so the re-read is lost or applied twice? (4) Does `status --wait` hold for the regrown files (`keyedAt: ledger.revision.number`), and can that choice end a wait early? (5) The test edits: `preload-heal.test.ts` (approved by the 001 lane) and `test/integration/node-test.test.ts` (a helper edit re-runs only project c).

Rules as for 003-25: change no code; label findings proven, plausible or unverified; only a proven break blocks; probes under `/tmp`, removed after; never this repository's store, never `/home/agent/projects/cezar`. No CPU burners. First review round on this slice.

Use /reviewer.
