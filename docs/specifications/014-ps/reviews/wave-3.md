PASS 7b8669b57e0bf31ebeaa8b8791011837ae3c9e20

Zero blockers. One proven should-fix item. Two notes, one proven and one unverified. Two proven nits. The independent full suite failed in an unchanged OpenCode test, and that file failed alone too. This verdict does not claim a passing full suite.

Row 014-16 reviews `de6a8dd19..7b8669b57`, pinned to `cand/014-14`. The range contains the Rolldown pin (`cd8bae31b`), the ps e2e tests (`97d7018e0`, `e5adc25f0`) and the accepted amendment in `status.md`. Inputs: amended spec 014, the wave 3 introduction and 014-14/014-16 briefs, `research/shipped-plugin-timeout.md`, and the wave 2 reviews. No product code, test, board or status file was changed by this reviewer.

## Verification output

All normal checks ran at the pinned commit with a clean tracked tree. The review file was added after verification. Node was 24.21.0; the host has 24 CPUs. The full suite used Vitest directly, as the review requires, rather than Squeal's checkpoint. Squeal excludes the e2e files.

```text
$ git rev-parse HEAD
7b8669b57e0bf31ebeaa8b8791011837ae3c9e20
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 13s
1 high severity vulnerability
(exit 0)

$ npm run lint
> squeal@0.1.240 lint
> biome check .
Checked 1640 files in 850ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.240 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.240 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.240 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)

$ git status --short
(no output; no bundle drift)
```

### The two e2e files alone, before the full suite

```text
$ npx vitest run test/e2e/ps.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
  Duration  31.35s
(exit 0)

$ npx vitest run test/e2e/shipped-plugin.test.ts
Test Files  1 passed (1)
     Tests  7 passed | 1 skipped (8)
  Duration  11.67s
(exit 0)
```

The ps run started at 18:01:37 UTC on 2026-10-21, at load `38.86 29.91 29.26`. The next load sample at 18:02:17 was `33.58 29.77 29.24`. The shipped-plugin command started at 18:02:24, at load `31.61 29.42 29.13`, and ended at 18:02:37, at load `37.21 30.75 29.57`.

### Independent full run, once

The command queued on the shared lock at about 18:03 UTC. Start and end times and loads below were captured inside the lock. No second full suite ran.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
2026-10-21 18:11:36 UTC: load 27.45 35.89 33.42
Test Files  1 failed | 815 passed | 1 skipped (817)
     Tests  1 failed | 7095 passed | 10 skipped (7106)
  Duration  1295.43s
2026-10-21 18:33:13 UTC: load 50.77 47.58 43.31
(exit 1)
```

The only failed file was `test/harness/opencode-dispose.test.ts`. Its case `serve: an abort of the new turn, then the old Stop's answer, stores nothing` missed the new turn before the held Stop's idle deadline:

```text
before the new turn's request, the plugin killed the held Stop at +2275,
at or after its idle deadline (+2000)
idle +0, stop +49, dispose +79, input +327, kill +2275
```

The case exhausted its three barrier attempts. Both changed e2e files passed in the full run. The run also printed Git worktree repair diagnostics and nested Vitest typecheck warnings; it reported no other failed file.

### The failed file alone

```text
$ npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4
2026-10-21 18:35:33 UTC: load 50.43 47.93 43.99
Test Files  1 failed (1)
     Tests  1 failed | 2 passed (3)
  Duration  69.09s
2026-10-21 18:36:44 UTC: load 65.38 53.16 46.11
(exit 1)
```

The same case failed after three barrier attempts. Its final attempt killed the Stop at `+2056`, against `+2000`. This was the only failed file, so it was the only full-run failure rerun. It did not recover in this review. N1 records the scope and limits of attribution.

### Additional isolation checks

A file-syscall trace ran `strace -ff -e trace=%file ... npx vitest run test/e2e/ps.test.ts`. It reported 4 passed and 2 failed in 103.20 s. The two failures were the `root-gone` and no-side-effects cases, each waiting for a stopped daemon. `whileStopped` accepts `/proc` state `T` only. A separate probe that started, stopped, continued and ended its own traced `sleep` observed state `t` after SIGSTOP. The trace changes the stop observation; its two failures are not treated as ordinary host flakes or as passing evidence for those cases.

The file was then rerun alone without tracing:

```text
$ npx vitest run test/e2e/ps.test.ts
Test Files  1 passed (1)
     Tests  6 passed (6)
  Duration  38.67s
(exit 0)
```

That command started at 18:07:24 UTC, at load `56.68 40.38 33.28`, and ended at 18:08:05, at load `54.25 41.98 34.13`. Thus both normal standalone ps runs passed. The trace remains limited evidence about filesystem access, not a successful second integration run.

## Blockers

None. No proven break of this wave's spec goal or done-when was found. The unchanged OpenCode failure remains a failed verification result.

