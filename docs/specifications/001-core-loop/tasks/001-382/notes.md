# 001-382: a run whose setup threw is one known failure, and the next run retries the setup

Worker notes, 2026-10-14. Source: `research/cezar-e2e-setup.md` (the evidence and recommendation), spec D4, D5 (runner-failure path), D6, D7, D8; rows 001-361 (the error's `code` and cause chain), 001-373 (count wording), 001-368 (`squeal retry`).

## The bug, as the fixture reproduces it

Vitest 5.0.3 `TestProject._initializeGlobalSetup` sets `this._globalSetups` before calling any `setup()`, so a throw leaves it set and every later `runTestSpecifications` on that instance skips the setup. Squeal kept the instance after a rejected run. Before this change the new fixture (`test/runners/vitest/setup-failure.test.ts`: `globalSetup` throws once with `code: E_BOOT` and a cause `code: E_OWNED`, then succeeds) gave runs `["crashed", "completed", "completed"]`: the second and third tiers ran on the same instance without a setup, which is cezar's 74 file FAILs.

## What the code does

**Runner (`src/runners/vitest/`).**
- `run.ts` `execute`: a rejected `runTestSpecifications` keeps its error as `RunExecution.rejected` (additive, internal).
- `adapter.ts` `run`: any rejected run drops and closes its instance under `hold.exclusive`, as a broken or hung one is, so the next call starts a new one and Vitest runs the setup again. This is the research's simplest rule: no detection is needed to close, and an instance after a rejection is in a state Squeal does not know.
- `startup.ts` (new): `startupFailure` turns the rejection into `RunReport.startupFailure` when no module and no test reported in the run (Vitest's "one error, no test run"). The project is the one whose resolved `config.globalSetup` file the error's message or stack (or a cause's) names; else every project of the run's files. The error goes through 001-361's `toCheckError` (code, causes bounded at 3 links, 200 chars each), with `phase: "setup"` and the location of the setup file's first frame. `withStartup` replaces the run's `failure` (the run log's `end: crashed (…)` line and `report.json`) with `global setup <file> failed: <message> (<code>); cause: <cause> (<code>)`, so the run log names the cause the stack dropped (research (c)).
- A rejection after a module reported is still the old crash (files `unknown` at their key, D12), but on a closed instance.

**Types (all additive).** `RunReport.startupFailure?: StartupFailure { projects, testFiles, setupFile, error }`; `SetupCheckId { kind: "setup", project, testPath }` joins `CheckId`; `StateSink.setupOutcome` with `SetupOutcome { check, commit, error | null }`; `CheckCounts.setups?`. `testFiles` names the run's files, so the composite runner (003 D7) can carry the field and another adapter's crashed files keep D12's path.

**Scheduler (`src/core/scheduler/`).**
- `tiers.ts` `recordTier`: a file the startup failure names goes to `failStartup` instead of `unknown`. Every tier passes the projects of its completed files (not the failed ones) to `ledger.setups.pass`.
- `setup.ts` (new) `failStartup`: tier files of other projects are queued again (the new instance runs them). The failed projects go through D5's `block` (`failures.ts`), narrowed to the files that were to run (the tier's and the queued ones; current files keep their results) and with forced entries removed from the queue too, since a forced file would start the failing setup again. `ledger.broken` is set, so the next revision or `run --all` re-reads the runner and unblocks (`retryRunner`, `applyRunnerPart`'s `retrying`). Each failed project's setup check fails with the error.
- `SetupFailures` (on `Ledger.setups`): the failing setup checks, restored at bootstrap from `known_states` (`bootstrap.ts` `knownChecks`), and the outcomes owed to the sink, written in `Ledger.commit`'s transaction after retirements.
- `failures.ts` `block` gains an optional `only` filter and returns the files it blocked.

**State and reading.**
- `sink.ts` `setupOutcome`: writes the setup check's known state, `current`, origin `own`, summary and fingerprint from `describeFailure` (so it reads `setup failed: … (E_BOOT); cause: … (E_OWNED)`), with its transition (`first-seen-fail`, later `fail-to-pass`). Nothing goes to `results`.
- `codec.ts` `checkFrom` reads kind `setup`. `check-name.ts`: `[project] <setup file> (global setup)`, `[project] (global setup)` with no file; `parseCheck` round-trips it, so `squeal why "setup.ts (global setup)"` finds it.
- Counts: `countChecks` counts setups apart; `checkPartsText` adds `N global setup(s)`; the delta title and `checksText` use it (they computed tests as total minus file-level). `header.ts` and `snapshot.ts` `breakdown` leave setup checks out of the per-validity check counts: a setup is no test.
- `cli/verdict.ts`: `failures.setups` counts failing setup checks of the listed projects (all, or the named files' projects); `failureCount` includes it.

What it reads like (captured from the fixture):

```
SQUEAL · 1 check changed (1 global setup) at revision 0
Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. Test files without checks: 0 pending, 5 unknown. …

FAIL  setup.ts (global setup)
      first observed: FAIL, seen by Squeal's run at revision 0
      setup failed: Browser E2E environment bootstrap failed (E_BOOT); cause: A cockpit already serves this checkout (E_OWNED)
      at setup.ts:6:23

Full output: squeal why "setup.ts (global setup)"
```

Status: `Known failures: 1 (1 global setup)` with the row `FAIL setup.ts (global setup)` and its summary. Stop: `Known failures: 1 (setup.ts (global setup))`, and `stop.blockOnKnownFailures` blocks on it (it is a current `fail` in `known_states`). `run --all --wait`: no verdict (exit 3) while the blocked files are `unknown`, `failuresText` gives `1 known failure: 1 global setup` once a verdict exists. The blocked files' delivery is D5's UNKNOWN block with the reason `not run: global setup setup.ts failed` (only for files that had known states); the cause is in the setup's FAIL, so it is said once.

## Decision: how the one failure is stored

**A `known_states` row of a new check kind `setup`**, one per failed project (`checks` row: `kind = 'setup'`, `test_path` = the setup file, `full_name = ''`). No schema change and no migration: `checks.kind` is free text.

Why this and not the alternatives:
- Every reader of known failures already goes through `store.knownStates.list` and `toKnownFailure`: status, the registration and deltas, Stop's `decide` and `newsText`, the deny path, `squeal why`. One row reaches all of them with no new read path, which is what the human asked ("one known failure in squeal status, the verdict line and Stop"). Only `verdict.ts` counts per test file and needed the extra count.
- It survives a daemon restart (the row is in the store; `SetupFailures.restore` takes it back in, so the restarted daemon's first run of the project clears it: tested).
- It is in the shared store (D8), so hooks and status read it without a daemon. It is **not** under a key and not in `results`: D8 says a crash is never stored as a result under a key, and a setup failure is caused outside the keyed inputs, so another worktree at the same keys must not inherit it. A worktree whose own setup throws gets its own row.
- A `meta` entry (like the daemon notes) would also survive a restart, but every reader of known failures would need a second source, and `KnownFailure.check` would still need a check identity to print.
- Reusing kind `file` with the setup file's path would read "test file that did not load" and mix into the file-level counts.

**Key format.** No key changes meaning. The D3 guard covers the edited sources, so `KEY_SOURCES_HASHES[10]` is re-pinned in place (unreleased) to `c20d1098…02df89`; the later edits were to exempt directories and the guard stays green.

**Risk to name.** An older Squeal's `checkFrom` rejects an unknown kind (`oneOf`), so a hook of an older build reading this worktree's `known_states` while a setup row exists would fail its read. Only a mixed-version hook and daemon in one worktree hits it, while a setup failure is outstanding. Accepted as unreleased-format churn; the coordinator may prefer a note in the release.

## Clearing, and the hook for 001-368

The setup check passes (`fail-to-pass`, delivered as `PASS  setup.ts (global setup)`) when a later tier of the project completes any file, i.e. the setup ran. It is retried at the next revision (tested: an edit to `src/math.ts`) and at `run --all` with no edit (tested), both through `ledger.broken`.

One gap: if after the retry every blocked file of the project gets a current result from the store (its key matches a stored result, e.g. the agent reverted the edit that queued it), nothing runs and the setup check stays `fail`. In the common case the files the failed run held have no result at their key, so they run and clear it.

**Hook for `squeal retry --reason environment` (001-368).** The setup check is addressable by name (`parseCheck` of `[e2e] packages/web/e2e/environment.ts (global setup)`). A retry of a `kind: "setup"` check should: call `retryRunner(context, ledger)` (unblocks every blocked file when `ledger.broken`), then queue one file of that project with `forced: true` if none is queued, so a run starts the setup even when every file has a current result (closes the gap above). Its pass then clears the row through `recordTier`'s `ledger.setups.pass`, like any started run. No new state is needed: the pending retry is "a forced file of the project queued". The once-per-key rule of 001-368 does not fit a check with no key; per setup check per revision is the natural replacement.

## Proposed spec wording (for the coordinator)

**D4**, after the instance's lifetime sentence (the recreate triggers): "A run whose `runTestSpecifications` rejects closes its instance, and the next call starts a new one: Vitest marks a project's `globalSetup` done before it runs it, so a kept instance would run every later file with no setup (task 001-382, research cezar-e2e-setup)."

**D5**, after the module-loading runner failure: "A run that rejects before any test file reports, as when a `globalSetup` throws, failed to start (task 001-382). Its projects (the one whose `globalSetup` file the error names, else every project of the run) take D5's runner-failure path for the files that were to run: they become `unknown` with the reason `not run: global setup <file> failed`, nothing is stored under a key, and the next revision or `run --all` retries the runner on a new instance. Files of other projects in the run are queued again. The run's failure line names the error with its code and bounded cause chain."

**D6**, in the known-state list: "A failed start is one known failure of the project's **setup check** (`[project] <setup file> (global setup)`), not a failure of each file it kept from running. Its summary is the error's first line with its code and cause chain (`setup failed: … (E_BOOT); cause: … (E_OWNED)`), delivered once. It is a known state of the worktree whose run failed, never a result under a key (D8), so no other worktree inherits it. It becomes `pass` when a later run of the project starts, or by `squeal retry --reason environment` (001-368)."

**D7**: "Known failures count tests, test files and global setups apart (`Known failures: 3 (2 tests, 1 global setup)`); a setup check is in no per-validity check count."

**005 D1 and its quoters** (001-373's list): the new part `N global setup(s)` appears only when a setup failed, so no pinned wording changes today; 001-373 should list it among the count parts.

## Files

New: `src/runners/vitest/startup.ts`, `src/core/scheduler/setup.ts`, `test/runners/vitest/setup-failure.test.ts`. Changed: `src/runners/vitest/{adapter,run,reporter}.ts`, `src/core/types/{check,runner,state}.ts`, `src/core/scheduler/{tiers,failures,ledger,bootstrap}.ts`, `src/core/daemon/composite-runner.ts`, `src/core/state/{sink,check-name,header}.ts`, `src/core/status/{checks,snapshot}.ts`, `src/core/delivery/format.ts`, `src/core/store/codec.ts`, `src/cli/verdict.ts`, `src/core/keys/key-format.ts` (re-pin), `test/scheduler/recording-sink.ts`. Not touched: the spec, the board, the plugin dist (drifts; the three bundle tests fail until the coordinator rebuilds), the version.
