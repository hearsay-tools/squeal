# 001-389: repair of 001-388 (0.1.180's setup failure)

Worker notes, 2026-10-15. Source: `reviews/wave-13bp.md` B1 to B4, spec D4 to D7 as amended by 001-382, `tasks/001-382/notes.md`. Each blocker's review probe is a regression test, red at `ee6f80c2` and green after.

## The fixes

**B1, a rejection during a timeout's cancellation** (`src/runners/vitest/run.ts` `execute`). The timeout branch rebuilt the execution as `{ end: "timed-out", failure, hung: false }` and dropped `rejected`. It now keeps `rejected` through both graces, so the adapter closes the instance. The outward end stays `timed-out` and the graces are unchanged. Such a run also gets a `startupFailure` when no module was queued, so its files go through `failStartup` (blocked, one setup FAIL) rather than the timeout split: the setup really threw, and a cancel does not make a `globalSetup` reject (Vitest only sets `isCancelling` while a setup runs).

**B2, a thrown `null`** (`src/runners/vitest/startup.ts`). `startupFailure` never throws now. A thrown `null`, `undefined` or primitive becomes a serialized error before `toCheckError`: a string keeps its text as the message, and anything else reads `the run rejected with null, not an Error`. An unexpected failure while classifying goes to the run log as a note and gives `null` (the run stays a plain crash). The disposal in `adapter.ts` then always runs. I kept the classification ahead of the disposal rather than moving it after, because it reads `project.config` and `vitest.getRootProject()`, which a closed instance is not promised to keep. The never-throw contract is what guarantees cleanup.

**B3, a shared setup file blamed on a project outside the run** (`startup.ts` `setupOwner`, `src/core/scheduler/setup.ts` `failedProjects`).
- Adapter: only the run's projects (those of `specs`) are candidates, plus Vitest's root project. `Vitest.initializeGlobalSetup` always initializes the root project. A file of the run's projects' setups fails every run project that lists it, so no arbitrary first owner is picked. A file only the root project lists (when the root is not itself a run project) fails every project of the run. When the error names no setup file, or names two different ones, it falls back to every project of the run, as D5 says.
- Scheduler guard: `failStartup` takes only the named projects that have a file in the tier. When the report names none of them, it takes every project of the tier. A failure blamed outside the run can therefore no longer requeue the run's own files. I checked that the guard on its own (adapter fix reverted) stops the review's loop at one failed start.
- Why no same-revision retry remains: every failed start blocks at least one of the run's projects and requeues only the rest. In the one case where a requeued project can fail again at the same revision, the root project's setup is the thrower, and that case is now blamed on every run project in the first start. So a persistently failing setup gives one failed start per revision or `run --all`.

**B4, a recovered setup whose test times out** (`RunCollector.queued`, `run.ts` `startedProjects`, `RunReport.startedProjects`, `composite-runner.ts` merge, `tiers.ts` `recordTier`). The reporter now counts the requested modules Vitest queues (`onTestModuleQueued`). Vitest's `runFiles` awaits every run project's `globalSetup` before its pool queues any file, so once a module is queued, every project of the run has started. `buildReport` reports those projects. `recordTier` passes the setup checks of `startedProjects` ∪ the completed files' projects, whatever the end (timed out or crashed). A run cancelled before any module was queued gives no evidence. `startupFailure` now also requires that no module was queued. Without this, B1's preserved marker would turn B4's forced-kill rejection, which happens after the setup succeeded, into a false startup failure.

## Type changes (additive)

- `RunReport.startedProjects?: readonly ProjectName[]`: projects whose run got past global setup. Absent means only the completed files' projects started, so node:test and pytest need nothing.
- `RunCollector.queued: number` and `moduleQueued(module)` (internal to the Vitest adapter).

## Tests

- `test/runners/vitest/setup-rejection.test.ts`, real adapter:
  - B1: a setup that throws after 150 ms, run with `timeoutMs: 50`, then 10 s. The second run calls the setup again and completes no file.
  - B2: `throw null`, `throw undefined` and `throw "database is down"`, each over two runs. The setup is called again each run, and the message is kept.
  - B3: two projects share `boot.ts`, and only `b`'s file is requested. `startupFailure.projects` is `["b"]` on both runs.
- `test/runners/vitest/setup-recovery.test.ts`, real scheduler:
  - B3: the review's two-project fixture. One failed start at revision 0: a second run throws in `beforeRun`, and the old code ran it at once. The `[b] setup.ts` check fails. `run --all` makes exactly one more start.
  - B4: the setup throws once, then returns. The sole test never resolves, with `runner.timeoutMs` at 5 s. After `run --all` the retry is `timed-out` with no completed file and no startup failure. No failure is left, and the setup check's history is `null → fail`, `fail → pass`.

## Proposed spec wording (for the coordinator)

**D5**: replace "(the one whose `globalSetup` file the error names, else every project of the run)" with: "(among the run's projects, those whose `globalSetup` lists the file the error names, every project of the run when that file is the root config's setup, else every project of the run; never a project outside the run, so a persistently failing setup starts once per revision or `run --all`)".

**D6**: replace "It becomes `pass` when a later run of the project starts" with: "It becomes `pass` when a later run of the project gets past its global setup (Vitest queued one of its files), whatever its tests then do: a test that times out or a run that crashes after the setup still clears it; a run cancelled before any file was queued does not".

**D4**: after "A run whose `runTestSpecifications` rejects closes its instance", add: "also when it rejects during a timeout's or an edit's cancellation, and whatever value it rejects with".

## Not done, for the next worker

- The plugin dist drifts: the four bundle tests (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `pi/package.test.ts`, `opencode/package.test.ts`) fail until the coordinator rebuilds. The version is not bumped.
- The key-format guard fails (`test/keys/key-format.test.ts`, three tests): the guarded sources changed, and no key changes meaning. Format 10 is unreleased (no `squeal--v0.1.18*` tag locally or on origin), so the coordinator's landing commit can re-pin `KEY_SOURCES_HASHES[10]` in place, as `f8f97252` did, once 001-386's sources are in too. At this branch the hash is `23878fba47cd626cc5ac511aca0d8bc7f22517f7ed1a9655428464e4ef3a5233`.
- `test/integration/node-test-packages.test.ts` failed once in the checkpoint and passed on its re-run under the same inputs (Squeal: flaky). It is the file 001-386 is investigating.
- 001-382's gap is unchanged: when every blocked file finds a current result from the store after the retry, nothing runs and the setup check stays `fail`. That stays with 001-368's retry hook.
