# Wave 12d: 001-133 review of 001-132

## Verification output

Candidate: `1690cf3e4297f35ed5103c2cb902946fc0279108` (0.1.35). `git rev-parse HEAD` returned that commit. The dispatch identifies the range by landed subjects, not by a single required HEAD: all `001-132` changes after `0c8bd5d`, through `5577036`, and the `793ee5f` plugin build are ancestors of this HEAD. The final commit is the coordinator's board/status update. No candidate mismatch.

Linux, Node 24.21.0, Vitest 5.0.3. The tree was clean before installation, after the build, after the full suite and after the probes. All verification below was at the candidate, before this findings file was written. The review changes no product code. One full suite, followed only by the four failed files with one worker; no second full proof. The live Squeal daemon was also validating, so the full run shared resources with it and other sessions.

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
> squeal@0.1.35 lint
> biome check .

Checked 554 files in 134ms. No fixes applied.
```

`npm run typecheck` (exit 0):

```text
> squeal@0.1.35 typecheck
> tsc --noEmit
```

`npm run build` (exit 0):

```text
> squeal@0.1.35 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.35 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
```

`git status --porcelain=v1` after the build: empty. Both committed plugin bundles reproduced without drift.

`npx vitest run` (exit 1), complete captured output:

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/2707607e-5ad7-41ff-9bde-309c16e8deb1

 ❯ test/cli/codex.test.ts (13 tests | 1 failed) 15379ms
   ❯ squeal init --harness codex (6)
     × touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI 9434ms
stdout | test/delivery/registered.test.ts > the revisions since registration (review wave 10b, N3) > are read in one query, however many there are
N3: delivery with 3,002 revisions since registration: 180.2 ms

 ❯ test/delivery/registered.test.ts (23 tests | 1 failed) 22854ms
   ❯ the revisions since registration (review wave 10b, N3) (1)
     × are read in one query, however many there are 6662ms
 ❯ test/harness/stop.test.ts (8 tests | 1 failed) 13291ms
   ❯ Stop within its 2 s hook timeout (review wave 3, N4) (2)
     × gives up on a locked store before Claude Code would kill it 2832ms
 ❯ test/runners/node-test/fixtures.test.ts (10 tests | 1 failed) 49038ms
   ❯ node:test fixtures under the current Node (10)
     ❯ gen-big.mjs (2)
       × writes 1,000 modules and 200 test files, deterministically, under 10 s 40081ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/2707607e-5ad7-41ff-9bde-309c16e8deb1/test/fixtures/scheduler/.tmp/aee72cef-3420-4846-aa82-070d14e6017d/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/2707607e-5ad7-41ff-9bde-309c16e8deb1/test/fixtures/scheduler/.tmp/3b53138d-a99c-4e13-9f22-3610efed5dd6/main/.git/worktrees/staged/gitdir

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 4 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/cli/codex.test.ts > squeal init --harness codex > touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/cli/codex.test.ts:102:3
    100|   });
    101|
    102|   it("touches nothing under a scratch HOME/.codex or CODEX_HOME, run a…
       |   ^
    103|     const repo = fakeRepo();
    104|     const home = runtimeDir();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/4]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/4]⎯

 FAIL  test/harness/stop.test.ts > Stop within its 2 s hook timeout (review wave 3, N4) > gives up on a locked store before Claude Code would kill it
AssertionError: expected 2074.3831250000003 to be less than 1875
 ❯ test/harness/stop.test.ts:176:23
    174|       expect(elapsed).toBeGreaterThanOrEqual(STOP_WAIT_CAP_MS);
    175|       // In process, so no Node start: the margin is left over.
    176|       expect(elapsed).toBeLessThan(HOOK_TIMEOUT_MS - STOP_MARGIN_MS / …
       |                       ^
    177|     } finally {
    178|       clearTimeout(lock);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/4]⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/4]⎯


 Test Files  4 failed | 210 passed | 1 skipped (215)
      Tests  4 failed | 1742 passed | 10 skipped (1756)
   Start at  18:29:01
   Duration  184.16s (tests 95%, transform 4%, import 1%)
```

The four failures are recorded, not attributed to this wave. The same files at the same clean candidate, with reduced concurrency:

`npx vitest run test/cli/codex.test.ts test/delivery/registered.test.ts test/harness/stop.test.ts test/runners/node-test/fixtures.test.ts --maxWorkers=1` (exit 0):

