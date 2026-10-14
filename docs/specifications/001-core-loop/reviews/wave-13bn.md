# Wave 13bn: review 001-374 of 001-360 and 001-361

## Verification and verdict

Candidate: `69a6ea23c44b237e009e0cee21d17f1ed2f66c79` (0.1.174). Requested range: `ec64fa0f^..69a6ea23`.

PASS: zero blockers, zero should-fix items, two proven metadata nits. Product prosecution found no blocking break of D4, D6 or either row's done-when. Two proven provenance/board nits below are nonblocking.

The initial clean HEAD was `83e2d4e8614944b911ffc3113198b27bc05b525a`, one board-only successor beyond the pin. Switched detached to the exact candidate before installation, commands and probes. All verification below is from that clean candidate; no candidate code was rewritten. Build left every committed plugin bundle and manifest unchanged. After verification, the owned branch was restored at its board-only successor to commit this report alone; the evidence remains pinned to `69a6ea23`. The full suite was run independently, rather than through Squeal, with four outer workers to limit contention. Commands run with a private HOME, temp and XDG directories, explicit private Codex/Claude/Pi config directories, an allowlisted environment without credentials or session identities, and no user git config. The standalone probe used the compiled modules and its own fixture and store below `/tmp`; it removed the fixture/store afterwards. No real agent provider was used.

```text
$ npm ci
npm warn deprecated node-domexception@1.0.0: Use your platform's native DOMException instead

added 174 packages, and audited 175 packages in 25s

28 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 4 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @google/genai@2.21.0 (preinstall: echo 'preinstall: no-op')
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts   protobufjs@7.6.6 (postinstall: node scripts/postinstall)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
exit 0
```

```text
$ npm run lint
> squeal@0.1.174 lint
> biome check .

Checked 1135 files in 1388ms. No fixes applied.
exit 0
```

```text
$ npm run typecheck
> squeal@0.1.174 typecheck
> tsc --noEmit
exit 0
```

```text
$ npm run build
> squeal@0.1.174 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.174 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts
exit 0
```

```text
$ npx vitest run --maxWorkers=4
⎯⎯⎯⎯⎯⎯ Failed Suites 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/runners/node-test/enumerate.test.ts [ test/runners/node-test/enumerate.test.ts ]
Error: Hook timed out in 10000ms.
If this is a long-running hook, pass a timeout value as the last argument or configure it globally with "hookTimeout".
 ❯ test/runners/node-test/enumerate.test.ts:20:1
     18| const SLOW = { timeout: 60_000 } as const;
     19|
     20| afterAll(() => rmSync(scratch, { recursive: true, force: true }));
       | ^
     21|
     22| interface TestEvent {

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/3]⎯


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a --await-lock waiter reads again and exits as a loser, no note, once the store is readable
AssertionError: expected { …(6) } to match object { reason: 'lost-lock', code: +0 }
(6 matching properties omitted from actual)

- Expected
+ Received

  {
-   "code": 0,
-   "reason": "lost-lock",
+   "exited": Promise {},
+   "ready": Promise {},
+   "root": "/home/agent/projects/squeal/.ai/cezar/worktrees/2d3300df-9127-427c-9dd0-90bc6f826f67/test/fixtures/scheduler/.tmp/479971ab-c08e-4333-be15-af8178613f07/main",
+   "socketPath": "/tmp/sq-bGw6OQ/squeal-6c1362c717195fce.sock",
+   "stop": [Function stop],
+   "worktreeId": "6c1362c717195fce",
  }

 ❯ test/daemon/vacant-wait.test.ts:180:22
    178|       // The premise: the first read under the lock found the store bu…
    179|       expect(elapsed).toBeGreaterThanOrEqual(DAEMON_BUSY_TIMEOUT_MS);
    180|       expect(result).toMatchObject({ reason: "lost-lock", code: 0 });
       |                      ^
    181|       expect(readNotes(repo)).toEqual([]);
    182|       const lock = acquireDaemonLock(lockFile(repo));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/3]⎯

 FAIL  test/daemon/vacant-wait.test.ts > a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) > a waiter that cannot decide within its budget lets go of the lock and exits with one note, code 0
Error: database is not open
⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/3]⎯


 Test Files  2 failed | 538 passed | 1 skipped (541)
      Tests  2 failed | 4470 passed | 79 skipped (4551)
   Start at  20:30:49
   Duration  940.28s (tests 96%, import 3%, transform 1%)

    Isolate  541 workers spawned · ~186ms startup each (spawn + environment, per file)
             at least ~24.98s faster with isolate: false — reuses workers across files instead of one per file
exit 1
```

