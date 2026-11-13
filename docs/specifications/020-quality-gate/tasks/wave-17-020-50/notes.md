# Row 020-50: a Vitest teardown warning says whether the file's result counts (#207)

Worker bf6e6daf, wave 17, base main at 0.1.464 (`f15692098`). Brief: `tasks/wave-17.md`, section "020-50". Research: `../013-vitest-runner/research/issue-207.md`. Ownership widened by the parent in request `516ad242` (reply `2f0f397a`): approach B, the `teardown` option through `src/runners/vitest/index.ts`, `src/core/code/gate/runners.ts` and `src/core/code/gate/collect.ts` in their own commit; the `code-gate.ts` line in its own commit. The parent's conditions: the logger hook passes every message through to Vitest unchanged and is removed on close; an unparseable warning prints nothing new; a test covers the late case.

## What changed

- **Adapter** (`f18ac55bf`). New `src/runners/vitest/teardown.ts`: `teardownFiles(message)` reads Vitest's line `[vitest-pool]: Timeout terminating <pool> worker for test files <paths>.` and gives the absolute paths, `null` for any other message. `hearTeardowns(vitest, hear, note)` wraps the instance's `logger.error`: it calls Vitest's own method first with the same `this` and arguments, then tells `hear` the files of a teardown line. A throw of `hear` goes to `note`, never into Vitest's timer. The hook is removed in `vitest.onClose`: an own `error` is restored, a prototype one is uncovered by deleting the own property. `VitestAdapter` gains a 13th constructor option `teardown?: (files: readonly RelativePath[]) => void`; `#start` hooks each new instance when it is given, with the worktree's relative paths (a path outside the worktree is dropped). The hook holds the listener, `paths` and the note, never the adapter (row 019-19's leak rule).
- **Plumbing, by agreement** (`86475fce8`). `VitestAdapterOptions.teardown` and `SizedVitestAdapter` pass it on; `GateAdapters.vitest`'s options and `openRunners` take an optional `teardown`; `CollectOptions.teardown` gives it to `openRunners`. Nothing else in the three files.
- **Lines** (`3244e37ac`). `src/core/code/gate/evidence.ts`: `teardownLines(warned, testFiles)` and `TeardownWarnings` (`hear` for `CollectOptions.teardown`, `tell(testFiles, write)` once the evidence is final).
- **CLI** (`48f822c4c`, `src/cli/code-gate.ts`, row 020-49's file). Three lines in `gate()`: a `TeardownWarnings`, `teardown: teardowns.hear` in the collect options, and `teardowns.tell(evidence.testFiles, io.stderr)` right after the evidence, before the report. `gate()` stays at complexity 20: the loop lives in the helper. If 020-49's edits to `gate()` collide, the three lines move as they are.

- **Validity cases** (`3d0655e85`, `58582b49b`). The adapter's new lines are on the validity path, so `test/keys/key-format.test.ts` failed with "changed lines no case runs" for `teardown.ts` and `adapter.ts:306–309`. As row 020-43 did for `fileStarted` (`210c737ab`, `3ccfc6b70`): `VitestInput.teardown` (`"hears" | "throws"`, the adapter's 13th argument; what the listener hears is wording), and two cases in `test/keys/validity/cases/adapter/vitest.ts` that run `FAILING`'s passing, failing and unloadable files with `pool: "forks"` and `teardownTimeout: 1`. Keys and outputs equal 0.1.464's; no adapter version moves. The fingerprint-mutation self-test in `test/keys/validity/adapters.test.ts` now lists the two cases among those whose outputs the mutation changes. These are test files outside the brief's list; they are the adapter's tests, shared validity infrastructure, edited the way 020-43 edited them.

Nothing changes in the daemon (it gives no `teardown`), in `RunReport`, in the JSON report, in run logs, in verdicts, in exit codes or in provenance.

## The seam this row found (residue)

The brief's lead put the warning in the Vitest adapter's run evidence (`RunReport`). That misses the common case, so the parent chose the listener instead:

- Vitest 5.0.3, `node_modules/vitest/dist/chunks/index.DpLw24bj.js`: `Pool.run` resolves on the worker's `testfileFinished` message (11519–11527). The termination starts after it, with the timer that logs the line (11554–11558), and is pushed to `exitPromises`, which only `Pool.cancel` awaits (11582), that is the next cancel or `close`. So a run ends, and the adapter builds its `RunReport`, without waiting for its workers to exit.
- With Vitest's default `teardownTimeout` (10 s), a worker of one of the last files that is slow to exit is warned after the run's report, during the instance's close. In the gate the close is `collectEvidence`'s `finally` (`Promise.allSettled(runners.map((r) => r.adapter.close()))`), which ends before `collectEvidence` resolves. So every warning is heard before `code-gate.ts` prints.
- `Vitest.close()` (21474–21510) closes the pool first and runs the `onClose` handlers after, so a hook removed in `onClose` still hears a line logged while the pool closes.
- The pool's logger is the instance's (`createPool`, 11683: `new Pool({...}, ctx.logger)`), and the pool calls `this.logger.error(...)` at the time the timer fires, so an own property set on `vitest.logger` reaches it.
- `closeEmptied` (`src/runners/vitest/empty-closed.ts`) empties `vitest.logger` after the close anyway; the restore in `onClose` matters for an instance whose close is abandoned or still runs.
- Vitest 4.1.10 logs the same line (`cli-api.BK8pd4xc.js:3483`, **read in source code**, not run).

