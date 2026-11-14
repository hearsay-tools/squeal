# Row 011-336: tests wait for their writers before they remove a folder

Worker 398af59b, 2026-11-14. Brief: `../wave-87.md` W1; repairs `../wave-87.5.md` W1 after review `../../reviews/011-336.md` (B1, S1) and W2 after re-review `../../reviews/011-336-r2.md` (B1). Research: `../../research/enotempty-cleanup.md`. Tests only: no `src/**` change.

Step 3 below is as amended by the repairs; "Repair of B1 and S1" and "Second repair of B1" say what each changed.

## What each step changed

1. **`removeTree(dir, { timeoutMs, intervalMs, remove })`**, `test/helpers/remove-tree.ts` (commit `fbdb7e7b1`). It repeats the whole `rmSync(dir, { recursive: true, force: true })` until `dir` is gone. It also repeats when a removal succeeded but a writer made `dir` again. It retries the codes Node's own `rmSync` retries (`EBUSY`, `EMFILE`, `ENFILE`, `ENOTEMPTY`, `EPERM`) and throws any other code at once. At the deadline (10 s by default) it fails with the attempt count, the last error and up to 20 entries that are left. It is synchronous, a drop-in for `rmSync`; the pause between attempts is `Atomics.wait`, which uses no CPU. `remove` is a test seam.
   - `test/helpers/remove-tree.test.ts`: a second process adds files by path for 300 ms (as `rmsync-retry.mjs`, with 500 files instead of 20,000); plus injected failures: a retried `ENOTEMPTY`, a folder made again, an `EACCES` thrown at once, a deadline that names what is left.
   - The writer test is discriminating on Node 22.19: the same setup with one plain `rmSync` failed `ENOTEMPTY` 5 of 5 (throwaway script, not committed).
2. **node:test run test** (`test/runners/node-test/run.test.ts`, commit `cb662ee01`). "reports nothing of a run stopped after the checkout holding its store went" now moves the checkout away with `renameSync(checkout, gone)`, in one step, then aborts the run. After `await running` it removes `gone` with `removeTree`. After the rename, the run's appends by path (`graph-1-<pid>.ndjson`, `events-1.ndjson`) meet a missing folder and add nothing; open file descriptors write into `gone`, which is removed later. The test's assertions are unchanged.
3. **OpenCode** (commit `3e0dd01a3`).
   - `test/helpers/opencode.ts`, `runOpenCode` (ownership confirmed by the coordinator, 2026-11-14): a step `ended(child, options, dir)` runs once per run. It sends SIGKILL to OpenCode's process group and waits until no process of it is left (10 s, then a second SIGKILL and 5 s). Then it awaits the optional `OpenCodeRunOptions.settle({ home })`, where `home` is the run's private HOME. It runs on success after OpenCode's exit, before the run is returned, and on failure before any removal. Before this row, the error path removed the folder first and killed OpenCode later in `finally` (research finding 3b). `cleanup()` and the error path remove with `removeTree`; the `maxRetries` call is gone.
   - The error path is `afterFailure(error, end, dir, fresh)`. A member still alive after its SIGKILL (`StillAlive`) keeps `dir` and throws an error that names it, with the run's error as its cause. Any other `end` failure, such as a bridge that had to be killed but is gone, is dropped: the folder is removed and the run's own error is thrown.
   - `test/harness/opencode/real.ts`: `squealOpenCode` passes `settle: (owned) => awaitBridges(dist, owned)`. `awaitBridges` takes only this run's bridges (see the repair section), waits for their groups for 30 s (`BRIDGES_LEAVE_MS`), kills what is left, and then fails naming the killed processes, as `awaitRunnerHosts` does. A bridge still alive after that kill is a `StillAlive` failure.
   - `test/helpers/process-groups.ts` (new, used by both): `detachedLeaders(selects, owns)`, `membersOf(groups)`, `awaitGroups(groups, { graceMs, killedMs, signal })` returning `{ killed, alive }`, and `StillAlive`. Zombies count as gone. `process.kill(-group, 0)` decides first; `ps` is read only while a group still answers. `test/helpers/process-groups.test.ts` covers leader lookup, a child that outlives its leader, a kill after the grace, members still alive after a kill that did not reach them, and a group that is already gone.
   - `test/harness/opencode-dispose.test.ts`: no change needed.