## Should-fix

### S1. Proven: the leftover assertion depends on unrelated daemon identity

Location: `test/e2e/ps.test.ts:219`, with the exact-list assertion at line 238 and grouped-flag assertion at line 245. The dependency is in unchanged `src/core/ps/flags-files.ts:182` (`liveKeys`).

The accepted amendment permits `psCommand` in-process, a scratch `tempDir`, and real `/proc`. It does not isolate daemon discovery. When any discovered daemon has a null root or common directory, `liveKeys` returns an unknown reason before scanning the scratch directories. `--leftovers` then exits 0 with empty stdout. The test expects the unused path. The JSON check also fails because there is no `leftover-temp` file flag.

A read-only host sample at 18:03:28 found 18 daemons and no unknown root or common directory. Both normal standalone runs and the full suite passed this case. A natural occurrence on this host was therefore **not observed**. An occurrence on CI is **unverified**. Intermittent failure during concurrent daemon startup, exit or root removal is **plausible**; a scratch HOME and temp directory do not exclude that state from the shared process table. A quiet CI host reduces exposure but is not an isolation boundary.

A discriminating probe used the production command, real ProcSource, old scratch directories and a real child whose cwd held the directory with spaces. Only the source seen by that probe changed; it created no fake host daemon and signalled only its own child:

```text
real source:
  --leftovers = <unused>\n; leftover-temp count = 1
same source plus one injected unknown-root daemon row:
  --leftovers = ""; no leftover-temp flag
  unknown: the temp key of daemon 2147483000 is unknown:
           its root or repository cannot be read
real source with processTable limited to the test and its child:
  --leftovers = <unused>\n; leftover-temp count = 1
```

**Narrow fix, one test change:** use the existing `PsCommandOptions.sourceFor` seam for this one leftover case. Forward to a real ProcSource, but restrict `processTable` to the test-owned pids, including the held child. Keep real cwd/argv reads, the real flags and the exact leftover assertions. Forward or bind the source methods to the ProcSource instance; its methods use private fields and are not copied by object spread. This retains the real-process proof without making another host daemon a premise of it. Do not change the production conservative unknown rule, raise a timeout, weaken the expected list or skip on unknown host state. Rerun the file twice after that repair.

This is a should-fix item rather than a blocker: the dependency is proven, but no normal required run broke the row's done-when.

## Notes

### N1. Proven: the known OpenCode idle-deadline failure remains

Location: `test/harness/opencode-dispose.test.ts:168`, reported from `test/harness/opencode/held-stop.ts:210`.

The full run and isolated rerun failed the same deadline scenario. `docs/board.md` already records this file's load sensitivity, and CI runs it alone for that reason. The candidate changes neither this test, its helper, the product source nor its bundles. The new install export leaves the other fixture recipes unchanged. This is outside the wave's diff and is not a blocker against its ps proof. Load was high in both runs; load as the sole cause was not isolated here. No passing rerun or green full-suite claim is made. Carry both failed outputs and loads into the landing note.

### N2. Unverified: the worker's six counterfactual runs have no retained logs

The parent supplied the worker's results by explicit reply. The worker ran mutations in a disposable detached worktree at `3cfc72dec`. A local diff confirmed that its ps test/helper, product source and bundles match the candidate. The mutation script, logs and disposable worktree have since been removed. This reviewer inspected every corresponding assertion but did not reproduce those mutations. Their reported red results remain unverified, not blocking findings against the candidate.

| Case | Reported rule removed or side effect added | Reported failing assertion | Status |
| --- | --- | --- | --- |
| Serving with tied socket | Remove the socket-to-daemon tie | Fixture socket appears in `unknown` | unverified |
| Test processes during slow tier | Remove owner by ancestry | `escaped: false` does not match | unverified |
| SIGKILL stale socket | Suppress `stale-socket` | Empty files instead of expected flag | unverified |
| Root removed under stopped daemon | Suppress `rootGone` | Empty daemon flags instead of `root-gone` | unverified |
| No side effects | Connect to each fixture socket, then drop the connection | Connection count 2 instead of 0 | unverified |
| No store write, additional variants | Read-write open; read-write open plus WAL checkpoint | Phase differs; checkpoint changes store bytes/mtime | unverified |
| Leftover use exclusion | Remove the use check | Held directory also appears in the exact list | unverified |

The additional read-write-open phase failure was not explained by the worker. It is not presented as proof that every read-write open must alter bytes. The normal stopped-daemon store test directly asserts the required bytes and mtime contract.

## Nits

- **Proven, `test/e2e/ps-support.ts:15`:** the comment that the hooks get scratch HOME is broader than the calls. Startup gets it, while the shared cleanup's SessionEnd gets the real HOME. Describe startup specifically, or pass the scratch environment through a future harness change. The source trace below found no new HOME writer in cleanup.
- **Proven, `docs/board.md:971`:** 014-14 still says running and 014-16 says planned at the pinned candidate. The coordinator should update them when recording the result. The reviewer did not edit the board.