## Decisions the spec did not settle

1. **Listener, not a `RunReport` field** (the parent, request `516ad242`): see the seam above. No core type changes.
2. **The line comes from the gate's final evidence** (`TestFileEvidence.completed` and `failed`), the same evidence the JSON report's `runs[]` is built from, so the line cannot disagree with `completed`/`notFinished`. "Counts" means counts in this report: a completed file counts, failed tests included; a file the report lists as not finished does not, as every file of a crashed run (013 V8: nothing in a crashed run is trusted).
3. **No storage claim.** The line never says stored, kept or saved; storage is the keeper's (D17.3, D17.5). A test asserts no line matches `stor|kept|keep|sav`.
4. **Wording**: `squeal code: Vitest timed out terminating the worker of test/pass.test.ts; the file completed, so its result counts in this report.` With failures: `…, 1 failed test included.` Not counted: `…; the report lists the file as not finished, so its result does not count.` The line does not name the run's crash: the evidence holds completion, not the run's end, and the run's failure already has its own stderr lines (in the research's SIGKILL probe, `unhandled error outside any test file` and its cause).
5. **Several projects**: the warning names a path, not a project. When a path ran in more than one project and only some completed: `the file completed in 1 of its 2 projects, so its result counts in this report for those only`.
6. **No line** for a warned path this command did not run here: one the stores or parts served (`from` set), a node:test file, or a path no evidence names. A line Vitest logs that the parser cannot read tells nothing.
7. **Position**: before the report, right after the evidence, so a terminal shows Vitest's warning, then the explanation, then the report. One line per warned file, as the brief says; Vitest itself prints one line per warned worker, so the count is bounded by Vitest's own output.
8. **Path list split**: Vitest joins the files with `, `. A test path that itself holds `, ` would split wrongly; a piece that does not resolve inside the worktree is dropped, so at worst a line is missing, never wrong. Not handled further.

## Proposed spec text

013 V8, added paragraph:

> Amended 2026-11-13 (row 020-50, #207): Vitest logs `[vitest-pool]: Timeout terminating <pool> worker for test files <paths>.` when a worker it stops after its files ended outlives `teardownTimeout`. The line comes from a timer through the instance's logger only: no reporter event carries it, no task rejects, and the pool awaits the worker's exit only at its next cancel or close, so the line can come after the run's report, while the instance closes. It changes no result: a file's completion still comes from the reporter (V4) and a run's failure from its errors (above). When the caller gives a `teardown` listener (the gate does, the daemon does not), the adapter hooks the instance's `logger.error`, passes every message to Vitest unchanged, tells the listener the worktree files each such line names, and removes the hook in the instance's close handlers, which run after the pool's workers exited. A line it cannot read tells nothing.

020 D7, added after the `runs` bullet's paragraph (or in D3.4, beside the overrun line, if the coordinator prefers stderr lines there):

> Added 2026-11-13 (row 020-50, #207): for each Vitest file whose worker Vitest timed out terminating (013 V8), stderr gets one line before the report saying whether the file's result counts in this report, from its final evidence: `squeal code: Vitest timed out terminating the worker of test/pass.test.ts; the file completed, so its result counts in this report.`, with `, 1 failed test included` when it failed, or `…; the report lists the file as not finished, so its result does not count.` The line says nothing of storage (D17.3). Verdicts, exit codes, provenance and the JSON report do not change.

Proposed `commands.md` text (not edited: outside this row), in the `squeal code --base` paragraph on stderr: "When Vitest warns that it timed out terminating a test file's worker, stderr adds one line for that file saying whether its result counts in this report: it counts when the file completed, failed tests included; it does not when the report lists the file as not finished."

## Done-when to tests

| Done-when | Test |
| --- | --- |
| The passing-file probe shape prints "counts" | `test/cli/code-gate-teardown.test.ts` "says a warned passing file's result counts; pass and exit 0 stay" (real Vitest, one forks worker, `teardownTimeout: 1`, changed `value()`): exactly one line, `…the file completed, so its result counts in this report.`; verdict `pass`, exit 0, `completed` = the file. |
| A separate assertion failure stays failed | same file, "keeps a separate assertion failure failed…": both files completed, `failed` names `real assertion failure`, verdict `incomplete`, exit 3; the failing file's line says `1 failed test included`. |
| A worker killed with SIGKILL reads not counted | same file, "says a warned file of a run whose worker was killed does not count": `completed` empty, both files `notFinished`, the passing file's line says it does not count, no line says it counts, verdict `incomplete`, exit 3. |
| A normal teardown prints nothing new | same file, "prints nothing new for a normal teardown" (Vitest's default 10 s): no teardown line; `test/runners/vitest/teardown-late.test.ts` "tells nothing for a normal teardown"; the existing exact-stderr assertion in `test/cli/code-gate.test.ts` (first case) still passes. |
| Late case (the parent's condition) | `test/runners/vitest/teardown-late.test.ts` "hears it during the close, not in the run's report" (threshold 2 s, the file holds its worker's stop 4 s with `Atomics.wait`, no CPU): nothing heard when `run()` returned, the file heard once `close()` resolved. `test/cli/code-gate-teardown.test.ts` "explains a warning Vitest logs after the run…" (threshold 1 s, hold 2.5 s): the line says it counts, pass, exit 0. |
| Hook passes through, is removed on close, a bad line prints nothing | `test/runners/vitest/teardown.test.ts`: same arguments and identity to Vitest's method, a line logged before the close handlers is heard and none after, an own method restored as it was, a throwing listener goes to the note while Vitest still prints, an unreadable line tells nothing; parser cases. |
| Never infers storage; line rules | `test/code/gate/teardown-lines.test.ts`: counts / not counted / several projects / no line for stored, node:test or unknown paths / no storage words / `TeardownWarnings` dedups and sorts. |

## Checks run

- `pnpm run lint` (`biome check .`): pass, 3,328 files, after `biome check --write` on the changed files (formatting only); again after the validity cases.
- `pnpm run typecheck` (`tsrs --fast --noEmit`): pass, exit 0, at `58582b49b`. `pnpm exec tsc --noEmit -p tsconfig.json`: exit 0.
- Squeal, the new test files: `squeal status --wait 60000 test/runners/vitest/teardown.test.ts test/code/gate/teardown-lines.test.ts` at revision 11: no known failures, both current. `test/cli/code-gate-teardown.test.ts` at revision 12: no known failures, current (24.9 s). `test/runners/vitest/teardown-late.test.ts` at revision 13: no known failures, current.
- Squeal, affected checks of every changed source and the validity harness (`squeal status --wait 500000 src/runners/vitest/teardown.ts src/runners/vitest/adapter.ts src/runners/vitest/index.ts src/core/code/gate/evidence.ts src/core/code/gate/runners.ts src/core/code/gate/collect.ts src/cli/code-gate.ts test/keys/validity/harness/vitest.ts`), revision 17: 623 test files current, 5 known failures. Two were real and are fixed: `test/keys/key-format.test.ts` (changed lines no validity case ran; passes at revision 17 after `3d0655e85`) and `test/keys/validity/adapters.test.ts` (the mutation list; passes at revision 19 after `58582b49b`). After that the worktree has 4 known failures, all the same expected bundle drift, `cli/squeal.mjs differs from the build`, in `test/harness/plugin.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` and `test/harness/codex/packaging/runtime.test.ts`. The committed bundles are built from the old sources; the wave header forbids `pnpm run build` in a worker tree, so the coordinator rebuilds them at integration. 6 test files are `unknown` worktree-wide; they were unknown at session start (lookup-only baseline) and are outside the affected set.

## Checks not run

- `pnpm run build` and the committed bundles (`plugins/*`): not run, per the wave header; the four bundle tests above fail until the coordinator rebuilds.
- No full suite (wave header; `docs/process.md`).
- The research probe itself (`probe.py`) was not rerun; the gate tests take its shapes with the worktree's source instead of the installed 0.1.463.
- Vitest 4.1.10: the line text was read in its source, not run.
- `test/e2e/**` (excluded from Squeal): none touches this path.

## Type changes (all additive)

- `VitestAdapter` constructor: 13th optional parameter `teardown`; `SizedVitestAdapter` the same.
- `VitestAdapterOptions.teardown?`, `GateAdapters.vitest` options `teardown?`, `openRunners` options `teardown?`, `CollectOptions.teardown?`.
- New exports: `src/runners/vitest/teardown.ts` (`teardownFiles`, `hearTeardowns`); `src/core/code/gate/evidence.ts` (`teardownLines`, `TeardownWarnings`).
- No change to `RunReport`, `TestFileEvidence`, `Evidence` or the report format.

## For the next worker

- The spec amendments above are the coordinator's to apply (013 V8, 020 D7 or D3.4, `commands.md` in the three plugin copies).
- Bundles need a rebuild at integration.
- Open, not in this row: whether the daemon should also explain the warning (its run logs and `squeal status` show none today); a teardown error Vitest reports through the `stopped` response (`state.catchError(..., "Teardown Error")`) is a different path, not the logger's line, and this row does not touch it.
