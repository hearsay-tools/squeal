# Wave 12e: 001-136 re-review of 001-134 and 001-135

## Verification output

Candidate: `4be4e3e907ac7b8328551605101042af99fd9daa` (0.1.38). `git rev-parse HEAD` returned that SHA. The brief names landed subjects and the plugin build, rather than requiring an exact HEAD. `f53107a` (build), `3ee09df` (null-byte fix), and both repair rows are ancestors; HEAD is the subsequent board/status commit. No candidate mismatch.

Linux, Node 24.21.0, Vitest 5.0.3, 2026-10-08. The tree was clean before installation, after the build, after the full suite, and after all probes. Both plugin bundles reproduced without drift. All evidence below was collected at this candidate before writing this file. Observation was explicitly on in every recorder/scheduler probe, with no declared `inputs`. Off runs are the stated parity controls. The review changes no product code.

`npm ci` (exit 0):

```text
added 56 packages, and audited 57 packages in 1s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

`npm run lint` (exit 0):

```text
> squeal@0.1.38 lint
> biome check .

Checked 561 files in 140ms. No fixes applied.
```

`npm run typecheck` (exit 0):

```text
> squeal@0.1.38 typecheck
> tsc --noEmit
```

`npm run build` (exit 0):

```text
> squeal@0.1.38 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.38 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

`git status --porcelain=v1` after build and after probes: empty. `git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist`: exit 0, no output.

One full proof: `npx vitest run` (exit 1), complete captured output:

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/9e24dc82-0fb9-446a-9b82-bb53ae445943

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/9e24dc82-0fb9-446a-9b82-bb53ae445943/test/fixtures/scheduler/.tmp/7f67719d-9973-48c4-b1c6-10508190e11a/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/9e24dc82-0fb9-446a-9b82-bb53ae445943/test/fixtures/scheduler/.tmp/af2bb3e6-0e35-4d2c-b0e7-3d5553aeba7f/main/.git/worktrees/staged/gitdir
 ❯ test/daemon/handover.test.ts (6 tests | 1 failed) 58131ms
   ❯ a step-down with released bundles of other versions (B1) (2)
     × a 0.1.32 daemon, a current hook, then a released 0.1.31 hook: a current daemon serves 32666ms
stdout | test/runners/node-test/graph-cost.test.ts > node-test graph: cost at 1,000 modules (f) > re-resolves no slower than a cold build and re-parses an edit in under 5 % of it
node-test graph cost, 1,000 modules, 200 test files, 5 rounds: {
  cold: '295.17 ms',
  reresolve: '313.01 ms',
  coldMedian: '344.04 ms',
  edit: '0.97 ms'
}

 ❯ test/runners/node-test/graph-cost.test.ts (1 test | 1 failed) 14797ms
   ❯ node-test graph: cost at 1,000 modules (f) (1)
     × re-resolves no slower than a cold build and re-parses an edit in under 5 % of it 12476ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 2 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/daemon/handover.test.ts > a step-down with released bundles of other versions (B1) > a 0.1.32 daemon, a current hook, then a released 0.1.31 hook: a current daemon serves
