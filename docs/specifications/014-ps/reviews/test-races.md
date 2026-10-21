# Review of the three test races

PASS aea7224d407b049ad2ca395a29e9d87764d4d86b

Range: `660a1b6af..aea7224d4`, on `cand/014-18`. Commits: `56a3b43c5` (014-18), `9522cba5d` (014-20), `aea7224d4` (014-19). This is an independent review. The earlier reviewer's notes are not used as evidence. No candidate code changed during this review.

Blockers: 0. Should-fix: 0. Nits: 0. Full-run notes: 1 known failure outside this range (008-38).

## Verification output

The worktree was clean at the pinned candidate. `npm ci` completed before validation. The build left no tracked change. The three files ran separately before the full suite. These are independent Vitest runs, as the reviewer gate requires; Squeal's background results do not replace them.

```text
npm ci
added 196 packages, and audited 197 packages in 10s
exit 0

npm run lint
Checked 1658 files in 693ms. No fixes applied.
exit 0

npm run typecheck
tsc --noEmit
exit 0

npm run build
tsc -p tsconfig.build.json && npm run build:plugin
tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

npx vitest run test/version-sensitive.test.ts --maxWorkers=4
Test Files  1 passed (1)
Tests       6 passed (6)
Duration    439ms

npx vitest run test/daemon/died-startup.test.ts --maxWorkers=4
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    6.65s

npx vitest run test/e2e/ps.test.ts --maxWorkers=4
Test Files  1 passed (1)
Tests       7 passed (7)
Duration    33.42s
```

The standalone files began at 20:12:25, 20:12:27 and 20:12:34 UTC on 2026-10-21. Their 1-minute load averages were 17.75, 17.75 and 19.63 on 24 CPUs.

One full run used the required command under `nohup` and the shared host lock. A detached supervisor recorded its exit code and sampled host load every 10 seconds. The run survived the review session waits. It queued at 20:13:36 UTC, acquired the lock at 20:32:00 UTC and finished at about 20:53:50 UTC. Vitest reported a 1,309.52-second duration. The first load sample after acquisition was 62.08; 1-minute load during the run ranged from 34.43 to 66.73 on 24 CPUs.

```text
nohup flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4 > <log> 2>&1

FAIL test/harness/opencode-dispose.test.ts
serve: an abort of the new turn, then the old Stop's answer, stores nothing
Error: before the new turn's request, the plugin killed the held Stop at +2277,
at or after its idle deadline (+2000)
Attempts 1 and 2 missed their barriers at +2161 and +2008 ms.

Test Files  1 failed | 831 passed | 1 skipped (833)
Tests       1 failed | 7160 passed | 10 skipped (7171)
Start at    22:32:01 (Europe/Warsaw)
Duration    1309.52s
exit 1
```

**Proven:** the only full-run failure is the unchanged OpenCode abort case documented in board 008-38. Its held-Stop deadline was missed on all three attempts. This file is outside the four-file candidate diff. All three reviewed files passed in this full run. `test/e2e/stop-gap.test.ts` (011-20) did not fail. The full suite is not green; the recorded failure is a known issue outside the review range. A causal claim that host load alone produced it is **plausible**, not proven by this run.

The only failed file then ran alone, without a code change:

```text
npx vitest run test/harness/opencode-dispose.test.ts --maxWorkers=4
Test Files  1 passed (1)
Tests       3 passed (3)
Start at    22:58:40 (Europe/Warsaw)
Duration    19.10s
exit 0
```

The isolated rerun began at 20:58:39 UTC with load 31.87 on 24 CPUs. This is a recorded recovery under the same code. No second full run was started.

CI was checked independently with `gh run view 39661075417 --json headSha,status,conclusion,url`:

```json
{"conclusion":"success","headSha":"aea7224d407b049ad2ca395a29e9d87764d4d86b","status":"completed","url":"https://github.com/hearsay-tools/squeal/actions/runs/39661075417"}
```

## Findings

### F1. Proven: the version-sensitive walk excludes the disappearing fixture tree

Location: `test/version-sensitive.test.ts:58-69`, regression at `:142`. Board 014-18 and the test-races brief require skipping `test/fixtures` before descent. The walk now reads one directory at a time and tests `path !== "test/fixtures"` before recursion. It never lists that directory, so a scheduler's fixture cleanup cannot interrupt this walk inside its scratch repository.

The actual old `sources()` from `660a1b6af` and the candidate function were also run against the same stable candidate archive. They returned exactly the same sorted list of 981 TypeScript files outside `test/fixtures`. Instrumenting the new directory reader recorded 61 directory reads and no entry into `test/fixtures` or its descendants. The review-only probe file was removed from that archive before comparison.

```text
old: 981; new: 981; equal: true
fixturesEntered: false; directoriesRead: 61
```

A disposable archive of the exact candidate held every counterfactual edit. The review worktree was never mutated. First, the candidate version-sensitive file passed all 6 tests there. Then the pre-descent skip was removed and the old final fixture filter restored. The new regression failed, with the other 5 tests passing:

```text
never lists test/fixtures, where a directory may go during the walk (014-18)
Error: ENOENT: no such file or directory, scandir '.../test/fixtures/scheduler/.tmp/run/main/.git'
Test Files  1 failed (1)
Tests       1 failed | 5 passed (6)
exit 1
```

This is a counterfactual of the skip, with the injected directory reader retained. It recreates the old traversal-before-filter behavior. Node's original recursive `readdirSync` has no per-directory injection hook. The regression's callback removes `.git` after listing its parent; an unsafe descent then reads the vanished entry.

### F2. Proven: registration is complete before the startup test can see its path

Location: `test/daemon/died-startup.test.ts:30-44`, existing JSON assertion at `:87`. Board 014-20 and the brief require a temporary write followed by rename. The driver writes `<out>.tmp`, completes that synchronous write, then renames it to `out` in the same directory. Each test owns a fresh directory. The reader's unchanged existence check cannot see the staged partial write. Same-directory rename publishes the complete JSON on this Linux host.

Commit `9522cba5d` explains why it adds no dedicated deterministic regression: the natural window lies inside the child's file creation/write, and observing it reliably requires changing the driver. The brief permits this reason in the commit body. Natural reproduction of that exact narrow window in this review is **unverified**.

A controlled disposable probe tested the existing JSON oracle. Only the child driver's `writeFileSync` was wrapped: it opened the requested path, waited 2 seconds, then wrote the JSON. With the staging/rename fix present, both existing cases passed. With that fix alone removed, and the same delay retained, both cases failed at the unchanged JSON assertion:

```text
staged-slow-write:
Test Files  1 passed (1)
Tests       2 passed (2)
exit 0

direct-slow-write:
SyntaxError: Unexpected end of JSON input
Test Files  1 failed (1)
Tests       2 failed (2)
exit 1
```

This proves the publication fix closes the reported interprocess window. It does not claim an uninstrumented pre-fix failure occurred in this review.

### F3. Proven: the leftover test excludes unrelated host daemons

Location: `test/e2e/ps.test.ts:232-270`, `test/e2e/ps-support.ts:195-222`. Board 014-19 and `reviews/wave-3.md` S1 require a real ProcSource limited to owned processes, including the held child. The case wraps `host(createProcSource())` with `ownProcesses(..., [process.pid, child.pid])` and passes it through `PsCommandOptions.sourceFor`. Default process-table reads therefore contain the worker and held child. Explicit pid reads preserve the requested list, as the sampling API requires. Both cwd and argument reads remain real. The child still holds the directory with spaces. The production flags and conservative unknown rule are unchanged.

The case now runs with the real source and with one injected same-user daemon whose root is relative and thus unknown. Both pass in the candidate's standalone run. In the disposable copy, removing `ownProcesses` while retaining the injected unknown-root daemon made the regression fail:

```text
npx vitest run test/e2e/ps.test.ts -t 'unknown root' --maxWorkers=4
Expected stdout: <unused directory>\n
Received stdout: ""
Test Files  1 failed (1)
Tests       1 failed | 6 skipped (7)
exit 1
```

This closes the host dependency named by S1. A natural occurrence on this host is not needed for this deterministic proof.

### F4. Proven: the Proxy preserves every other source read

Location: `test/e2e/ps-support.ts:179-196`. `overriding` returns an own override when one exists. Otherwise it reads from the actual target and binds functions to that target. The private fields of ProcSource therefore retain their receiver. The wrapper created by `ownProcesses` overrides only `processTable`.

Two disposable review-only tests passed. The first checked all 12 other PsSource methods (`clockTicks`, `bootTime`, `cmdline`, `markOf`, `memory`, `fds`, `cwds`, `locks`, `fileKey`, `unixListeners`, `pidNamespace`, `host`) against a source with a private-field receiver, with arguments and return values intact. It also checked `platform`, `memoryKind`, `readsMarks`, the default pid list and an explicit pid list. The second used a real ProcSource inside the nested unknown-daemon wrapper. Its actual cwd and argv matched the underlying source, and the default table contained only the requested real pid.

`withUnknownDaemon` intentionally overrides `cmdline` for its impossible fake pid. For every real pid it forwards to the real source. This is the injected regression premise, not a replacement of real reads for the test-owned processes.

### F5. Proven: existing assertions retain their strength

Location: all four changed files. The diff removes no existing assertion, timeout or platform gate. The version-sensitive file adds one regression. The leftover case repeats its exact stdout, stderr, exit-code and grouped-flag assertions under two source conditions. The startup file changes only its driver's publication.

An AST comparison retained every old assertion expression statement: 9 in the version-sensitive file, 9 in the startup file and 22 in the ps file. The comparison normalized only the added source argument to the two `sourcePs` calls; expected values and matchers were unchanged. The version-sensitive regression adds one assertion. The Proxy helpers add no weakened assertion or skip.

## Blockers, should-fix and next-wave input

No in-scope repair is required. Keep fixture exclusion before descent. Keep startup registration publication atomic. Keep real ProcSource cwd and argument reads, the held child, and the exact leftover assertions when extending this test. Do not change production D7's conservative unknown rule to make a test pass.