The independent full suite is red. Every changed test file passed: `test/runners/vitest/suite-errors.test.ts` (4), `test/scheduler/error-causes.test.ts` (1), `test/scheduler/records.test.ts` (7), and `test/state/failure-causes.test.ts` (8). The key-format guard also passed (28). The two unsuccessful files and the daemon lock/version-read and enumeration/graph implementations they exercise are unchanged in the range. The enumeration suite failed its cleanup hook after all 15 cases passed. The lock-wait suite returned a serving handle where its test expected `lost-lock`, and a later case reported a closed database. These are recorded failures, not findings against this wave. Their full-run cause is **unverified**. Host load was sampled above 125 during the run; that is context, not proof of causality. Python/pytest-dependent coverage was partly skipped in this isolated environment; skipped tests are not passing evidence.

Both unsuccessful files were rerun once together, sequentially, on the same clean candidate; all 21 tests passed. No full suite was repeated, and this narrow green result does not replace the red full-suite output. The coordinator must give that gate its own disposition before landing.

```text
$ npx vitest run test/runners/node-test/enumerate.test.ts test/daemon/vacant-wait.test.ts --maxWorkers=1
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/2d3300df-9127-427c-9dd0-90bc6f826f67

stdout | test/runners/node-test/enumerate.test.ts > enumeration cost > enumerates 200 generated test files in under half a cold graph build
node-test enumeration against a cold graph build, 9 rounds: median 0.196

 ✓ test/runners/node-test/enumerate.test.ts (15 tests) 3198ms
   ✓ enumeration cost (1)
     ✓ enumerates 200 generated test files in under half a cold graph build 2611ms
 ✓ test/daemon/vacant-wait.test.ts (6 tests) 18182ms
   ✓ a lock waiter decides again once it holds the lock (review 001-347, B2) (3)
     ✓ a vacant-lock waiter serves when a daemon of its own version came and went (accepted, D10) 992ms
     ✓ a successor exits as a loser, no note, when the last recorded daemon is newer than itself 360ms
   ✓ a lock waiter that cannot yet read the last recorded daemon (review 001-351, B1) (3)
     ✓ a vacant waiter reads again and exits as a loser, no note, once the store is readable 7092ms
     ✓ a --await-lock waiter reads again and exits as a loser, no note, once the store is readable 7090ms
     ✓ a waiter that cannot decide within its budget lets go of the lock and exits with one note, code 0 2586ms

 Test Files  2 passed (2)
      Tests  21 passed (21)
   Start at  20:47:02
   Duration  22.51s (tests 96%, transform 3%, import 1%)
exit 0
```

```text
$ node --disable-warning=ExperimentalWarning <private probe.mjs>
self-cycle: [{"length":200,"code":"0"},{"length":200,"code":"0"},{"length":200,"code":"0"}]
two-object cycle and primitive: PASS
test/after.test.ts [{"kind":"test","outcome":"pass","summary":null},{"kind":"file","outcome":"fail","summary":"setup failed: late failure","phase":"setup"}]
test/before.test.ts [{"kind":"test","outcome":"skip","summary":null},{"kind":"file","outcome":"fail","summary":"setup failed: early failure","phase":"setup"}]
test/empty.test.ts [{"kind":"test","outcome":"pass","summary":null},{"kind":"file","outcome":"fail","summary":"setup failed: No test found in suite empty","phase":"setup"}]
legacy JSON and new optional fields survive store close/reopen; fingerprint unchanged: PASS
key format 9 versus 10 changes environment hash: PASS
exit 0

$ git rev-parse HEAD
69a6ea23c44b237e009e0cee21d17f1ed2f66c79
$ git status --porcelain
<empty, after build, full suite, probe and narrow rerun>
```

## Blockers

None.

## Should-fix

None.

## Nits

### N1. Proven, nonblocking: supplied HEAD did not match the candidate

Location: initial git `HEAD`, before verification. Expected `69a6ea23`, actual `83e2d4e8`. `git show --stat HEAD` shows only `docs/board.md` changed. This was corrected locally by detaching at the candidate; the review's evidence therefore does apply to the pin. Coordinator-sized fix: initialize a pinned review checkout at the supplied SHA, or identify the successor as the review checkout in the brief. No product repair is required.

### N2. Proven, nonblocking: the pinned board still says both rows are running

Location: `docs/board.md:463` and `:464` at the candidate. Rows 001-360 and 001-361 still say `running`, while their implementations, worker notes, amended spec and rebuilt 0.1.174 bundles are present. The initial board-only successor `83e2d4e8` already changes them to done and adds the review/count follow-up rows. Coordinator-sized fix: retain that successor when integrating the report; do not dispatch these rows again. No board edit belongs in this reviewer commit.

## What fits