Error: the successor serving not met in 30000 ms
 ❯ waitFor test/daemon/helpers.ts:181:49
    179|       return value as NonNullable<Exclude<T, false>>;
    180|     }
    181|     if (Date.now() - started > timeoutMs) throw new Error(`${what} not…
       |                                                 ^
    182|     await delay(10);
    183|   }
 ❯ test/daemon/handover.test.ts:75:7

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/2]⎯

 FAIL  test/runners/node-test/graph-cost.test.ts > node-test graph: cost at 1,000 modules (f) > re-resolves no slower than a cold build and re-parses an edit in under 5 % of it
AssertionError: expected 313.0065859999995 to be less than 295.17047600000114
 ❯ test/runners/node-test/graph-cost.test.ts:97:32
     95|       Object.fromEntries(Object.entries(measured).map(([k, ms]) => [k,…
     96|     );
     97|     expect(measured.reresolve).toBeLessThan(measured.cold);
       |                                ^
     98|     expect(measured.edit).toBeLessThan(measured.coldMedian * 0.05);
     99|   });

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/2]⎯


 Test Files  2 failed | 216 passed | 1 skipped (219)
      Tests  2 failed | 1758 passed | 10 skipped (1770)
   Start at  19:54:32
   Duration  142.33s (tests 97%, transform 1%, import 1%)
```

Neither full-suite failure is attributed to these repairs. Both failed files, at the same clean candidate:

`npx vitest run test/daemon/handover.test.ts test/runners/node-test/graph-cost.test.ts --maxWorkers=1` (exit 0):

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/9e24dc82-0fb9-446a-9b82-bb53ae445943


 Test Files  2 passed (2)
      Tests  7 passed (7)
   Start at  19:57:18
   Duration  12.92s (tests 94%, transform 5%, import 1%)
```

This establishes recovery in isolation, not the cause of the original failures and not a passing full suite. The live Squeal daemon separately reported the handover failure and, at the final candidate status read, one known failure with a completed checkpoint at revision 1. Its evidence is supplemental, not substituted for the explicit gate. No second full suite or full Cezar proof was run. The prior Cezar cost evidence was not repeated at this candidate and is **unverified** as candidate verification; S1's controlled-contention question belongs to 001-137.

Probes ran as external drivers with `node --import tsx` against this worktree's source, using throwaway git fixtures below the ignored fixture scratch directory. The scheduler driver used a copy of the existing harness with only its test-hook cleanup changed to an explicit cleanup function and imports made absolute. It used the real Vitest adapter, scheduler, hasher and SQLite store. Raw comparisons used `node` with/without this candidate's recorder. Drivers and fixtures were removed before the review commit. No probe altered tracked candidate code or supplied synthetic recursive observations.

## Verdict

**FAIL** `4be4e3e907ac7b8328551605101042af99fd9daa`.

One proven blocker: wave 12d **B5 remains open**. Five earlier blockers are repaired in the discriminating scenarios below. Three proven nonblocking notes: the carried S2 directory-stat limitation and the newly requested nested-recorder and null-byte cases. Zero separate nits. New cases remain notes under the bounded re-review rule; they are not silently promoted to new blockers.

## Blockers

### B5. Proven, still blocking: no recorder reports the recursive listing field the scheduler consumes

Locations: `src/runners/observe/fs.cjs:187`, `src/runners/observe/recorder.cjs:126`, `src/runners/observe/read.ts:56`, `src/runners/observe/inputs.ts:50`; consumer at `src/core/scheduler/observed.ts:49`. The test substitutes the missing production field at `test/scheduler/recursive-listing.test.ts:44` to `:54`.

D3: "A recursive listing (`recursive: true`) enters as the listing path of its directory and of every directory below it that holds a tracked file, each hashed as its own entry names, so an add or delete in any of them re-keys the file". Row 001-134's done-when: "B5's probe re-keys on a nested addition and removal".

The scheduler side is present: `ObservedInputs.recursive`, `Listings.below`, and expansion in `observedGrowth`. The producer side is absent. The fs wrapper records all readdir forms as plain `l`; the recorder writes only `f/l/w`; the reader accepts those three categories; `observedInputs` returns `paths/directories` only. Nothing distinguishes a recursive call from a shallow one. The scheduler test's `reportRecursive` fills it in after the real run, so that green test proves expansion of a supplied field, not the required recorder-to-scheduler seam.

Reproduced separately for sync, callback and promise readdir in both forks and threads. The test, with the appropriate call form, is:

```ts
expect(readdirSync(join(root, 'tree'), { recursive: true }).sort())
  .toEqual(['sub', 'sub/a.txt']);
```

`tree/sub/a.txt` is present before scheduler start. After the initial pass, create `tree/sub/b.txt` and deliver that path through a normal scheduler watch batch; then remove the original `tree/sub/a.txt` and deliver its deletion. No report is supplemented. Normalized output, identical across all three forms and both pools:

```text
report: paths=[snapshot], directories=[tree], recursive=undefined
closure=[snapshot, test/probe.test.ts, tree/]
initial: pass/current
nested add: same key=true, additional scheduler runs=0, pass/current
fresh real adapter run after add: fail
nested removal of original file: same key=true, pass/current
```

The names under `tree/sub` change, but `tree/` still contains only `sub`. A known pass remains current for disk on which that test fails. This is the same failure as the previous B5, not a new reach request.

Fix sized for one worker: finish the producer seam end to end. Record recursive readdir roots separately for sync, callback and promise calls; serialize, read and filter that category; return `ObservedInputs.recursive`; use the existing scheduler expansion. Remove `reportRecursive` from the regression test, and exercise actual reports for nested addition and removal in both pools. Keep ordinary shallow listings shallow. Bump `RECORDER_VERSION`, since version 2 passes were stored without these dependencies; rebuild both plugins with a patch release through the coordinator.

Board/status drift is part of this finding, not repaired here: `docs/board.md:237` marks 001-134 done; `status.md:127` says `ObservedInputs.recursive` is filled by 001-135's recorder; `tasks/001-134/notes.md` says the recorder records kind `r`. None of those producer claims holds at this candidate. The coordinator should fold that drift into the human's decision on this last review round.

## Should-fix

### S2. Proven, nonblocking, unchanged: a directory-only existence/stat dependency is dropped

Location: `src/runners/observe/inputs.ts:47`; D4 explicitly excludes "the directories it only stat'ed".

Re-ran the previous probe in both pools: test `existsSync(present)` with tracked `present/a.txt`; delete the tracked child and the directory and deliver the child's deletion batch. The closure contains neither a directory-existence token nor a listing. Key unchanged, zero scheduler runs, pass/current; a fresh run fails. The limitation is still allowed by D4, so it does not block. The policy reference's named blind spots still do not say that file and directory existence checks have different coverage.

Fix sized for a documentation worker: explicitly name directory-only stat/existence calls as unobserved in the D4 blind-spot list and both policy references. If the human instead wants support, make a separate input kind for directory existence and creation/removal invalidation; a tracked-file listing is not an empty-directory existence key. Do not expand that behavior inside the B5 repair.

### S3. Proven new note: the outer recorder replaces a caller's independent recorder settings

Locations: `src/runners/observe/spawn.cjs:72` (unconditional replacement), `:100` (async envPairs), `:123` (sync injection), `:152` (Worker injection).

D4 currently says the recorder puts its settings into `SQUEAL_OBSERVE` "whatever env the caller passed". The dispatch specifically asks whether to leave caller-set settings alone. A test may start a child with its own `SQUEAL_OBSERVE={out: inner, root, skip: [], file: innerTest}` and preload the recorder explicitly. With no outer recorder, the child records its entry and `input.txt` under the inner test in the inner output directory. With an outer recorder, its stdout is unchanged, but the inner directory is empty; the records go to the outer output directory under the outer test.

Raw on/off evidence:

```text
outer off: child stdout=A, inner observation files=1
           inner attribution=inner.test.ts, paths=[child.cjs,input.txt]
outer on:  child stdout=A, inner observation files=0
           outer attribution=outer.test.ts, paths include [child.cjs,input.txt]
```

This also reproduces through `createVitestAdapter({root: thisWorktree, observe: () => true})` at the candidate, running the unchanged `test/runners/observe/reach.test.ts` and `recorder.test.ts`: completed, 5 failed and 2 passed. B2/B3/B4 raw reach tests and the twenty-Worker/spawn-recording tests fail because their requested inner records are empty. B6's result-comparison tests pass. Those same files passed in the explicit direct full suite. This is a deterministic observation-destination collision, separate from the contention question.

Decision recommendation: **yes, preserve a caller's explicitly different `SQUEAL_OBSERVE` recorder context**. Continue adding the preload and updating test attribution for the ordinary inherited outer context and for `env: {}`. Do not treat an inherited outer setting as an independent recorder, or every ordinary child would stop being attributed correctly. Check the same distinction for sync spawns, normalized async spawns and Workers.

What the outer recorder loses with simple preservation: the independently managed child's dynamic file reads, listings and Node descendants no longer reach its observed set. The parent still records existing paths named in spawn arguments or the Worker entry, but it cannot infer those dynamic inputs from the child entry alone. A later edit of a child-only data file can therefore leave the outer key unchanged. Declare independent nested recorder contexts a blind spot requiring `inputs`, or explicitly support delivery to both destinations. Do not promise every child's reads while merely preserving one destination. A relay or multiple sinks is a separate behavior choice, not necessary to dispatch the small settings-preservation repair.

Fix sized for one recorder worker: preserve independent caller settings across the wrapped APIs and add an outer-on regression that asserts the inner destination and attribution survive. Add the corresponding blind spot and amend D4's unconditional overwrite rule; keep the env-empty and shared-env descendant regressions. The new note is nonblocking because this re-review is bounded to the prior blockers, and the present overwrite follows D4's explicit env exception.

### S4. Proven new note: the reader filters null bytes, but the recorder first calls native realpath on them

Locations: `src/runners/observe/recorder.cjs:110`, `:165` to `:168`; another fs boundary using the same `scoped` result is `src/runners/observe/spawn.cjs:81`. Reader guard: `src/runners/observe/read.ts:66`.

Dispatch requirement: "a virtual module id with a null byte must never reach an fs call". A preload ahead of the recorder counted only null-bearing arguments to `fs.realpathSync.native`. The driver called `existsSync(root + '/\0vite/dynamic-import-helper.js')` and then read a valid file. Node's original `existsSync` returns false for this invalid path. The recorder's `record` accepts it into its set and calls native realpath before the raw-reader filter runs:

```text
recorder-generated native realpath calls with a null byte: 1
reader/adapter output: paths=[input.txt,null.cjs], directories=[]
```

The null is swallowed after that recorder-generated fs call; it does not reach the adapter's `statSync`. A synthetic raw line with null-bearing `f`, `l` and `w` values confirms all three are dropped by `takeRecorded`; a null-bearing `t` remains an inert map key and does not match a real completed file. Thus the coordinator's fix repairs the demonstrated all-checks-unknown path for fresh recorder output, but it does not meet the stronger no-recorder-fs-call requirement.

Path audit: normal runner ingestion is `takeRecorded -> observedInputs -> RunReport.observed -> composite -> observedGrowth -> shared set -> closures -> tracking/hashing`. `takeRecorded` gates all three fresh path categories before adapter fs use. Shared-set deserialization (`src/core/keys/observed.ts:202`) filters strings only, and scheduler consumption trusts `RunReport.observed`; those boundaries do not independently reject null-bearing strings. No natural path was demonstrated that puts a null byte past the repaired reader into the shared store, so store poisoning or a custom runner bypass is not claimed as a proven candidate failure.

Fix sized for one recorder worker: reject null-bearing paths in `scoped` before recording, realpath, argument stat or open-classification lstat, for string, Buffer and file-URL spellings. Keep the reader guard. Add a counted-fs-call probe that proves the recorder performs zero extra fs calls for a virtual id while forwarding the original caller's call unchanged. A defensive guard at durable-set ingestion can cover malformed old/custom data, but that is hardening, not a second demonstrated failure. This is a new nonblocking note under the re-review bound.

## What fits

| Prior finding or requested probe | Current candidate evidence |
| --- | --- |
| B1: newly observed absence created during a run | A real first run passed before the external creation. It was discarded; only the confirming test failure was stored under the full key. A second worktree with the file present had identical keys, zero runs, and fail/current in both pools. The original suite also passes the unreported, directory-link, and watch-batch variants. |
| File created then deleted during its first run | Driver created `data/transient.txt` after selection, the test read `A`, then the driver removed it before report acceptance, without watcher hints. The first pass was discarded. Confirmation failed, only fail test records were stored, and both pools ended fail/current. This proves the first-seen case, not all possible create/delete cycles for already-cached inputs. |
| B2: file symlink | Closure includes both `data/alias.txt` and `data/target.txt`. Editing the target moves the key and runs to fail/current in both pools. File and directory link capture also pass in the required suite. |
| Symlink retarget outside the worktree | The link edit moves the key and re-runs to fail/current. The outside target is absent from the new report; the old in-scope target stays in the merge-only closure. Outside-target content changes remain D4's stated blind spot, not a repaired guarantee. |
| B3: readable opens | `r+`, numeric `O_RDWR`, and promise `open`/FileHandle reads all enter the closure. An `O_RDWR` input edit moves the key and fails both pools. The required raw test retains pure-output exclusion and records actual descriptor/handle writes, truncation and creation. |
| B4: shared-env Worker and its own children | Shared-env thread input, Node child entry, and child's data input all enter the closure in both pools. The child uses `env: {}`. Editing its data moves the key and fails the test. The Worker is terminated at its first message; shared process.env mutation and caller workerData still reach the parent correctly. |
| B6: invalid spawn overloads | On/off comparison: 324 calls, zero outcome differences. `spawnSync` 54, `execFileSync` 59, `spawn` 54, `execFile` 59, `fork` 59, `execSync` 17, `exec` 22. Both options positions, missing/null/non-object options, invalid commands/argv/env/cwd/shell/timeouts/uid/stdio and callbacks were compared where applicable, including calls Node actually accepts. Compared thrown error code/type, child status/signal/stdout or returned value. The original invalid-options Vitest assertions pass through the observing adapter in both fixture pools. |
| Worker constructor invalid forms | Another 32 on/off cases, zero differences: invalid filename types/URLs/null bytes; null/non-object options; invalid env, execArgv and uncloneable workerData; supported SHARE_ENV. Existing constructor/parity tests also passed in the required suite. This is evidence for these cases on Node 24, not every possible getter/proxy or every Node version. |
| N1: inaccurate ignore-filter amendment | Corrected at `status.md:126`: the daemon hands the policy to the adapter; `observedGrowth` filters ignored paths. No new finding. |

The new first-seen path is merged before re-keying, but its unproven result is not written. The discard budget remains three consecutive runs, ending unknown; its regression passes in the candidate suite. Known pre-run paths retain the ordinary stability fast path. No argument-order or transaction mismatch was found in those changed scheduler seams. Existing shared-set union, policy-off behavior, completed-file attribution, ordinary listings, env-empty grandchildren and plugin packaging stayed green in the one full gate. B5 specifically fails at the new recursive producer/consumer boundary.

S1's nine-file Cezar contention attribution remains unresolved and assigned to 001-137. No causal or performance conclusion is added by this review. Idle already-running worktrees' delayed shared-set refresh remains the previously accepted design bound; it was not re-prosecuted. Closure completeness remains false. Default observation remains off under the human's instruction until a passing review; this FAIL does not satisfy that condition.

## Inputs for the next decision or repair

1. This was dispatched as the last repair review on the 001-132 slice: send B5 to the human. The coordinator decides whether to authorize another repair or accept a narrower documented reach. This review makes no product change and does not accept its own verdict.
2. If B5 is repaired, one worker can own the recorder category from `fs.cjs` through recorder batching, `RecordedFile`/`takeRecorded`, and `observedInputs`, plus removal of the synthetic scheduler-test field. Agree the category before coding: `ObservedInputs.recursive` already exists; scheduler expansion already works. Preserve shallow-listing encoding and ignore filtering. A new category must get the same null-byte filtering as the existing categories.
3. Preserve order: receive only completed-file observations; filter paths and expand recursive roots; establish hashes against pre-run evidence; merge the shared set and re-key; store results only for stable full keys; settle the ledger and persist closures in the transaction. First-seen confirmation runs still count toward the three-discard budget. Do not weaken B1 to make the recursive case green.
4. Recorder reach changes need another recorder-version bump and clean rebuilds of both plugin bundles, with the coordinator's patch version. Require actual nested add/delete reports in forks and threads; run one normal full repository gate, then discriminate any failing files separately. Do not substitute the synthetic report for this proof.
5. S2 is a small documentation row. S3 needs an explicit nested-context policy and a candid statement of lost outer visibility, or a separately scoped multiple-destination design. S4 is an early path guard with a counted-fs-call regression. These are notes, not additional prerequisites invented by this bounded review.
6. Keep 001-137's experiment bounded to the nine-file controlled-contention comparison. Earlier Cezar suite/cost evidence does not settle causality or independently verify this candidate. Any Cezar command must unset every `CEZ_*` variable and run in a clone-cwd subshell, as the dispatch instructs.
