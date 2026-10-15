# Wave 13bt: candidate 0.1.189 (001-401)

**FAIL** `bc1f4bfc66b81cee7d9d9cd9507132e62da79553`: **3 proven blockers, 1 proven should-fix, 1 proven nit**.

Range: `b5d33c29..bc1f4bfc`. Rows 001-390, 001-393, 001-400, 001-396, 001-399 and 001-385. Reviewed against their notes, spec 001 D3/D4, D11 Fidelity and Priority, D12, and the vision's truthful evidence rule. No candidate code changed.

## Verification output

All required checks completed on the clean pinned candidate. The independent full suite passed; the isolated probes below still prove three cases the committed tests do not rule out. The draft was committed early at the coordinator's request, then HEAD was restored to the candidate before the full suite acquired the host lock. HEAD and the clean tree were verified again after it finished.

```text
$ git rev-parse HEAD
bc1f4bfc66b81cee7d9d9cd9507132e62da79553
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
(exit 0; npm also printed one deprecation warning and the six-package install-script allow-list warning)

$ npm run lint
> squeal@0.1.189 lint
> biome check .
Checked 1254 files in 381ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.189 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.189 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.189 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git status --short
(no output; all four committed bundle trees match the build)
```

Independent test command, completed with exit 0, with HOME and both XDG directories under `/tmp/squeal-review-13bt`:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock \
  env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  HOME=/tmp/squeal-review-13bt/home \
  XDG_CONFIG_HOME=/tmp/squeal-review-13bt/config \
  XDG_RUNTIME_DIR=/tmp/squeal-review-13bt/runtime \
  npx vitest run --maxWorkers=4
```

```text
 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/25b9989d-60da-43c2-abdb-79e6ace29a3e

 Test Files  606 passed | 1 skipped (607)
      Tests  4866 passed | 94 skipped (4960)
   Start at  08:15:17
   Duration  586.04s (tests 98%, import 2%)

    Isolate  607 workers spawned · ~110ms startup each (spawn + environment, per file)
(exit 0)
$ git rev-parse HEAD
bc1f4bfc66b81cee7d9d9cd9507132e62da79553
$ git status --short
(no output)
```

Node v24.21.0, Linux, 24 CPUs. The full run started at 06:15:17 UTC (08:15:17 local). Host load immediately before start was 6.27 / 11.29 / 18.15; at the completion check, 5.41 / 8.14 / 13.06. Output also included Vitest's experimental typechecking warning, two fixture-local `gitdir incorrect` repair messages, and `squeal tests: killing 1 process(es) an earlier run left: 2802710`. No test failed and no current-run process leak failed teardown.

**Files failing the full run but passing alone: none.** No isolated reruns were needed. Squeal's separate baseline had reported `test/harness/opencode-dispose.test.ts:193` failing; it passed in this independent full run. That baseline is not substituted for this gate. The first lock waiter was terminated (143) before acquiring the lock, with an empty test log; the replacement above is the only independent full execution.

No changed candidate source or test has been committed or left behind. All throwaway probes use temp fixtures, isolated HOME/XDG paths, this checkout's sources/dependencies, and explicitly cleaned-up children; none accesses another checkout or cezar.


## Blockers

### B1. An inherited `--import` is not promoted before a child's own preload (proven)

**Where:** `src/runners/observe/spawn.cjs:97`, and the Worker's `SHARE_ENV` branch at line 183.

**Contract:** D11: “It stays a `--require` where a `--require` is already present: in the inherited `NODE_OPTIONS`, in a spawned child's own arguments or shell command, or in a Worker's `execArgv`.” D3/D4 put observed reads in the file's closure; losing one can retain a PASS after its data changes.

The check for an existing recorder skips *choosing its form*. Most children inherit the parent's recorder, now an `--import`. Even with an explicit argv `--require`, they retain that import, so the project's preload executes before recording starts. Workers with their default env do the same. `SHARE_ENV` bypasses injection altogether, so changing only the duplicate check does not repair that case.

**Probe:** standalone Node process under the candidate recorder, a fresh temp root with `pre.cjs` reading `input.txt`, and `child.cjs` printing the preload's global value. The recorder settings attribute all reads to a synthetic `test.ts`. Run the following from `main.mjs`, once per environment, and inspect all recorder output files for `input.txt`:

```js
// pre.cjs
// globalThis.answer = require('node:fs').readFileSync(__dirname + '/input.txt', 'utf8');
// child.cjs: console.log(globalThis.answer);
spawnSync(process.execPath, ['--require', './pre.cjs', 'child.cjs'], options);
// thread.cjs: require('node:worker_threads').parentPort.postMessage(globalThis.answer);
new Worker('./thread.cjs', { ...options, execArgv: ['--require', './pre.cjs'] });
```

Parent env: `NODE_OPTIONS=--import "<file URL of src/runners/observe/recorder.cjs>"`; `SQUEAL_OBSERVE={"root":<temp>,"out":<temp/out>,"skip":[],"file":<temp/test.ts>}`. Give the parent an isolated HOME and XDG directories. Wait for the child and Worker before reading output.

| Case | Child output | `input.txt` recorded, candidate | Before, recorder as `--require` |
| --- | --- | --- | --- |
| spawnSync, default env | secret | no | yes |
| spawnSync, `{...process.env}` | secret | no | yes |
| spawnSync, `env: {}` | secret | yes | yes |
| Worker, default env | secret | no | yes |
| Worker, `env: {}` | secret | yes | yes |
| Worker, `SHARE_ENV` | secret | no | yes |

The before arm used the three recorder files archived from `b5d33c29` into a temp directory, not another checkout. An additional probe through `createVitestAdapter({root, observe: () => true})` ran a passing test that spawns the child with default env: `report.observed` omitted `input.txt` too. The committed delivery test's explicit `env: {}` avoids the broken branch.

**One-worker fix:** choose the recorder's required position at every spawn even when it is already present; preserve the foreign-recorder guard and avoid duplicate execution. Handle a Worker's shared env without replacing its sharing semantics. Add inherited-env and SHARE_ENV preload-read regressions, including a child or Worker that spawns another child. Rebuild the four bundles and re-pin the unreleased key format.

### B2. The argv/shell regex both misses preloads and invents them (proven)

**Where:** `src/runners/observe/spawn.cjs:30` and `:98`.

**Contract:** the same D11 requirement includes a child's “shell command”; Fidelity says a verdict caused by Squeal's additions is “a defect to fix at its source, never an accepted cost.”

The one regex treats argv elements, NODE_OPTIONS text and shell syntax alike. It does not recognize the shell's single quotes. It also scans arguments *after the program entry*, where `-r` is application data. The first error loses reads; the second forces an unnecessary `--require` and restores the very package.json false failure this row is meant to remove.

**Probe A:** use B1's fixture and parent env, but give the shell `env: {}` so B1 cannot account for the miss:

```js
spawnSync('/bin/sh', ['-c', JSON.stringify(process.execPath) + " '-r' ./pre.cjs child.cjs"],
  { env: {}, encoding: 'utf8' });