## What fits

### Proven: the five shipped cases cover Testing's integration and no-side-effects contracts

- `test/e2e/ps.test.ts:73` starts a real daemon through the copied Claude Code plugin, then runs the shipped CLI. It checks the repository, pid, serving phase/state, root, worktree id and version. Its socket must exist and appear in neither stale files nor unknown sockets.
- Line 96 waits for an actual slow tier and at least one process tied to that run. It independently walks `/proc` ancestry to the fixture daemon, checks non-escaped ownership and the slow Vitest lane. The 30 s fixture sleep leaves room for the 2 s snapshot.
- Line 119 settles the baseline, kills only its fixture daemon, checks that the socket remains, and asserts the exact stale-socket flag and exit 1 through `--repo`.
- Line 146 stops its own daemon, removes the fixture root, checks `root-gone`, and resumes it in `finally` before cleanup.
- Line 162 stops its own daemon so daemon writes cannot move the measured files. It checks hash, size and mtime of all `store.sqlite*` files, the store-file list, the runtime directory entries and zero accepted connections on its own listener. It exercises both text and JSON output and confirms that the live store was read.

`ps-support.ts` uses the ready pid from the fixture's private runtime directory. Explicit SIGSTOP, SIGCONT and SIGKILL calls target that pid; the leftover test signals its own child. Shared harness cleanup selects daemons from its unique copied plugin path. No new signal path targets a host daemon, and no printed end command is executed.

The sixth case's source-command deviation is accepted in `status.md`. It protects a directory with spaces by a real child cwd, and asserts the only unused path and the grouped count. S1 bounds its remaining host dependency. Shipped `--json` proof is supplied by the other five cases. Real-host cost and dogfood remain 014-15; actual macOS behavior remains outside this review.

### Proven: the pin follows the repository and changes no other install key

Locations: `test/e2e/install.ts:48`, `test/e2e/shipped-plugin.test.ts:131`.

`ROLLDOWN_VERSION` reads `node_modules/rolldown/package.json` through the existing `installedVersion` helper. After `npm ci`, both that manifest and `package-lock.json` name `1.2.12`. The shipped-plugin install adds `rolldown@1.2.12` beside the existing explicit Vitest/Vite versions. That file passed alone and in the full suite without a timeout change.

The diff in `install.ts` adds only the exported constant and its comment. Both `recipe()` branches, their package lists, the workspace-manifest hash, the platform suffix and the cached-install checks are unchanged. No other e2e file's install key changes. The separate recommendation to harden fresh shared fixture installs against stale native-binding metadata is not implemented by this pin and is not claimed as fixed here.

### Proven call paths: real HOME in settle and cleanup adds no new HOME writer

Locations: `test/e2e/harness.ts:300`, `:367`, `:420`; `test/harness/bundle-helpers.ts:46`; `test/e2e/ps-support.ts:22`.

Startup and each shipped ps command receive scratch HOME/TMPDIR and private XDG_RUNTIME_DIR. `e.settle` uses `status --json` through the shared `e.cli`, whose fallback HOME is real. That path reads the fixture repository's store. SessionEnd also uses the fallback HOME, but unregisters consumers and removes waiter/session-root files in the fixture store and private runtime directory. It never starts a daemon. Cleanup's `squeal stop` uses the fixture root, its recorded socket, its locks and its stopped mark. None of these calls introduces a user config, harness config or user cache write under the real HOME.

This is not a claim that launching the whole test process writes nothing anywhere under HOME. The unchanged shared installer can write npm cache/logs on a cache miss, and the `npx` driver created one npm log and removed two old npm logs in the syscall trace. No write-path syscall to `~/.config`, `~/.claude`, `~/.codex` or `~/.cache` appeared. The trace also showed writable opens of SQLite WAL/shm files in host repositories while the unchanged read-only ps reader inspected live stores. An open is not evidence of a byte change; file-only tracing does not prove absence of mapped-memory changes. The candidate adds no store-reader implementation, and the no-side-effects assertion proves the fixture store contract only. No credentials were inspected or copied.

## Inputs for the next wave

1. Record the PASS separately from the failed full-suite and isolated OpenCode results. Preserve their loads in the landing note; do not call the full suite green.
2. Fold S1 into a bounded test repair using `sourceFor` and real test-owned processes. Keep the accepted in-process leftover deviation and the five shipped CLI cases. No product flag policy change is needed.
3. If mutation evidence is required for later reuse, retain the mutation names and red outputs with the review inputs. The deleted worker logs cannot become proven evidence by repetition in a report.
4. 014-15 still owns the shipped-command host comparison, every observed flag's truth, the wall/CPU measurements against goal 6, and `lessons.md`. No dogfood or Mac result is implied by this review.