- **Honesty and suite integration (D4/D6, 001-360).** The candidate reads each suite's own errors after the module's. Parent failures do not duplicate the innermost suite's error. A describe-level beforeAll failure stores a file FAIL and the affected test SKIP; a test outside the suite keeps PASS. The new empty-describe regression agrees with Vitest's own verdict. The standalone probe independently observed nested beforeAll failure, afterAll failure and an empty describe through the real adapter and recordsForFile.
- **Bounded causes (D4, 001-361).** `src/runners/vitest/results.ts:60` advances one chain entry per iteration and stops at three. The self-cycle probe produced three 200-character messages with numeric code `0` preserved; a two-object cycle produced `a`, `b`, `a` and returned. Primitive causes also work. There is no recursive stored object. Codes stay whole as D4 explicitly requires, so this is a depth/message bound, not a fixed byte bound on arbitrary codes or the original error's stack.
- **afterAll phase (D6, brief 2).** `src/core/scheduler/records.ts:92` tags the file error setup whenever that file reports tests, including passed tests before afterAll fails. The independent real-adapter probe stored the test PASS and the file FAIL, `phase: setup`, summary `setup failed: late failure`. This is exactly amended D6's shared beforeAll/afterAll wording; it is not an attempt to identify the exact hook from the serialized error. A missing import has no reported tests and stays load, as the new scheduler/store test asserts. Empty describes follow the same reported-test rule.
- **Stored-error compatibility (D4/D6, brief 3).** The new fields are optional. The result repository JSON-serializes the full errors array, deduplicates exact summary/error text separately from the diagnostic fingerprint, and decodes without stripping new fields. The probe wrote an old error with no code/causes/phase and a new setup error under different keys, closed/reopened the store and read both intact. An old error still renders its original summary; absent fields need no schema migration. The fingerprint of an otherwise identical old and rich error stays equal.
- **Key compatibility.** Environment encoding includes KEY_FORMAT_VERSION. The probe compared the identical inputs encoded with version 9 and the candidate's version 10: hashes differ. The candidate re-pins version 10 under the explicitly supplied unreleased-version exception. Historical rows remain queryable without being accepted under a different format. Retain that exception only until version 10 is released.
- **Rendering and the old-wording search (D6, brief 4).** The shared stored summary carries code, causes and setup wording into per-check delivery and status; formatWhy adds code when missing from the stack and a Caused by line per stored link. The new scheduler test goes through the real adapter, scheduler, store, delivery, status and why, rather than stubbing those seams. Existing tests cover summary/delivery caps and unchanged fingerprints. Searching src and the three shipped skills found the retained wording only in counts/aggregate renderers and the checkpoint command reference, all explicitly deferred by D6 to 001-373. No missed per-check quoter was found.
- **Test quality/style.** The new cause mapping test asserts depth, per-message length, path relativization, intact codes and unchanged legacy object shape. The store-facing integration asserts actual ECONNREFUSED and ERR_MODULE_NOT_FOUND. The changed modules keep the core/runner type boundary, add no dependency and require no protocol/schema bump. The cycle and legacy-reopen guarantees above were independently probed; those exact adversarial shapes are not permanent regressions in the candidate.

## Inputs for the next wave

1. No product repair wave is required by this review. The red full-suite gate above remains for the coordinator to disposition; its failures passed on one narrow rerun, with their cause unverified. Keep the stored optional `code`, `causes` and `phase` fields and the unchanged diagnostic fingerprint. `recordsForFile` remains the phase owner; runner adapters supply file errors and actual reported test outcomes. Do not turn Vitest's reported SKIP or PASS into per-test FAIL just because a suite hook failed.
2. 001-373 must cover every retained aggregate wording path: `src/core/status/checks.ts:60`, `src/core/delivery/format.ts:77`, `:356`, `:470`, `src/core/delivery/collapse.ts:81`, `src/cli/verdict.ts:118`, and `plugins/claude-code/skills/squeal/references/commands.md:74` with its generated Codex/Pi copies. Count phase from the stored result or known state before formatting; do not infer setup from error text. Preserve totals, pending/stale/current treatment and delivery caps. Test mixed load/setup/test failures, baseline, overflow, collapsed still-failing lines and run --all's verdict. Historical errors lack phase, so define a conservative fallback instead of guessing their hook.
3. Budgets remain three cause links, 200 characters per cause message, whole codes, a 300-character summary and the existing 10,000-character delivery cap. afterAll uses setup under the current two-phase contract. Any third phase/word requires a spec amendment, not a reinterpretation of this review.
4. Scope provenance: `ec64fa0f^` is `d4a019d0`, so the requested range excludes the reporter fix commit itself and its first three suite regressions. Those are in the pinned candidate and were inspected as the integration boundary explicitly requested by the brief. The range contains the empty-describe regression and the cause/phase changes. Include `d4a019d0` in the review coverage attached to a release of 001-360.