```text
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/2707607e-5ad7-41ff-9bde-309c16e8deb1


 Test Files  4 passed (4)
      Tests  54 passed (54)
   Start at  18:33:30
   Duration  8.55s (tests 91%, transform 6%, import 2%)
```

This verifies their recovery in isolation, not that the full suite passed. The background daemon separately reported two baseline failures, including a shared `/tmp/squeal-4242` collision and a delivery timeout at load 91.35. Its checkpoint is not substituted for the explicit run above, nor used as evidence against the candidate.

## Verdict

**FAIL** `1690cf3e4297f35ed5103c2cb902946fc0279108`.

Six proven blockers, two should-fix notes (one proven limitation expressly permitted by D4, one plausible contention attribution), one proven documentation nit. The recorder can change a real test's result, omit inputs inside its promised reach, and store and inherit a pass under bytes that did not produce it. None of the verification failures is a blocker in this review.

## Blockers

### B1. Proven: a newly observed absent path is first hashed after the run

Location: `src/core/scheduler/observed.ts:58`, `:83`, `:89`; the storage consequence is `src/core/scheduler/tiers.ts:243`, `:259`.

D5: "A result is stored only under a key whose inputs were stable for the whole run." D3: "Absent paths hash as absent, so the key changes the moment such a file appears." Goal 4 permits inheritance only when inputs are byte-identical to what produced the result.

Failure scenario, reproduced with the real Vitest adapter, scheduler, filesystem hasher and SQLite store, no `inputs`:

```ts
const absent = !existsSync(new URL('./appeared.txt', import.meta.url));
writeFileSync(new URL('./ready.txt', import.meta.url), 'ready');
await new Promise(resolve => setTimeout(resolve, 1500));
expect(absent).toBe(true);
```

The driver waits for `ready.txt`, creates `appeared.txt` while this first test run is sleeping, and leaves its watcher hint undelivered. The path was absent and had never entered the cache. `observedGrowth` seeds it from its **present** contents after the run; `prepareObserved` then snapshots that newly seeded value and compares it with itself. Unlike a listing, D5 does not accept waiting for the watcher for file stability.

Observed output:

```text
first run: runs=1, outcome=pass, validity=current
closure=[snapshot, appeared.txt, test.test.ts]
fresh unobserved run on the same disk: fail
second linked worktree, appeared.txt present: same key=true, runs=0, pass/current
```

The second worktree inherited the result of an absence check under the present-file hash. The ordinary, already-cached input case discriminates the defect: editing a tracked `input.txt` between its read and report acceptance discarded the first pass, ran twice, and ended fail/current.

Fix sized for one scheduler worker: retain a pre-run snapshot for newly observed tracked paths, and distinguish an unknown pre-run path from a known absence. Do not certify an unknown path by seeding it after the run. For a path with no pre-run evidence, merge it, track it, discard the first result and rerun under its full key, or carry sufficient observation-time evidence to establish stability. Cover this absence-creation probe, a first read behind a symlinked directory not yet cached, a watch batch during the run, and the second-worktree lookup. Preserve the one-run fast path when pre-run evidence exists.

### B2. Proven: an fs read through a file symlink keys the link, not the bytes read

Location: `src/runners/observe/recorder.cjs:92`, `:126`; conversion at `src/runners/observe/inputs.ts:42`.

D3 adds "the project paths the file's runs were observed to read". The underlying hasher intentionally hashes a symlink as git does, by its target spelling; the recorder must retain the content dependency too. This finding is on the new observed input boundary, not on that pre-existing hash definition.

Reproduction: tracked `alias.txt -> target.txt`, both inside the worktree, neither ignored. A test asserts `readFileSync(new URL('./alias.txt', import.meta.url), 'utf8') === 'A'`. Initial pass/current; observed closure contains `alias.txt` but not `target.txt`. Change tracked `target.txt` from `A` to `B` and hand the scheduler that batch. Key unchanged, zero additional runs, pass/current. A fresh run fails with `expected 'B' to be 'A'`. Reading a source file through a file symlink has the same boundary; no module import is needed to reproduce it.

Fix sized for one recorder worker: retain the logical link path for retargeting and the readable target dependency for content changes, respecting project scope and ignore rules. Do not replace the former with the latter. Cover file-link target edits and retargets, and reads behind supported directory links; keep outside-worktree and ignored target limits explicit. A recorder-version bump is needed.

### B3. Proven: opening a descriptor for reading with `r+` falsely makes it a written output