## Repair of B1 and S1 (wave 87.5)

Commits: `ade7ff5f7` (tests, red against the reviewed helpers), `1284e64ae` (the change).

- **B1.** Before, `awaitBridges` took the group of any process whose command line held `<dist>/hooks/`; an unrelated `tail -f` on a hook file was killed. Now `detachedLeaders` reads `/proc` and takes a process only when all of these hold:
  - its last argument is a `.mjs` file directly under `<dist>/hooks` (or the real path of `dist`); replaced by the second repair with the exact command `bridgeStart` builds;
  - its executable (`/proc/<pid>/exe`) is named `node` or `nodejs`, because the plugin starts bridges with the Node on `PATH` (`findNode`);
  - its pid is its group's and its session's, as `detached: true` makes it;
  - its environment's `HOME` is the run's private HOME, which `runOpenCode` passes to `settle`.

  Only such a leader's group is waited for or signalled. A process joins a group only inside its own session, so every member of that group descends from the bridge. Where `/proc` is missing (not Linux), or a process cannot be read (another user's), nothing is taken; the removal then relies on `removeTree` alone.
- **S1.** `awaitGroups` returns `{ killed, alive }`; `alive` holds the members still alive at the end of the wait after the SIGKILL. `ended` fails with `StillAlive` for OpenCode's group, and `awaitBridges` does the same for a bridge. `afterFailure` then keeps the folder (see step 3).
- Tests:
  - `test/harness/opencode/real.test.ts` (new, beside `real.ts`), Linux only. Three negative cases each resolve in under 5 s of a 20 s grace and leave their process alive: the review's detached `tail -f <dist>/hooks/end.mjs`; a Node bridge stand-in with another run's HOME; the hook entry run by Node inside a group that a detached shell leads. One positive case waits for this run's bridge and for the child that outlives it, and kills nothing. One case kills a bridge still there after a 300 ms grace and fails naming it.
  - `test/helpers/opencode.test.ts` gains two `afterFailure` cases: a removable failure, and a `StillAlive` one that keeps the folder.
- The probe log line, added again for one Node 22.19 dispose run and not committed, showed the stricter identity still finds the real bridges: `bridges=1` in the first two OpenCode runs, waited 995 and 973 ms; `bridges=0` in the third; no kill, nobody alive.

## Second repair of B1 (wave 87.5 W2)

The re-review proved the first repair still too loose. A detached `node observer.mjs <dist>/hooks/end.mjs` with the run's HOME was taken as a bridge and killed, because the selector read only the last argument, and Node executes `observer.mjs`. The human chose one owner for the rule: the command `bridgeStart` builds (`src/harness/opencode/bridge-client.ts:50`).

Commits: `ce06dcb73` (tests, red: `bridgeCommand` did not exist), `6a6c4ffd9` (the change).

- `bridgeCommand(dist)` in `test/harness/opencode/real.ts` accepts a command line only when, after the executable, it is exactly the argument list `bridgeStart` builds for one `.mjs` entry directly under `<dist>/hooks` (or the real path of `dist`). `bridgeStart` builds two forms: `--disable-warning=ExperimentalWarning <entry>`, and with Node's proxy switch (`NODE_USE_ENV_PROXY`) `--disable-warning=ExperimentalWarning --import <restore preload> <entry>`. The selector calls `bridgeStart` itself for both, so the restore preload is never copied and the two cannot drift. `bridge-client.ts` is imported, not changed.
- `awaitBridges` uses `bridgeCommand(dist)` in place of the last-argument check. The other three checks stay: the executable is `node` or `nodejs`, the process leads its own group and session, and its HOME is the run's private HOME. The survivor report (S1) is unchanged.
- Tests in `test/harness/opencode/real.test.ts`:
  - `the bridge command`: `bridgeStart` is called for both forms; the proxy form must carry `--import` and the plain one must not, so a renamed switch fails this test. The selector accepts both forms, and rejects 11 other command lines that name a hook entry: the Node observer with and without the flag, the entry with no flag, an argument after the entry, another preload, an extra flag before the entry, a subfolder of `hooks`, another dist, a `.cjs` entry, the executable alone, an empty list.
  - `awaitBridges`: the re-review's Node observer with the run's HOME stays alive and the call resolves in under 5 s of a 20 s grace. Every stand-in bridge is now started with `bridgeStart`'s arguments and environment. The surviving-child case runs once per form (`it.each`), and both pass. The other-HOME and not-a-leader cases use the plain form, so they test their own rule.
