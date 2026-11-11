# 020-W5 R1 notes: repair of review 0.1.432 (B1, B2)

Worker notes for whoever continues the repair or reviews it.

## Seam map

### B1: cancel `prepare` with the gate

- `src/core/code/gate/prepare.ts` `runCommand` owns the command's process group while it runs. It adds one SIGINT and one SIGTERM listener to `options.signals` (`process` when absent), and removes them when the command settles.
- On a signal: kill the group (SIGKILL, as the timeout does), remove the listeners, poll `kill(-pgid, 0)` every 10 ms until no process of the group is left or the 1 s close grace ends, then `raise` the signal. For `process`, `raise` is `process.kill(process.pid, signal)`. No listener of ours is left, so the signal takes its usual action and the process ends as before.
- The command settles only after `raise`. In a test, `raise` only records. It also settles after `raise` when something else keeps the process alive. Then `Ended.cancelled` names the signal, and the note reads `prepare was stopped by SIGTERM after … s`.
- `PrepareContext.signals` passes a test's emitter through `prepareEntry`. The collector passes none.
- `src/cli/code-gate-relaunch.ts` did not need a change. With `--json`, the CLI parent forwards SIGTERM and SIGINT to the gate's child. The child is the process that owns the group, so it kills it and then dies on the signal. The parent then writes nothing to stdout and exits 3, as before.
- Vitest's logger adds its own one-time SIGINT/SIGTERM listeners, which call `process.exit()` after 1 ms (`vitest/dist/chunks/index.*.js`, `addCleanupListeners`). When Vitest is open beside a node:test entry with `prepare`, both listeners run in the same signal event. Ours kills the group first, synchronously. Vitest may then end the process before our poll sees the group gone. A process with a pending SIGKILL runs no more user code, so no write follows.

### B2: the print names only what runs

- `src/core/code/gate/collect.ts`: `storedOf` asks `options.stored` (the stores and the parts, through `collectWithStores`) once per runner with selected files, **before** `tellSelection`. It skips a node:test entry with a `prepare` at the base or the head (`declaresPrepare` in `prepare.ts`), as `knownBefore` did. The old `knownBefore` is now `preparedBefore`, which runs only the `prepare`, after the print.
- `src/core/code/gate/prerun.ts`: `RunnerSelection` gains `run` (the selected files that go to the runner) and `known: { store, parts }`. `files` keeps the selected count. Setups come from the files that run, so the root's setup is named only when a run remains.
- `src/cli/code-gate-prerun.ts` `runnerLine`: when nothing is known, the line is unchanged (`Vitest: 2 test files to run (tests 2)`). Otherwise: `Vitest: 3 test files selected (tests 3): 1 to run, 1 read from the parts, 1 read from the stores`, with `none to run` when every file is known.

## Decisions the brief did not settle

- **SIGKILL, not SIGTERM, for the group on cancel.** This is the same kill as the timeout and the exit path. A graceful SIGTERM to the group first would let a build clean up, but it would need a second timer and still fall back to SIGKILL.
- **Wait for the group, not only the leader.** The first version raised on the leader's `exit`. A descendant could still be running at that moment (seen once under load). Polling the group within the close grace makes "gone before the gate exits" hold.
- **The pre-run line names where known files come from.** `collectWithStores` still adds its later note `N of M selected test files read from the stores` (`src/cli/code-gate-stored.ts`). With the new pre-run line, this note repeats a count. I left it, because that file is outside this repair's files. Removing the note is one loop and two test lines.
- **A head-only `prepare` (`not-at-base`) still counts as "to run" in the print.** It is known before the print that those files will not run. The print still counts them, as before this repair. The review did not name this case. A follow-up can count them in `run` from `declaresPrepare` without running anything.

## Tests

- `test/code/gate/prepare-cancel.test.ts` (unit, with an emitter): both signals kill the command and its descendant before `raise`, the command settles after `raise`, and nothing writes after. The listeners exist only while the command runs.
- `test/cli/code-gate-prepare-cancel.test.ts` (real CLI through tsx): `--json` with SIGTERM gives exit 3 and an empty stdout; text with SIGINT ends on SIGINT. In both, the prepare PID and its descendant are gone at the CLI's exit, and their output files do not grow after it. Red without the fix: both PIDs were alive at exit (temporary worktree at 30c008d10, test copied in).
- `test/code/gate/prepare-cancel-kit.ts`: the endless prepare script, `pidsOf`, `alive` (a zombie counts as gone), `gone`, `beats`.
- `test/code/gate/collect-prerun.test.ts`: all from the stores, all from the parts (no setup, no run, evidence kept), and mixed projects (the root's setup and the running project's are named, the stores-only project's is not).
- `test/cli/code-gate-stored.test.ts` and `test/cli/code-gate-parts.test.ts` read the new line through the real CLI.
- `test/version-sensitive.txt`: the CLI cancel test is exempt. It names node:test but cancels before any `node --test` run.

## Sizes

`prepare.ts` is 317 lines, and `collect.ts` is 475 lines (it was 454 before this repair). `runCommand` and `CancelSignals` could move to a `command.ts` of their own if a later change grows `prepare.ts` again.