Location: `src/runners/observe/recorder.cjs:160` to `:168`; exclusion at `src/runners/observe/inputs.ts:41`.

D4 excludes "paths the run wrote", not paths it merely opened with permission to write.

Reproduction: `openSync(input, 'r+')`, `readSync(fd, buffer, 0, 1, 0)`, `closeSync(fd)`, assert byte `A`. There is no write. The recorder reports `w: ['input.txt']`, and the adapter drops it from the closure. Changing `input.txt` to `B` and processing its batch leaves the same key, zero additional runs and pass/current; a fresh run fails. A writable numeric open flag reaches the same classification branch.

Fix sized for one recorder worker: distinguish read access from actual output mutation. Readable opens must supply an input dependency; writable permission alone must not suppress it. If descriptors or FileHandles are used to write, classify their actual operations, preserving the intended write-then-read output exclusion. Cover `r+`, numeric `O_RDWR`, promise `open`/`FileHandle.readFile`, and the existing pure-output case. Bump the recorder version.

### B4. Proven: a Worker using `SHARE_ENV` loses its reads

Location: `src/runners/observe/recorder.cjs:277`; attribution at `:90`.

D4 promises the Worker constructor and attribution by "the test file its parent passed in a child or thread". The policy reference says "every ... Worker the test starts". This form is not a stated blind spot.

Reproduction: a Vitest test starts `new Worker(new URL('./worker.cjs', import.meta.url), { env: SHARE_ENV })`. The worker posts `readFileSync(join(__dirname, 'input.txt'), 'utf8')`; the test terminates it at that message and expects `A`. Pass initially. The closure includes `worker.cjs`, but omits `input.txt`. The root Vitest settings have no `file`, and this branch deliberately skips `injected`, so the worker has neither the parent's Vitest worker state nor a test-file setting. Editing `input.txt` to `B` leaves its key and pass/current unchanged, with zero runs; a fresh run fails. The raw preload probe also recorded only the worker entry in the parent's record, with no worker input record.

Fix sized for one recorder worker: carry test attribution into shared-env threads through a channel that preserves Node's shared environment semantics. Do not replace `SHARE_ENV` with a copied env or change user `workerData`. Cover a shared-env worker, its Node descendant, and termination on the first posted message, in both Vitest pools. Bump the recorder version.

### B5. Proven: recursive readdir returns nested names absent from every listing key

Location: `src/runners/observe/recorder.cjs:182`; nonrecursive key at `src/core/keys/observed.ts:122`.

D4 wraps fs listing operations; D3 says a listing "hashes as its sorted entry names ... so an add or delete below it re-keys the file". Research F4 assumes a tree walk lists every subdirectory. Node's own `readdirSync(dir, { recursive: true })` does its inner walk below the public wrappers.

Reproduction: `tree/sub/a.txt` exists. Assert `readdirSync(tree, { recursive: true })` equals `['sub', 'sub/a.txt']`. Observations contain only directory `tree`, so the closure has `tree/` but not `tree/sub/`. Add `tree/sub/b.txt` and hand the scheduler that batch. It considers ancestor listings, but `tree/` still hashes to the single immediate entry `sub`: key unchanged, zero runs, pass/current. A fresh run fails with the extra `sub/b.txt`.

Fix sized for one listing worker: represent recursive listing dependencies as each visited directory's immediate listing, or a distinct recursive listing key whose hash and reverse invalidation cover all returned names. Do not silently change normal nonrecursive listings to whole-tree inputs. Cover sync, callback and promise recursive readdir, existing-subdirectory additions and removals, and maintain the ordinary shallow-listing tests. Reconcile this with D5's explicitly bounded listing stability rule. Bump the recorder version and any changed listing encoding version.

### B6. Proven: the sync-spawn wrapper changes Node's argument validation and a test result

Location: `src/runners/observe/recorder.cjs:255` to `:259`.

D4: "It changes no call's arguments or result except a child's env." The brief: "it never changes a call's behaviour or result".

Reproduction:

```ts
expect(() => spawnSync(process.execPath, ['-e', ''], 5)).toThrow();
```

Without the recorder Node throws `ERR_INVALID_ARG_TYPE`, and the test passes. With the recorder the invalid options value is replaced with `{ env: ... }`, a child runs successfully, and the test fails. This was reproduced both as a raw preload on/off comparison (`ERR_INVALID_ARG_TYPE` versus `NO_THROW`) and as a real Vitest adapter result (off pass, on fail). This is a validation test of an error case, not a timing-dependent failure.