- Discriminating check, not committed: with `bridgeCommand` given the old last-argument rule, exactly two rows failed on Node 26.13: the selector's negative list, and the Node observer, which used up the grace until the 5 s test timeout. The other seven passed.
- The probe log line, added again for one Node 22.19 dispose run (restored from a copy afterwards), showed the real bridges match the plain form exactly: `["--disable-warning=ExperimentalWarning", "<dist>/hooks/wait.mjs"]`, one in each of the first two OpenCode runs, waited 983 and 1,009 ms, none in the third, no kill, nobody alive. The bridge that outlives OpenCode is therefore the idle wake's `wait`, which ends at its next check of OpenCode's pid (`PID_POLL_MS`, 1 s). The research had inferred the `end` bridge.

## Who calls `runOpenCode`

- Through `squealOpenCode`, so with `settle` = `awaitBridges`: `test/harness/opencode-abort.test.ts`, `opencode-continued.test.ts`, `opencode-dispose.test.ts`, `opencode-evidence.test.ts`, `opencode-hooks.test.ts`, `opencode-wake.test.ts`.
- Directly, with no `settle`: `test/harness/opencode-fixture.test.ts`, `test/harness/opencode/fresh-store.test.ts`, and `test/e2e/opencode-fixture.ts` (e2e, outside Squeal's coverage; not run here). For these, three things change. After OpenCode exits, the run waits until its group is gone; before, the SIGKILL in `finally` had no wait. The removal repeats as a whole. The error path kills OpenCode and waits before it removes. They pass no `settle`, so nothing else waits.

## Runs

Private `HOME` and `TMPDIR` under `/tmp/w336-*`; `env -u PLUGIN_ROOT -u PLUGIN_DATA`; `node node_modules/vitest/vitest.mjs run <file>` under each nvm Node. Host load average 8–13 during the first round's runs and 6–10 during the repair's runs, from other sessions.

First round (before the repair):

| Test | Node 22.19.0 | Node 24.15.0 | Node 26.13.0 |
|---|---|---|---|
| `test/helpers/remove-tree.test.ts` (5 tests) | 1 of 1 passed | 1 of 1 | 1 of 1 |
| `test/helpers/process-groups.test.ts` (4 tests) | 1 of 1 | not run | 1 of 1 |
| node:test run test, the one test (`-t`) | 5 of 5 | 3 of 3 | 3 of 3 |
| `test/runners/node-test/run.test.ts`, whole file | 1 of 1 (15 tests) | not run | not run |
| `test/harness/opencode-dispose.test.ts`, whole file (3 tests) | 3 of 3 | 2 of 2 | 2 of 2 |

Repair, on the final code (`1284e64ae`):

| Test | Node 22.19.0 | Node 24.15.0 | Node 26.13.0 |
|---|---|---|---|
| `real.test.ts`, `process-groups.test.ts`, `opencode.test.ts`, `remove-tree.test.ts` together (19 tests) | 1 of 1 passed | 1 of 1 | 1 of 1 |
| `test/harness/opencode-dispose.test.ts`, whole file (3 tests) | 3 of 3 (one with the probe line) | 1 of 1 | 1 of 1 |
| node:test run test, the one test (`-t`) | 1 of 1 | 1 of 1 | 1 of 1 |

After the runs, the private `TMPDIR` was empty and no `sq-oc-`, bridge or test process was left.

Second repair, on the final code (`6a6c4ffd9`):

| Test | Node 22.19.0 | Node 24.15.0 | Node 26.13.0 |
|---|---|---|---|
| `real.test.ts`, `process-groups.test.ts`, `opencode.test.ts`, `remove-tree.test.ts` together (23 tests) | 1 of 1 passed | 1 of 1 | 1 of 1 |
| `test/harness/opencode-dispose.test.ts`, whole file (3 tests) | 3 of 3 (one with the probe line) | 1 of 1 | 1 of 1 |

`test/runners/node-test/run.test.ts` and `remove-tree` are unchanged since the first round; Squeal holds current passes for them.

During the first round's 7 dispose runs, a temporary log line in `awaitBridges` (not committed) recorded what `settle` found. In each file run, the first two OpenCode runs still had one bridge group running after OpenCode's group was gone, and `settle` waited 921–996 ms for it to end. In file order these are the "never released" test and the "drops the old turn's report" test, the one CI failed. The third run (the abort test) had none. No bridge was killed. Before this change, the folder removal ran during that second.

Squeal: first round, all affected test files current with no known failures at revision 14 (11 files) and at revision 16 after the temporary log line was removed. Repair, 14 affected test files current with no known failures at revision 32, the committed tree: the 8 OpenCode test files, `opencode/fresh-store`, `opencode/real.test.ts`, `helpers/opencode.test.ts`, `helpers/process-groups.test.ts`, `helpers/remove-tree.test.ts`, `runners/node-test/run.test.ts`. Second repair, 12 affected test files current with no known failures at revision 40, the committed tree. `pnpm run lint` and `pnpm run typecheck` pass. No full suite was run (host policy).

## The eight other files with `maxRetries`

They keep it, as the brief says. Each is a candidate for `removeTree` where a writer can outlive its test; the synchronous ones have the same gap on Node 22:

- `test/store/helpers.ts:30`
- `test/code/helpers.ts:27`
- `test/lint/helpers.ts:29`
- `test/lint/oxlint/helpers.ts:29`
- `test/lint/provider/helpers.ts:66`
- `test/policy/repository-inputs.test.ts:108`
- `test/e2e/harness.ts:480–481`
- `test/keys/validity/self-test.test.ts:84` (`fs/promises` `rm`, callback form; not examined)

## Open, for whoever continues

- Research question 3a remains open: which process made a new entry directly in `squeal-opencode-*` on CI. This change waits for the bridges and repeats the whole removal. If an unknown writer keeps adding entries for 10 s, `removeTree` now fails and names what is left, which is the evidence 3a needs.
- `cleanup()` stays synchronous, and callers run it in `afterEach` with Vitest's 10 s hook timeout. A removal that takes all of `removeTree`'s 10 s would also exceed that hook timeout, as the old ~10.5 s of `maxRetries` did. Once the writers are awaited, the removal succeeds at its first attempt.
- A bridge that OpenCode forked but had not yet exec'd when OpenCode died has OpenCode's command line, not a hook entry, so `awaitBridges` cannot see it. The window is microseconds, and `removeTree` covers a short writer.
- A group is identified by its leader's pid. If the group empties and the kernel gives that number to a new group between two polls (50 ms), the wait could reach that new group. Pids are handed out in order up to `pid_max`, so this does not happen in practice; it is named here because B1 asks that no other process be signalled.
- Outside Linux, `awaitBridges` waits for nothing (no `/proc`); OpenCode's own group is still awaited through `ps`.
- A held-Stop stand-in can outlive a cancelled run. `test/harness/opencode/held-stop.ts` writes a `stop.mjs` that polls for its release file every 5 ms and never stops by itself. When Squeal cancels a dispose-test run mid-test (an edit changed its inputs), the Vitest worker dies, `settle` never runs, and the detached stand-in keeps polling. Two such processes (Squeal runs `d36b18c8` and `9d8f5fcb`, 2026-11-14 11:18 UTC) were found and ended by this worker. This gap is older than this row and is outside its files. Candidate fix for `held-stop.ts`: the stand-in exits once its release folder is gone, or once OpenCode's pid is gone, as the `wait` bridge does.
- CI is the final evidence: a Node 22 shard where both tests pass, then 20 main runs without this `ENOTEMPTY`.