```

Candidate: exit 0, stdout `secret`, `input.txt` absent from the recordings. Before: exit 0, the read recorded. The shell removes the quotes and Node receives the ordinary `-r` flag.

**Probe B:** a temp `bad/package.json` contains `{ broken`; `child.cjs` lies outside `bad` and only prints `ok`:

```js
spawnSync(process.execPath, [absoluteChild, ' -r '],
  { cwd: badDirectory, env: {}, encoding: 'utf8' });
```

Without the recorder: exit 0, `ok\n`, no stderr. Under the candidate's parent recorder: exit 1, `ERR_INVALID_PACKAGE_CONFIG` for `bad/package.json`. There is no Node preload in this call: the regex mistakes the program argument for one. This discriminates the new detector; the earlier recorder always used require and failed this case as well.

**One-worker fix:** distinguish Node's option region from its program arguments, NODE_OPTIONS tokenization, and shell quoting. Cover unquoted and single/double-quoted shell `-r`/`--require`, and a post-entry argument containing `-r`. Preserve the existing unquoted `node -r` and Worker execArgv tests. An unsupported shell form needs a stated policy; indiscriminate matches can alter verdicts. This worker and B1 share `spawn.cjs`, so dispatch them serially or as one repair row.

### B3. A project's own missing file is attributed to Squeal with observation disabled (proven)

**Where:** `src/runners/observe/signature.ts:34`, `:36`, and `src/core/state/fingerprint.ts:128`; called unconditionally in `src/runners/vitest/adapter.ts:463`.

**Contract:** D11 names “a signature of the recorder”, not an arbitrary project file with the same basename. The review brief explicitly requires that the signature note not fire on a real project failure. The vision requires evidence that does not misrepresent what ran.

The missing-file pattern accepts any path ending in `/(observe|node-test|runtime)/recorder.cjs`. Its `inNodeOptions: false` bypasses even the observation guard. A project failure can therefore claim the test ran under Squeal's recorder when no recorder ran at all.

**Probe:** in an isolated temp Vitest project (one worker, its node_modules symlinked to this checkout's installed dependencies), run this test through `createVitestAdapter` with observation both on and off:

```js
it('missing project file', () => {
  execFileSync(process.execPath,
    ['-e', `require(${JSON.stringify(absoluteProjectRoot + '/src/observe/recorder.cjs')})`],
    { env: {}, stdio: 'pipe' });
});
```

Do not create that project file. Both reports fail with the same real MODULE_NOT_FOUND and **both** set `errors[0].recorder = "its file is missing"`. `describeFailure` renders `ran under Squeal's recorder in NODE_OPTIONS: its file is missing` even for `observe: () => false`. A nested `src/observe` path also survives the adapter's project-path relativization and matches the regex.

A second real-project probe imports a `.js` file beneath a malformed project `bad/package.json`. It fails without observation too, yet observation adds “a --require preload makes Node parse the nearest package.json”, though this is an ordinary module load. The spec's explicit broad ERR_INVALID_PACKAGE_CONFIG rule currently permits that second match; it is evidence that the rule needs narrowing, rather than proof that Squeal caused the project failure.

**One-worker fix:** establish recorder ownership from the recorder path(s) actually used by the run, retaining that identity through error-path relativization. Do not infer ownership from a suffix. Preserve genuine missing installed-recorder diagnostics and old-Node diagnostics, and add negative adapter tests with observation disabled and with a real project's invalid package. Align D11's signature wording with what the implementation can prove. Preserve the fingerprint and summary budget guarantees.

## Should-fix

### S1. A child reparented before the first look keeps normal priority indefinitely (proven, nonblocking)

**Where:** `src/core/daemon/escaped.ts:133`; `src/core/daemon/low-priority.ts:40`.

The narrowed search drops the former group-orphan fallback. The worker notes disclose this. It is outside 001-393's done-when for a still-live short fork, so it does not block this wave, but it weakens D11's broader “what it spawns inherits it” statement.

**Probe:** run a Node probe as its own process-group leader (`setsid node probe.mjs`), start `lowerWhile` at nice 0, and spawn `/bin/sh -c 'sleep 30 >/dev/null 2>&1 & echo $!'` with `children.envFor('fast')`. Wait for the shell to exit, then wait 350 ms. On the candidate, the reported sleeper PID had priority **0** and `children.carriers('fast', since)` returned **[]**. Kill the recorded sleeper in `finally` and abort/join `lowerWhile`. The probe touched only its own processes and temp HOME/XDG directories.

**One-worker follow-up:** retain the cheap 100 ms direct-child look, with a bounded fallback for marked processes whose parent escaped that look, or explicitly amend the broader priority promise to name the uncovered case. A child that leaves early must not force a full process scan ten times a second.

## Nits

### N1. D11 describes a hard 100 ms bound that the loop does not provide (proven)

**Where:** `docs/specifications/001-core-loop/spec.md:211`; `src/core/daemon/low-priority.ts:40`.

“Every 100 ms” and “from its first 100 ms” read as elapsed-time guarantees. The loop sleeps for 100 ms *after* each scan finishes; environ reads are async, and event-loop scheduling adds delay.

**Probe:** call `lowerWhile` with a fake `carriers` that records its call time, awaits 40 ms, returns `[]`, and aborts on its third call. Actual times were **102, 242, 383 ms**, intervals **140 and 141 ms**. This is an API timing probe, not a claim about normal scan cost.

**Fix:** say a 100 ms polling delay plus scan/scheduling time, not a hard deadline. The implementation's “about EVERY_MS” is appropriately qualified. Keep the measured cost beside that wording.

## What fits

- The default runtime-recorder import fixes the malformed-cwd package case in the added forks, threads, Worker and node:test warm-up fidelity tests. The node:test module recorder deliberately stays require in argv, and in env for slow projects or project preloads. `NodeTestReads.env` is given that env, so it also uses require beside those module preloads. B1/B2 concern the runtime recorder's spawn boundary, not a request to convert the module recorder.
- `ownNodeOptions` removes nested Squeal recorders before choosing the top-level form. Top-level detection tokenizes NODE_OPTIONS rather than using the shell regex. The environment hash strips the leading injected import or require by decoded path. The key pin is format 10, hash `6487978f23650ed2b3d2ba075689b222f42ad632f5d2aacfe95a7c6924eec1a9`.
- 001-396 operates after the delivery header and annotated entries are read within the store transaction. It suppresses only the acknowledgement, still spends the once-per-consumer state, and preserves the settled note. A direct predicate probe returned suppression true only for an actual re-keyed result with nothing pending; pending checks, pending files without checks, runner-part pending, no result, and an unrelated result each returned false. The committed integration tests cover pending work and spending, with Claude Code, Codex and OpenCode wording.
- 001-399's input globs include the package and source inputs; the repository-input tests exercise re-keying on both. A temp `git archive` of each package at the base and candidate, followed by isolated `npm pack --dry-run --json --ignore-scripts`, produced **identical paths: OpenCode 24, Pi 19**. The two `.gitignore` files change watching, not the shipped file lists.
- The 001-385 helper centralizes build/removal hook bounds at 180 s, and the formerly manual daemon suites use it. Its injected slow build/removal test exceeds the 100 ms default by 300 ms on each side. The standalone symlinked-source removal gets its build's existing 120 s bound. No product timing changed there.
- The direct-child scan measured **0.469 ms wall, 0.499 ms CPU per look**, 500 warm-cache looks with 8 marked and 2 unmarked Node children, all 8 found. At ten looks per second this is about **5 ms CPU/s per active lane**, before descendant lowering, not a whole-daemon or many-lane CPU budget. Children were killed and reaped after the probe.
- D12 now separates liveness for signaling/linking (`statOf` rejects Z/X and PF_EXITING) from completion of every thread (`exited` checks pid/start and, for a zombie, its task directory). `childrenOf` covers every daemon thread. The first scan follows the initial wait; remaining identities enter round one; each round waits again before rescanning. Signals still recheck pid/start. This matches the amended D12 and addresses the exit windows described in 001-400's probes.

## Shutdown budget and limits

The new wait is bounded independently, not once for the whole stop. With immediate proc reads and timely scheduling, the maximal explicit sleep budget of one `#stop` is **7 s**: 1 s for `#workersGone`, then at most three rounds each of up to 1 s in `terminate` and 1 s in `gone`. The new per-round waits add at most 3 s over the former flow. The initial wait and each round act on identity snapshots, not continuously growing waits.

That is not a 7 s bound on daemon shutdown. Shutdown first drains in-flight tiers, whose `afterEachRun` sweeps can each take that budget; it then closes the runners and performs a separate at-exit sweep, another nominal 7 s, before scratch/store/socket/lock cleanup. Reading proc, waiting for the event loop, runner close and cleanup are outside those sleep budgets. The initial child-environ reads happen before `gone` starts its deadline, so the code provides no hard global wall-clock bound there. Do not promise a strict daemon-exit deadline from GRACE_MS alone. No new proven D12 leak was established; all three committed escaped tests passed in the independent full gate above. The worker's contended 50-run proof was read, not repeated as another full proof.

## Inputs for the repair wave

1. Repair B1/B2 in one owned `spawn.cjs` row, or serial rows. Tests must read data only from project preloads and cover inherited/default/empty/shared envs, grandchildren, and quoted shell commands. Assert the observed file set as well as test outcome. Retain malformed-cwd fidelity in both pools and node:test warm-up.
2. Repair B3 separately in signatures/reporting, carrying exact recorder identity through the runner boundary. Assert absence of the note for real project errors, not merely an ordinary assertion message; verify both observing and non-observing runs. Fingerprints must remain unchanged by the note and summaries stay within 300 characters.
3. Rebuild all four shipped plugin trees and re-pin the unreleased format 10 once for the combined repair. Keep the candidate version claim with the coordinator. Do not change the node:test module recorder into import as part of these repairs.
4. Fold S1's priority coverage and N1's stated timing bound into the coordinator's next briefs/spec amendment. There is no request for another 50-run stop proof unless a repair changes the shutdown code.
5. Re-review the repair against B1/B2/B3 and its delta. This verdict does not authorize landing the current candidate.

## Second-round addendum — 2026-10-15

**FAIL `252e7ac9b362ca0c19a2c85f8ba177775a9b18a0` — 1 blocking finding (B2), 2 should-fix notes (S1, S2), 0 open nits.** B1 and B3 are repaired; N1 is resolved. This is the narrow re-review requested for the repaired candidate, not a fresh prosecution of the original bundle. B2 remains the original false-preload/fidelity defect. S2 is a new seam note, nonblocking under this re-review's bound. The coordinator takes a second-round FAIL to the human (process step 6).

### Verification at the repaired candidate

Every check and probe below ran at the exact candidate, before switching back to the review-only branch at `ba9eabe016f93289d395649d81f56c245faab929` to append this text. The candidate was clean before and after verification. Line references below name the candidate's source, not the older source beneath this review commit.

```text
$ git rev-parse HEAD
252e7ac9b362ca0c19a2c85f8ba177775a9b18a0
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
(exit 0; also deprecation and uncovered-install-script warnings)
$ npm run lint
> biome check .
Checked 1259 files in 559ms. No fixes applied.
(exit 0)
$ npm run typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
$ git status --porcelain=v1
(no output)
```

All tracked dist files are byte-identical after `npm ci` and the build. The new `preloads.cjs` is present in every shipped observe runtime.

Scoped runs, each with exit 0, using isolated HOME, XDG_CONFIG_HOME and XDG_RUNTIME_DIR, `env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4` followed by the listed files:

```text
test/runners/observe/preloads.test.ts
 test/runners/observe/spawn-preload.test.ts
 test/runners/observe/signature.test.ts
 test/runners/vitest/observe-signature.test.ts
 test/runners/vitest/observe-fidelity.test.ts
 test/runners/node-test/run-reads-fidelity.test.ts
 test/daemon/low-priority.test.ts
 test/keys/key-format.test.ts

Test Files  8 passed (8)
     Tests  57 passed (57)
  Duration  5.98s

 test/runners/observe/delivery.test.ts
 test/runners/node-test/adapter-attribution.test.ts
 test/harness/codex/plugin.test.ts

Test Files  3 passed (3)
     Tests  30 passed (30)
  Duration  3.45s
```

No scoped file failed. **No second independent full suite was run**, as the parent explicitly requested scoped runs and probes while its flock-protected landing gate ran. The passing full suite earlier in this file belongs to `bc1f4bfc`, not this candidate; this reviewer makes no repaired-candidate full-suite claim. No file is classified here as failing the repaired full suite but passing alone, since this reviewer did not run that full suite.

`git range-diff bc1f4bfc..7c3eef85 43dfbe04..ac9426fe` pairs all six repair commits with `=`: spawn/preloads, signatures, orphan lowering, key re-pin, notes, and formatting survived the rebase unchanged. The additional D11 wording and rebuild were inspected. Throwaway probes used only temp fixtures, this checkout's sources/dependencies, the installed Node 22.23.3/24.21.0 binaries, and their own children; HOME and both XDG paths were temp paths. Nothing was written to another checkout or the cezar repository.

### B2 remains blocking — ordinary options and the uncertainty policy invent preloads (proven)

**Where:** `src/runners/observe/preloads.cjs:91`, `:99`, `:105`, `:191`; injection remains in `src/runners/observe/spawn.cjs`.

**Contract:** amended D11 still says “a verdict the project's own runner would not give, caused by Squeal's additions, is a defect to fix at its source, never an accepted cost” and “A program's own `-r` does not count.”

The literal original probes are repaired: single-quoted shell `'-r'` records its preload read, and `[absoluteChild, ' -r ']` passes beside a malformed cwd package. But the new parser treats **every non-valued long option**, including Node's ordinary `--no-warnings`, as an unknown option that might consume the next word. It skips the actual entry and then mistakes the program's `-r` for a Node preload. This is the original B2 false-preload failure, still present with a standard boolean flag.

**Probe:** make a temp root containing `child.cjs` with `console.log('ok')`, and `bad/package.json` containing `{ broken`. Start a parent `main.mjs`, once plain and once with the candidate recorder as `NODE_OPTIONS=--import "<recorder file URL>"` and `SQUEAL_OBSERVE={root,out,skip:[],file:<test.ts>}`. From the parent run:

```js
spawnSync(process.execPath, ['--no-warnings', absoluteChild, '-r'], {
  cwd: badDirectory, env: {}, encoding: 'utf8'
});
```

Plain: **exit 0, `ok\n`, empty stderr**. Observed: **exit 1, empty stdout, `ERR_INVALID_PACKAGE_CONFIG`**, with `trySelf` and Node's preload loop in the stack. There is no project preload in either invocation.

The stated “when unsure, --require” policy also reproduces the same verdict change; naming the policy does not satisfy Fidelity. With the same fixture and an explicitly empty `FLAGS`, each shell command below passes plain and fails observed with `ERR_INVALID_PACKAGE_CONFIG`:

```sh
"<node>" $FLAGS "<absoluteChild>" -r
"<node>" "<absoluteChild>" <<EOF
-r
EOF
printf '%s' node -r >/dev/null; "<node>" "<absoluteChild>"
```

Use `spawnSync('/bin/sh', ['-c', command], {cwd: badDirectory, env: {FLAGS: ''}, encoding:'utf8'})` from the parent. The expansion fallback skips the entry, the heredoc fallback treats stdin as options, and `commandRequires` searches for `node` among another command's arguments. In all three, the actual Node has no require preload. The amended D11 sentence allowing uncertain commands is therefore in conflict with its unchanged Fidelity goal; it cannot justify this false failure.

**Test assessment / one-worker fix:** the new tests cover the exact old examples, quoted flags, valued options, grandchild form changes, and real malformed-cwd outcomes. They miss boolean options before an entry; the parser tests positively assert the broad expansion/heredoc policy without testing its verdict effect. Distinguish known boolean options from valued options, respect the executable/entry boundary, and replace the unconditional uncertainty promotion with a policy that preserves plain-child outcomes. Add plain-versus-observed malformed-cwd regressions for the four cases above, while retaining preload-only read assertions. The repair belongs in one owned preloads/spawn row, followed by the combined rebuild and unreleased key re-pin. A signature note is evidence of the introduced failure, not its fix.

### B1 is repaired (original blocker closed)

**Probe:** re-ran the original matrix under the source recorder. Default, spread and empty-env children all print `secret` and record `input.txt`; Workers with default, empty and `SHARE_ENV` env do too. The original single-quoted shell case also records it. The invalid `-r./pre.cjs` control exits 9 as Node requires and is not a finding. Through the source Vitest adapter, the default-env child test passes and `report.observed` includes `input.txt`.

The new spawn-preload tests assert both outcomes and observed file sets. They cover child/grandchild transitions back to import and forward to require, default/spread env, Worker default/empty/shared env, and children of each Worker; they check one recorder in NODE_OPTIONS and preserve the shared env. Those are appropriate regressions for the original B1. This closure does not settle the new parser cases in B2/S2.

### B3 is repaired (original blocker closed)

**Probe:** re-ran the adapter's missing project `src/observe/recorder.cjs` and ordinary module beneath malformed `bad/package.json`, observing on and off. Both fail as real project errors, **with no recorder field/note in all four reports**. The positive preload-read adapter control still passes and records its data file.

Also generated actual error output independently on **Node 22.23.3 and 24.21.0**, using a temp malformed cwd package. Passing that output to the repaired `recorderSignature` with the exact recorder identity gives the package/preload note for `node --require <recorder> <outside child.cjs>` on both versions. Ordinary module load, ordinary bare-name require and missing project-recorder cases produce no note on either version. The scoped fidelity tests retain the real positive adapter signature case.

Exact recorder paths, the runner's own relativization and an empty recorder list now replace suffix inference. The new real-adapter negative tests and Node 22/24 stack fixtures adequately cover the original misattribution; the fingerprint and summary-budget test passes. No new blocking signature seam was found.

### S1 is partly repaired — one lane consumes the other lane's orphan scan (proven, nonblocking)

**Where:** `src/core/daemon/escaped.ts:173`–`:187`, notably the instance-wide `#reaped`/`#orphansAt` updated before the result is filtered to one lane.

The original single-lane orphan probe now reaches **nice 10 at 1.5 s**. Its new regression test covers two exits more than a second apart. However, overlapping lanes share the exit counter and scan throttle, while the scan returns only the caller's lane and discards other lanes' candidates. A fast-lane look can consume the only exit that would make a slow-lane orphan discoverable; later slow looks keep returning empty until some other child exits. This retains S1's nonblocking status and does not reopen the settled stop implementation.

**Probe:** run a Node process at nice 0 as its own group leader (`setsid`), create `EscapedChildren`, and let its startup-stranger snapshot finish. Call `carriers('fast', since)` once. Spawn a shell with `envFor('slow:vitest')` that executes `sleep 30 >/dev/null 2>&1 & echo $!`, then await the shell's exit. After 1.1 s, call `carriers('fast', since)` first and `carriers('slow:vitest', since)` next. Both return `[]`; a slow-lane look another 1.2 s later is still `[]`, and the sleeper remains nice 0. Spawn and reap `/bin/true`, then call the slow look again: it finally returns that sleeper's PID. Kill the sleeper in `finally`. This deterministic carrier-API schedule is one that overlapping `lowerWhile` loops can produce.

**Cost / trigger:** the new trigger reads `cminflt` each look; the first look scans even without an exit (`#reaped` starts at -1), then a changed counter and the one-second throttle allow another scan. No new exit means no further full scan. On this host the probe's three full looks cost **24.0, 57.1 and 35.6 ms CPU** (36.4, 44.9 and 29.9 ms wall); throttled/no-change looks cost **0.32–0.49 ms CPU**. The 500-look direct-child probe with eight marked/two unmarked children found all eight and averaged **0.740 ms CPU and 0.740 ms wall per look**. These are local measurements, not hard budgets. The fallback remains at most one full scan per instance per second, rather than ten scans per lane per second.

**One-worker follow-up:** keep one shared scan budget but retain candidates/marks for every lane, so one lane's look cannot consume another's evidence. Add the two-lane/one-exit regression at nice 0. The existing one-lane test cannot discriminate this schedule. Treat the reap-fault counter as a trigger heuristic, not a hard elapsed-time guarantee.

### S2 — an expanded shell flag can lose its preload read (proven note)

**Where:** `src/runners/observe/preloads.cjs:86`, `:137`.

This is a new seam note from the requested shell-input check, nonblocking under the narrow re-review rule. The literal quote regressions are repaired, but an expanded word is skipped even when the shell makes it the actual require flag.

**Probe:** use B1's preload-only `input.txt` fixture and run this shell command from the observed parent, with the child shell's `env: {}`:

```sh
"<node>" "$(printf %s -r)" ./pre.cjs child.cjs
```

The shell does only its local `printf`; no external input or project/private paths are expanded. The child exits 0 and prints `secret`, but `input.txt` is **absent** from the recorder output. The expanded word is the real `-r`, yet the recorder stays import and starts after the preload. A pure parser green on literal single/double quotes does not prove expansion fidelity.

**One-worker follow-up:** include expanded flags in the same parser-policy work as B2, with observed-path assertions as well as exit parity. If a shell form cannot be inferred before execution, name its coverage limit precisely rather than claiming the fallback loses no reads. Do not fix this by restoring B2's blanket require injection.

### N1 resolved; what the next wave can rely on

- The amended Priority text correctly says a 100 ms delay **after** a look, plus scan and event-loop time, with no hard deadline. The direct-child cost is described as a measured example. The new orphan wording needs S1's lane handling; it is not a new shutdown guarantee.
- The amended signature wording matches B3's ownership and preload-stack checks. The Fidelity wording about actual Node options and the unchanged no-false-verdict goal remains the repair contract. Its uncertain-command sentence needs revision together with B2, as demonstrated above.
- No D12 stop code changed in the repair. The original shutdown-budget analysis and settled stop results stand; no second contended stop proof was needed.
- Bundle reproducibility, key-format pin and the recorder-copy boundary pass at this candidate. Original packaging, edit-acknowledgement and bounded-hook findings remain settled, untouched by the repair.
- Dispatch B2 and the associated shell-policy notes together; keep keyed preload reads and plain-child verdict parity as separate required assertions. S1 needs an independent cross-lane regression with a shared scan budget. Rebuild and re-pin after any product repair. This second-round **FAIL** is for the coordinator/human decision, not permission to land.

## Third-round addendum — 2026-10-15

**PASS `7b8f506e775cee27604f53fbe8701a992138ca25` — 0 blockers, 0 open should-fix findings, 1 nit (N2).** This is the human-authorized third repair of review 001-401, bounded by round two's B2, S1 and S2 and the rebase's effect on B1/B3. The earlier rounds remain historical judgments of their named SHAs.

### Verification at 0.1.194

All product verification and probes ran on the pinned, clean candidate. The review file was absent from this candidate; the earlier text is restored verbatim from review commit `32098711b108ffc4ec550408a8a3dfe84755c7bf` before this addendum, and only that file is committed atop the candidate.

```text
$ git rev-parse HEAD
7b8f506e775cee27604f53fbe8701a992138ca25
$ npm ci
added 196 packages, and audited 197 packages in 20s
found 0 vulnerabilities
(exit 0; deprecation/uncovered-install-script warnings)
$ npm run lint
> biome check .
Checked 1287 files in 1408ms. No fixes applied.
(exit 0)
$ npm run typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
(no output; exit 0)
$ git status --short
(no output)
```

Independent full run, under the host's lock, with exit 0:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock \
  env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
  HOME=/tmp/squeal-review-13bt/home \
  XDG_CONFIG_HOME=/tmp/squeal-review-13bt/config \
  XDG_RUNTIME_DIR=/tmp/squeal-review-13bt/runtime \
  npx vitest run --maxWorkers=4
```

```text
Test Files  624 passed | 1 skipped (625)
     Tests  5061 passed | 118 skipped (5179)
  Start at  12:00:02
  Duration  661.50s (tests 97%, import 2%)
(exit 0)
$ git rev-parse HEAD
7b8f506e775cee27604f53fbe8701a992138ca25
$ git status --short
(no output)
```

The independent run acquired the lock at 10:00:01 UTC (12:00:01 local); the lock-protected start record confirms the exact SHA and clean tree. It completed at about 10:11:04 UTC. Host load at start was 18.22 / 22.96 / 23.86 on 24 CPUs; at the completion check, 11.54 / 14.96 / 19.39. Node 24.21.0, Vitest 5.0.3, Linux. Output also carried fixture-local gitdir repairs, Vitest's experimental typechecking warning, and cleanup of one process an earlier run left. No test failed and teardown reported no current-run leak failure.

**Files that failed this full run but passed alone: none.** No isolated failed-file reruns were necessary. This was the reviewer's own full execution, not the coordinator's gate or a Squeal checkpoint. All probes used temporary HOME/XDG paths and only this checkout's code/dependencies and their own fixtures/children. The candidate stayed clean until this findings file was written.

### B2 closed — the four false-require cases preserve plain outcomes (proven)

Re-ran the same independent four-case round-two fixture: a `child.cjs` outside `bad/` prints `ok`, while `bad/package.json` contains `{ broken`. Launch `main.mjs` plain and under the candidate recorder as import, with temp recorder output and a synthetic test-file attribution. Its children use an explicit empty env, or `{FLAGS:''}` for the shell:

```js
spawnSync(process.execPath, ['--no-warnings', absoluteChild, '-r'],
  {cwd: badDirectory, env: {}, encoding: 'utf8'});
```

```sh
"<node>" $FLAGS "<absoluteChild>" -r
"<node>" "<absoluteChild>" <<EOF
-r
EOF
printf '%s' node -r >/dev/null; "<node>" "<absoluteChild>"
```

**All four now give exit 0, `ok\n`, empty stderr, plain and observed.** The parser stops at the real entry after a boolean flag, refuses to guess an expansion, ignores heredoc bodies and recognizes `node` only in command position. These are outcome probes, not just matching assertions.

Positive controls also guard the other side of B2. Direct `node -r ./pre.cjs child.cjs`, a child with `NODE_OPTIONS=-r ./pre.cjs`, the literal shell command, an `env node -r` wrapper, and a literal Node preload command after a completed heredoc each print the preload's `secret` and **record `input.txt`**, which only the preload reads. Parser-level controls return true for direct and shell `env -i node -r ./pre.cjs child.cjs` and `npx node -r ./pre.cjs child.cjs` too. Those last controls verify detection only; they do not claim a recorder survives an external `env -i` clearing its environment or claim an npm download was exercised.

The new `spawn-unread.test.ts` asserts all four observed outcomes equal plain outcomes beside the malformed package, while its helper's `off` arm is insulated from an outer observing Squeal by a distinct recorder-output setting. `preloads.test.ts` covers boolean/valued options, wrapper/command boundaries, heredocs, literal require positives and deliberately unreadable forms. Existing spawn-preload tests retain the preload-only read assertions. No previously blocking B2 scenario remains demonstrated at this candidate.

### S1 closed — the shared scan retains every lane's evidence (proven)

Re-ran the original two-lane/one-exit schedule at nice 0 in a dedicated process group, with the original temp HOME/XDG isolation. After the startup-stranger snapshot, warm `carriers('fast', since)`, then spawn a shell marked `slow:vitest` that leaves `sleep 30` and exits. Wait 1.1 s, look with the fast lane first, then the slow lane. **Fast returns `[]`; slow returns the sleeper PID immediately**, and returns it again 1.2 s later without another child exit. Kill the sleeper in `finally`. The old candidate returned `[]` to that second lane until a new exit.

The cache keeps all lane marks from one globally throttled scan, filters by the requesting lane and `since` on each look, and rechecks pid/start before returning a cached entry. The one-second budget remains shared. The new two-lane regression asserts the identity itself rather than relying on an already-lowered process's priority. D11 Priority now states both the shared budget and retention of every lane, and calls `cminflt` a trigger, not a deadline.

### S2 resolved as a named coverage limit (proven limit, not a coverage fix)

Re-ran the exact shell expansion probe:

```sh
"<node>" "$(printf %s -r)" ./pre.cjs child.cjs
```

The child still exits 0 and prints `secret`, while the preload-only `input.txt` is not recorded. This is **explicitly asserted** in the new integration test and named in amended D11: for such unreadable shell options the recorder stays import; a real require then runs first, its exclusive reads are missed, and changes to those files alone do not re-run the test. The spec no longer claims the fallback loses no reads or uses this limit to excuse false verdicts. This addresses S2 by an explicit limit, not by pretending the reads were recovered. Expanded command names, unknown wrapper options such as `env -S`, and cmd.exe are also stated as unreadable forms.

### B1/B3 remain closed across the rebase

- The original source-recorder matrix still records `input.txt` for default/spread/empty child env and default/empty/SHARE_ENV Workers, each printing `secret`. The quoted shell `'-r'` control still records it. Node's invalid `-r./pre.cjs` control still exits 9 and is not a candidate failure.
- The source Vitest-adapter control still observes the passing default-env child's preload read. The missing project `src/observe/recorder.cjs` and ordinary module beneath a malformed package fail without a recorder note, both observing and not observing.
- Actual Node 22.23.3 and 24.21.0 stderr still gives a signature only for the preload package failure, not ordinary module load, ordinary require or a project recorder lookalike. The signature ownership and runner plumbing are unchanged from the second-round closure.
- The rebase adds no change to the Vitest or node:test recorder plumbing beyond the requested spawn/parser repair. The OpenCode turn-test conflict keeps the newly added no-edit-acknowledgement assertion alongside main's existing tests; the full-suite result above is the runtime evidence for the combined tree. No D12 stop implementation was changed by this repair.

### N2 — qualify the explanation immediately after the coverage limit (proven nit)

**Where:** `docs/specifications/001-core-loop/spec.md:217`, D11 Fidelity.

**Probe:** read the two adjacent statements against the S2 outcome above. After explicitly saying an unreadable command's preload reads are not recorded, the next sentence says “Node runs every `--require` before any `--import`, so the recorder still sees what that preload reads”. That explanation needs an explicit antecedent for the detected-preload/require arm; taken unqualified, it contradicts the immediately preceding, accurately measured limit.

**One-worker fix:** say that **for a detected preload**, the recorder is inserted as an earlier require and sees its reads. Keep the named coverage limit and no-false-verdict rule intact. This wording nit does not reverse the explicit limit or establish a product blocker.

### What fits and inputs for the next wave

B2's outcome parity and positive preload-read controls are separate obligations and both now hold for the tested literal forms. Keep the explicit plain arm in future fidelity tests. Keep S1's identity-based cross-lane regression and one shared scan budget; do not restore a scan per lane. Preserve S2's named uncertainty boundary until a separately scoped implementation can recover those reads without restoring false require injection. B1/B3 and the original D12/acknowledgement/packaging/hook findings need no fresh prosecution absent a diff that reopens them. N2 is a sentence-sized clarification. No other product rewrite is requested by this bounded review.