Fix sized for one spawn-wrapper worker: inject only into valid overloads and preserve Node's validation of all other calls, including the supplied value of `options.env`. Pass original arguments through when their shape is invalid rather than normalizing them into a successful invocation. Cover `spawnSync`, `execSync`, `execFileSync`, explicit non-object options, and keep the valid `undefined` argv plus options overload green. Preserve child env injection on valid calls. Bump the recorder version.

## Should-fix

### S1. Plausible: the Cezar contention attribution does not establish causality

Location: `docs/specifications/001-core-loop/tasks/001-132/notes.md:53`; D4's cost/result paragraph at `spec.md:81`.

Done-when 3 says a recorder-only failure must be "shown to be load". The evidence does establish reported overlap and an unusually slow `on 1`: summed file time 11,319 s, versus 6,372 and 5,724 s in the later recorder rounds and 6,547 to 6,802 s in the unrecorded ones. It also establishes nine on-only files recovered both in later full runs and in isolated three-round repeats. These observations make ordinary load a credible explanation.

They do **not** distinguish ordinary load from an interaction where the recorder's added synchronous work pushes deadline-bound tests over their limits only in a crowded suite. Both explanations predict quiet isolated repeats and passes in later, lighter runs. `off 2` failing six other files demonstrates general load sensitivity, but is not a control for those nine files. The start/end 1-minute load samples (`on 1` 11 to 6) do not measure overlap at each failure, and elapsed summed time is an outcome, not an independent load control. The research F5 explicitly left this interaction undetermined; the new evidence does not close it.

No recorder-caused contention failure was independently proven here, so this is not blocking. The committed Cezar evidence was recorded during the worker's earlier commits, not repeated at this candidate. It remains **unverified** as a candidate verification run. `1c97556a` is the correct fixture commit; the current `/home/agent/projects/cezar` is `13351da8...`, whose Cursor script differs, so substituting it would not verify the named mock. No second expensive full Cezar proof was run for this review.

Fix sized for one evidence worker: replace "Shown to be load" with the supported uncertainty, and run a bounded, alternating on/off comparison of the same nine files under a fixed competing workload, fixed Vitest concurrency and unchanged deadlines. Record per-file outcomes, worker/child counts, overlap timestamps and load through each run. Isolated low-load repeats are already settled. If contention alone reproduces the failures equally off and on, that supports the attribution; if only on fails, the recorder needs a cost fix. Preserve the p50/p90 measurements as measurements under different loads, not causal overhead estimates. The coordinator should record done-when 3 as not causally settled rather than treating this note as a proven failure.

### S2. Proven, nonblocking: directory-only existence/stat inputs are intentionally dropped

Location: `src/runners/observe/inputs.ts:47`; explicit exclusion in `spec.md:81` (D4).

Reproduction: a test asserts `existsSync(presentDirectory) === true`. `present/a.txt` is tracked and not ignored. The recorder sees `present`, but the adapter removes directories from read/stat inputs. Delete `present/a.txt` and the directory, then process the tracked child's deletion. Key unchanged, zero runs, pass/current; a fresh run fails (`expected false to be true`).

This is **not a blocker** because amended D4 expressly returns observations "less ... the directories it only stat'ed". It is a demonstrated reach limit absent from the named blind-spot list, relevant to the review's honesty question. A file existence check and a directory existence check have different key coverage, even though both use `existsSync`.

Fix sized for one worker: either add a directory-existence input with corresponding creation/removal invalidation, or explicitly name directory-only stats among the supported uncertainty in D4 and the policy reference. Do not conflate existence with a nonrecursive entry-list hash; empty directories are not represented in the current tracked-file listing model. A behavior expansion needs a recorder/key version change.

## Nits

### N1. Proven: the status amendment describes an ignore-filter argument that did not land

Location: `docs/specifications/001-core-loop/status.md:126`.

The amendment says `daemon.ts` "hands observe.runtimeInputs and an ignore filter to createVitestAdapter". The candidate call at `src/core/daemon/daemon.ts:277` passes `root`, `note` and `observe` only. Ignore filtering actually happens at the scheduler's `observedGrowth` (`observed.ts:45`). This is documentation drift, not a missing filtering behavior; the ignored fixture stays excluded.

