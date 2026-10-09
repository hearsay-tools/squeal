# 003-26 notes: observed growth without a local edit

The path, end to end:

1. `startTimers` (`src/core/daemon/lifecycle.ts`) reads `nodeTest.observed.<p>` and `nodeTest.observedPreloads.<p>` for each `policy.nodeTest` project every `observedMs` (5 s). That is two point reads per project. It sets no timer when there is no project.
2. On a change it calls `observedChanged`. The daemon's callback answers false until `#loop` exists, so a change made before the scheduler runs is asked about again on the next tick. It never touches `#lastActive`.
3. `Scheduler.refreshObserved()` calls `RunnerWork.queueObserved()`. Nothing is queued if a refinement is already waiting, because that refinement will ask the runner the same questions.
4. The queued task is `#refine`, run over the current revision with `changes: []` (`unchanged()`) and `refined: null`. `fetchRunnerPart` calls `invalidate([])`, which reports preload growth as `recreatedProjects`, and `affected([])`, which reports the grown test files as transitive. `applyRunnerPart` re-keys them and `ledger.commit({})` records no refined revision.

The adapters needed no change. `Observed.refresh` was already called from `invalidate`, `affected` and `closure`.

Every daemon whose worktree's key changed runs one such refinement, including the worktree that wrote the key. There, `refresh` finds nothing new, so the cost is the two runner calls with an empty list. This happens only when an observed set grows.
