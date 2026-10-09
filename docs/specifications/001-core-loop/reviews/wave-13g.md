# Wave 13g review: unreviewed 001 rows since 0.1.54

PASS `98874f1f70cdd68c495f25078cc057cc6d63029e`. 0 blockers, 0 should-fix, 0 nits. This is the scoped verdict for row 001-175, not a claim that the whole repository gate passed.

## Verification output

Candidate: `git rev-parse HEAD` returned `98874f1f70cdd68c495f25078cc057cc6d63029e`. The worktree was clean before verification and after the plugin build. Node 24.21.0; Vitest 5.0.3. No product file changed for this review.

```text
$ npm ci
added 56 packages, and audited 57 packages in 5s
found 0 vulnerabilities
npm warn install-scripts: @parcel/watcher@2.6.0 and esbuild@0.28.2 have install scripts not yet covered by allowScripts

$ npm run lint
> squeal@0.1.69 lint
> biome check .
Checked 670 files in 1489ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.69 typecheck
> tsc --noEmit
[exit 0]

$ npm run build
> squeal@0.1.69 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.69 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]

$ git status --porcelain
[empty]
```

```text
$ npx vitest run
 FAIL  test/cli/codex.test.ts > squeal init --harness codex > touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/cli/codex.test.ts:103:3
    101|   });
    102|
    103|   it("touches nothing under a scratch HOME/.codex or CODEX_HOME, run a…
       |   ^
    104|     const repo = fakeRepo();
    105|     const home = runtimeDir();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/9]⎯

 FAIL  test/daemon/lifecycle.test.ts > squeal daemon: singleton and restart (spec 001 D10) > a registered consumer keeps an idle daemon alive
Error: daemon ready not met in 60000 ms
notes: ["daemon stopped: idle for 0.6 s with no registered consumers"]
daemon pid 4172993: exit code 0, signal null
stderr (last 2,000 characters): squeal daemon: daemon stopped: idle for 0.6 s with no registered consumers
squeal daemon: daemon stopped: idle for 0.6 s with no registered consumers

 ❯ waitReady test/daemon/helpers.ts:217:11
    215|     );
    216|   } catch (error) {
    217|     throw new Error(`${(error as Error).message}\n${diagnose(repo, spa…
       |           ^
    218|   }
    219| }
 ❯ test/daemon/lifecycle.test.ts:101:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/9]⎯

 FAIL  test/delivery/registered.test.ts > the revisions since registration (review wave 10b, N3) > are read in one query, however many there are
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/delivery/registered.test.ts:400:3
    398|
    399| describe("the revisions since registration (review wave 10b, N3)", () …
    400|   it("are read in one query, however many there are", async () => {
       |   ^
    401|     apply(edit(["src/a.test.ts"]), result(A, "pass"));
    402|     await delivery.register(C1, { atStart: true });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/9]⎯

 FAIL  test/harness/bundles.test.ts > bundled hooks, recorded JSON in and JSON out > serve every event end to end
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/bundles.test.ts:44:3
     42|
     43| describe("bundled hooks, recorded JSON in and JSON out", () => {
     44|   it("serve every event end to end", async () => {
       |   ^
     45|     const r = squealRepo();
     46|     r.apply(r.pass(), r.fail(SUBTRACTS));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/9]⎯

 FAIL  test/harness/bundles.test.ts > bundled hooks with a dead daemon > start a daemon, keep serving deltas from the store, and never stall
AssertionError: expected [Function] to not throw an error but 'Error: ENOENT: no such file or direct…' was thrown

- Expected:
undefined

+ Received:
"Error: ENOENT: no such file or directory, open '/home/agent/projects/squeal/.ai/cezar/tmp/9558952d-d8f8-464e-9437-ba22fb6913b9/squeal-cli-v4i7AQ/ran'"

 ❯ test/harness/bundles.test.ts:254:47
    252|     expect(() => readFileSync(ran)).not.toThrow();
    253|     // Review wave 3, S2: PostToolBatch restarts a daemon whose heartb…
    254|     expect(() => readFileSync(again.ran)).not.toThrow();
       |                                               ^
    255|   });
    256| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/9]⎯

 FAIL  test/harness/stop.test.ts > Stop within its 2 s hook timeout (review wave 3, N4) > gives up on a locked store before Claude Code would kill it
AssertionError: expected 2052.120594 to be less than 1875
 ❯ test/harness/stop.test.ts:176:23
    174|       expect(elapsed).toBeGreaterThanOrEqual(STOP_WAIT_CAP_MS);
    175|       // In process, so no Node start: the margin is left over.
    176|       expect(elapsed).toBeLessThan(HOOK_TIMEOUT_MS - STOP_MARGIN_MS / …
       |                       ^
    177|     } finally {
    178|       clearTimeout(lock);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/9]⎯

 FAIL  test/watcher/change-feed.test.ts > ChangeFeed > ends a rename storm with the candidate set matching the disk
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/watcher/change-feed.test.ts:116:3
    114|   });
    115|
    116|   it("ends a rename storm with the candidate set matching the disk", a…
       |   ^
    117|     const count = 200;
    118|     const name = (i: number, suffix: string) => `src/storm/f${i}${suff…

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[7/9]⎯

 FAIL  test/watcher/links.test.ts > checkIgnored beyond a symlinked directory > costs one more git call only for a batch that reaches a link
AssertionError: expected 246.84364470000008 to be less than 174.12497900000017
 ❯ test/watcher/links.test.ts:94:22
     92|     // Two git processes against one, and a scratch tree of one .gitig…
     93|     // a spawn to tens of milliseconds, so only an order of magnitude …
     94|     expect(linkedMs).toBeLessThan(plainMs * 10 + 100);
       |                      ^
     95|   });
     96| });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[8/9]⎯

 FAIL  test/runners/node-test/fixtures.test.ts > node:test fixtures under the current Node > gen-big.mjs > writes 1,000 modules and 200 test files, deterministically, under 10 s
AssertionError: expected 1 to be +0 // Object.is equality

- Expected
+ Received

- 0
+ 1

 ❯ test/runners/node-test/fixtures.test.ts:265:24
    263|         ["test/unit/t000.test.ts", "test/unit/t199.test.ts"],
    264|       );
    265|       expect(run.code).toBe(0);
       |                        ^
    266|       expect(named(run, "test:fail")).toEqual([]);
    267|       expect(named(run, "test:pass").length).toBeGreaterThan(0);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[9/9]⎯


 Test Files  8 failed | 285 passed | 1 skipped (294)
      Tests  9 failed | 2199 passed | 10 skipped (2218)
   Start at  17:21:04
   Duration  502.07s (tests 96%, transform 3%, import 1%)

```

The full gate failed. The run was at host load approximately 120 to 150. Four failures were 5 s test timeouts, one was a fixture daemon that exited after 0.6 s idle before its readiness was observed, one was a detached mock-daemon marker missing when checked, and two were timing assertions: 2,052 ms against a 1,875 ms wait limit and 247 ms against a 174 ms git-call limit. The ninth was a subprocess returning 1; this output does not establish its cause. These are verification observations, not proven breaks introduced by these six rows.

Only the eight failed files were rerun with two workers, without changing the candidate or the default test timeout:

```text
$ npx vitest run --maxWorkers=2 test/cli/codex.test.ts test/daemon/lifecycle.test.ts test/delivery/registered.test.ts test/harness/bundles.test.ts test/harness/stop.test.ts test/watcher/change-feed.test.ts test/watcher/links.test.ts test/runners/node-test/fixtures.test.ts

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/9558952d-d8f8-464e-9437-ba22fb6913b9

 ❯ test/harness/bundles.test.ts (32 tests | 1 failed) 38885ms
   ❯ bundled hooks, recorded JSON in and JSON out (1)
     × serve every event end to end 5264ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/harness/bundles.test.ts > bundled hooks, recorded JSON in and JSON out > serve every event end to end
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/bundles.test.ts:44:3
     42|
     43| describe("bundled hooks, recorded JSON in and JSON out", () => {
     44|   it("serve every event end to end", async () => {
       |   ^
     45|     const r = squealRepo();
     46|     r.apply(r.pass(), r.fail(SUBTRACTS));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 7 passed (8)
      Tests  1 failed | 112 passed (113)
   Start at  17:31:15
   Duration  108.40s (tests 91%, transform 8%, import 1%)

```

Eight of the original nine failures cleared. The remaining all-events bundle test still timed out at 5 s (5,264 ms), so it was checked alone with a 30 s test budget to distinguish an assertion failure from the original timeout.

```text
$ npx vitest run --maxWorkers=1 --testTimeout=30000 test/harness/bundles.test.ts -t 'serve every event end to end'

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/9558952d-d8f8-464e-9437-ba22fb6913b9


 Test Files  1 passed (1)
      Tests  1 passed | 31 skipped (32)
   Start at  17:33:24
   Duration  3.17s (tests 53%, transform 39%, import 8%)

```

The test finished in a 3.17 s run with its assertions passing. The longer test budget does not change the failed full-gate result. All dedicated regressions for the six reviewed rows passed in the full gate, including the three busy-store starts, checkpoint merging, lock waiting, starting-daemon headers, init/trust, linked-start and parcel-links.

The installed background validator is version 0.1.62, distinct from the candidate source gate. Its latest snapshot at revision 1 has a completed checkpoint and 17 known failures, including timing failures and fixture-process failures. It does not supply a green completion claim. In particular, its revision-1 linked-directory startup noise comes from the installed version preceding 001-166. The verdict above is based on the candidate source gate, diff inspection and independent probes.


Independent probes ran outside the repository, against the candidate's freshly built modules and bundles. Migration used scratch `HOME`, `CODEX_HOME` and, for Claude Code, `CLAUDE_CONFIG_DIR`. No real harness configuration was changed. Probe scripts and fixture directories were removed before committing.

```text
Claude project settings migration: preserved unrelated settings and existing hub source; idempotent.
Claude Code local old-install migration, new install and old uninstall: PASS
Codex local previous-id removal, hub install and persisted trust: PASS
PASS: 10 cross-process RESERVED-holder races; exactly one holder before its release; both successors acquire without timeout.
PASS: 50 differential traces, 3,000 operations: merged and per-file sink calls preserve states and transitions with duplicate checks, checkpoint changes and buffered unknowns.
```

## Scope

The brief names six rows, reviewed in the repository at the candidate. Their product commits are:

| Row | Product commits | Boundary checked |
| --- | --- | --- |
| 001-156 | `2531e86` | Starting-daemon liveness, registration, tool delivery, prompt and Stop |
| 001-153 | `2faa395` | Successor retries and exclusive singleton ownership |
| 001-164 | `d53df79`, `84b4865`, `28bf609` | Both init paths, previous-id handling, Codex trust and remove instructions |
| 001-161 | `d9c4f88`, `40a93ed` | Checkpoint application, store startup, hook connection budgets |
| 001-166 | `4d7c203` | Linked-directory seed and reconciliation candidates |
| 001-167 | `53879f8` | Parcel hidden-extra subscriptions and canonical-path mapping |

Supporting tests and amendments were read, including `6374c30`, `691d5d4`, `ee325ed` and `5eab8cc`. Corresponding plugin builds were verified through the clean build. Rows 001-159 and 001-168, and the other coordinator's rows, are excluded as the brief requires. Existing accepted limits were not reopened.

## Blockers

None.

## Should-fix

None in the scoped rows.

## Nits

None.

## What fits

- **001-156, proven by source and tests; D6, D9, D10.** Registration records the spawn time only after an actual spawn without a fresh heartbeat. The header says the daemon is starting while the stored liveness remains down. The told-liveness view suppresses both a premature outage and the first heartbeat's recovery. Ten seconds without a heartbeat produces one outage; a heartbeat followed by a stop ends the grace immediately. The settle wait is bounded separately from daemon startup. The existing tests cover these cases and the ordinary two-interval heartbeat boundary.
- **001-153, proven by source, tests and cross-process probe; D10.** Each failed lock attempt closes its connection, releasing partial SQLite locks. A winner retains `BEGIN EXCLUSIVE` until release. Ten races with two successor processes behind a RESERVED holder produced one winner while it held the lock, then the other after release; every attempt completed without a timeout, with acquisition times 51 to 142 ms including the imposed hold. Neither successor served beside the other.
- **001-164, proven by both real harness CLIs and source; row done-when, D9 and spec 002 D1.** Claude init removes the previous project entries, enables the hub id, preserves an existing hub source and unrelated settings, and is idempotent. A real scratch Claude install migrated from `squeal@squeal` to `squeal@hearsay`; uninstalling the old id left the new project install enabled. Real scratch Codex init detected the old-only install and exited 1 without trusting it. Its printed removal commands succeeded; after installing the hub id, `--trust --yes` trusted nine hooks, and a fresh app-server read all nine back as trusted. The new key source shares the declaration hashes with the old id. Local manifests intentionally retain the old marketplace name, as the row's recorded decision says.
- **001-161 checkpoint application, proven by source, tests and differential probe; D6, D8.** Consecutive entries merge only while their checkpoint matches and their check identities do not repeat. A repeated check starts a new sink call and sees the prior state. Fifty traces compared the candidate with per-file sink calls using the real store and sink: 3,000 operations covering pass, fail, skip, repeated checks, changed checkpoints and buffered unknowns produced identical known states and transition histories. Unknowns, retirements and refresh remain in their original buffered order. This removes the repeated whole-worktree reads from an ordinary large tier without changing its transitions.
- **001-161 startup budget, source verified; D8 and goal 6.** Only `openDaemon` selects the 120 s store timeout. It is lowered to 5 s after loop startup. Hook contexts retain their own short timeout, and socket requests retain their bounded timeout; the daemon's longer busy wait is not passed to a hook. The busy-store regression exercises three starts beside two 7 s writers. It passed in the completed full gate.
- **001-166, source and regression coverage; D2.** The seed and the reconciliation pass share `linksAmong` and `filesUnderLinks`, including the same exclusions and nested-repository rules. Seeding only previously unknown paths does not erase an earlier cached hash. The integration cases distinguish an initial linked tree from an edit under the link, a real addition after the seed while watching starts, and a later addition found solely by reconciliation. The linked-files and linked-start regressions passed in that gate.
- **001-167, source and Linux regression coverage; D2.** Hidden extras are grouped by the real parent directory and canonical file spelling. Every declared alias is retained, and an event is mapped back to each alias before candidate reconciliation. Unrelated files of that directory remain filtered. Updating the watch subscribes the new specification before unsubscribing the old one. All three parcel-links cases passed in that gate. Linux evidence does not verify FSEvents behavior on macOS.

## Inputs for the next wave

No fix wave is required by this scoped review. Keep the checkpoint grouping's duplicate-check split when adding inherited-failure confirmation; do not replace it with one unconditional sink call. Keep hook busy timeouts separate from daemon startup, and keep the canonical-to-declared alias map for parcel extras. The adjacent stale-transform review belongs to 001-169 and is not covered here. The full gate's failures remain a release-verification concern until independently settled; this verdict supplies the missing code review of these six rows.