Fix sized for one documentation worker: correct the amendment's seam description to match the landed boundary. The reviewer has not repaired the status or board.

## What fits

- Required fixture cases passed in the full candidate suite: forks and threads, direct runtime reads, an `env: {}` Node child and another `env: {}` grandchild, default Workers terminated at a message, and ordinary shallow directory additions. The raw grandchild probe also retained both script paths and `grand.txt`. B4 concerns the distinct `SHARE_ENV` form.
- A pure output is handled as designed. A real test writes `output.txt`, reads it back and passes with the recorder on and off; its output is absent from the observed closure. Do not remove output exclusion to fix B3.
- Already-cached input stability works: the post-read external edit led to two runs, first pass discarded, second fail/current. B1 concerns a path with no pre-run cache evidence.
- The store union merges rather than overwrites; a new worktree reads it on first keying. The suite's same-byte worktree inherited without runs; a worktree with a changed grandchild missed and ran. B1 shows that correct lookup can nevertheless inherit an incorrectly stored result.
- `RunReport.observed` reaches the scheduler through the composite adapter; preparation runs under the scheduler lock, and result storage plus shared-set updates run in a store transaction. There is no argument-order or transaction mismatch in those seams.
- Policy-off, on, then off recreates the Vitest instance and restores prior keys in the candidate tests. Resolved config excludes instance-specific injected env, allowing worktree sharing. Both plugin builds contain the recorder and reproduced cleanly.
- D4 and the status amendment still state the research's non-Node, native, Vitest-main/computed-import, async-loader, ignored and outside-worktree blind spots. Policy references state the common subset. `complete: false` remains. D3 explicitly retains the old product closure-method label; this review does not treat that accepted label as a new bug. "Status names the blind spots" was implemented in `status.md`, not as a new runtime status note. A runtime note remains a useful coordinator clarification, not a proven break of this range.
- Cezar's mock-edit driver exercises the real scheduler, keys and inheritance at the research commit, with no declared inputs. Its committed evidence supports the normal-path improvement; it is not independent current-candidate verification, and it does not settle S1.

## Inputs for the fix wave

1. Dispatch B1 to a scheduler worker (`observed.ts`, tier snapshot/storage, scheduler tests). A file absent or unknown before selection must never acquire a certified first result by being hashed only after its read. Preserve known-path fast acceptance; unknown-path fallback must be bounded to one confirmation run under a tracked full key.
2. Dispatch B2, B3, B4 and B6 as recorder repairs with sequential ownership of `recorder.cjs` (or one worker in ordered commits). Keep `RunReport.observed` attribution per completed test file. Preserve original fs/spawn/Worker return values, exceptions, options, shared env semantics and pure output exclusion. Consolidate the recorder-version bump after all reach repairs so older observed passes cannot survive the repair.
3. Dispatch B5 with ownership of recorder listing capture and `Listings`/closure encoding. Settle the representation before changes: immediate listing keys for every visited directory, or a separately versioned recursive key. Entry additions/removals in existing subdirectories must change the key; plain content edits must not move a names-only key. No whole-tree scan for every ordinary `readdir`.
4. Keep the call order: receive the report; collect only completed-file observations; filter to supported project paths; merge the shared set; establish hashes against pre-run evidence; test stability; assemble/re-key the grown closure; write results only under a stable full key; settle ledger state and persist closure in the transaction. New shapes must pass through the composite adapter and preserve listing invalidation in `Ledger.tierChanges`.
5. Two already-running worktrees learning later shared-set growth remain a design bound: `refreshObserved` is called before recording a tier, and its returned changed refs are not used for a periodic re-key of idle files. D3 promises first-key and before-record reads, not idle reconciliation. Do not claim this review proves immediate convergence between idle daemons; coordinate any expansion with the analogous planned 003-26 row.
6. Fold S2 and N1 into a documentation pass. For S1, cap new work to the nine-file controlled-contention experiment before requesting another full-suite comparison. Preserve normal pool/concurrency and deadlines in any eventual full Cezar proof, use `1c97556a`, and avoid overlapping the measurement with the worker's mock runs.
7. Re-review the six blockers with the same discriminating scenarios. The existing happy fixture, cost summaries, policy toggle and shared-store merge need not be re-prosecuted unless the fix changes their boundaries. Verify both pools for Worker repairs, clean plugin rebuilds, lint, typecheck and the repository gate. No performance or platform guarantee beyond the measured Linux/Node 24 evidence is added by this review.
