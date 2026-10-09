# 004 wave 5.6 review

## Verification

Tested HEAD: `3a3e752272ed2f17719001788b964eb6506466b2`, version 0.1.75. The pinned candidate consists of `0aeff3b` (004-50) and `1a3d231` (both plugin bundles). Later commits change documentation only. No executable mismatch. This is the second and last review round for 004-47, bounded by `reviews/wave-5.5.md` B1; 004-48 and earlier settled findings are not reopened.

The lockfile install and checks ran on the clean tracked candidate before adding this report. The build reproduced both committed plugins without drift. The review's independent Vitest gate was run directly; Squeal's checkpoint below is separate evidence. The implementation brief's no-build instruction does not remove the reviewer and repository build gate.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.75 lint
> biome check .
Checked 691 files in 265ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.75 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.75 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.75 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  4 failed | 299 passed | 1 skipped (304)
     Tests  4 failed | 2264 passed | 11 skipped (2279)
  Duration  345.64s
exit 1

$ npx vitest run test/integration/node-test.test.ts test/runners/node-test/fixtures.test.ts test/daemon/handover.test.ts test/watcher/linked-dirs.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  4 passed (4)
     Tests  21 passed (21)
  Duration  51.31s
exit 0
```

The full-run failures were:

- `test/daemon/handover.test.ts:72`: expected `spawned`, received `alive` from the handover hook.
- `test/integration/node-test.test.ts:271`: the assertion expected the newly failing file's second run too, but saw only the first.
- `test/watcher/linked-dirs.test.ts:64`: the first start batch contained `lib`, but not yet `lib/a.ts`.
- `test/runners/node-test/fixtures.test.ts:265`: the generated fixture's node:test run exited 1 where the test expected 0.

All four files passed in isolated forks. The failed assertions and their implementations are outside this range. Attribution to this slice is **unverified**, not blocking; the reruns do not erase the full-gate failures. Host load was observed near 99 during the first run and near 41 afterward. The new scratch-input tests and the artifact regression files passed in this full run.

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run --maxWorkers=4
Test Files  1 failed | 302 passed | 1 skipped (304)
     Tests  1 failed | 2267 passed | 11 skipped (2279)
  Duration  518.40s
exit 1
```

The sole failure is `test/daemon/busy-store.test.ts:90`: both writer children printed only EnvHttpProxyAgent experimental warnings, while the assertion requires empty stderr. The three daemon-start assertions passed. This warning-only failure is also recorded in wave 5.5; the writer and startup implementation are outside this slice. Attribution to the wave is **unverified**, not a blocker. An additional warning-only rerun would not resolve any uncertainty about the assertion's content. All scratch-input and artifact regression files passed on Node 22 too.

Installation warned about optional watcher and esbuild install scripts; installation and build succeeded. Node 22 printed EnvHttpProxyAgent and SQLite experimental warnings.

The repository's separate Squeal checkpoint used the primer's absolute CLI (installed plugin 0.1.62), bounded externally to 10 minutes:

```text
$ timeout 600 node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.62/dist/cli/squeal.mjs run --all --wait
Checkpoint 0ce0f6dd-39db-4355-80c7-a20f4a8a833f started at revision 1: 0 test files
Checkpoint 0ce0f6dd-39db-4355-80c7-a20f4a8a833f completed
Revision: 1
Known failures: 2
Affected checks: 2570 passed, 0 running, 0 queued, 11 skipped
Full-suite checkpoint: completed at revision 1
exit 0
```

The two current background failures are `test/scheduler/observed-growth.test.ts:176` (`expected 0 to be greater than 0`) and its file-level teardown (`database is not open`). This file and its observed-growth race are outside the repair; a load-sensitive version is already recorded on the board. Wave attribution remains **unverified**. The checkpoint reused current results and ran no new file; exit 0 is not an all-green verdict. No background all-pass claim is made.

Independent keying and scheduler probes exited 0 on both Node `v24.21.0` and `v22.23.3`:

```text
cold: fast runs 1, revision 0 after two full interval scans,
      scratch neither tracked nor extra, results current
predecessor-bootstrap warm: fast runs 1, revision 0 after two full interval scans,
      scratch neither tracked nor extra, results current
predecessor-bootstrap + stored combined closure warm:
      fast runs 1, revision 0 -> 1 after interval scans,
      scratch tracked and extra, results current (S1)
PASS ignored static/observed/environment/installed-lockfile extras retained;
     artifact bytes change slow key

negative control with pre-004-50 keying:
cold: fast runs 1, revision 0
warm: fast runs 4, revision 3, scratch tracked and extra
      (first three scratch-changing results withheld; fourth stops writing)
```

Independent probes imported the freshly built product `dist`. All probe repositories, stores, builds and slow permits were under one private `/tmp` directory. No probe opened this repository's store or another project's tree. To seed ignored scratch through actual predecessor `WorktreeKeys.bootstrap()` and the real `fileHashes` repository, a private copy of candidate `dist` loaded only pre-004-47 `b70fcc2`'s transpiled `keying.ts`. A second private copy used pre-004-50 `be9765e`'s keying as the negative control. These are keying-boundary controls, not verification of either entire earlier release. The candidate scheduler, completion barrier, store and state sink were real; the small runner returned passing check reports and rewrote the real scratch file on every fast run. Stores and schedulers were closed and all private probe scratch removed before committing.

## Verdict

**PASS at `3a3e752`**, executable candidate `1a3d231`. Zero blockers, one nonblocking should-fix note, zero new nits. Wave 5.5 B1's self-feeding warm-store loop is closed on Node 22 and 24. The independent full-suite failures above remain gate failures; they do not establish a proven defect in this slice.

## Blockers

None. **Wave 5.5 B1, proven closed:** in the prior review's cache-only warm-store setup, excluded ignored scratch is removed from both the stat cache and persisted hashes before startup reconciliation. It joins neither the fast closure nor the stability paths. The fast run writes different scratch bytes, stores once, remains current, and two full interval scans leave revision 0 unchanged. The identical cold control behaves the same. With pre-004-50 keying restored privately, three rewritten scratch runs are withheld and produce revisions 1 to 3; a fourth run stores only after the probe deliberately stops changing the scratch. Thus the probe discriminates the original defect from the repair.

## Should-fix notes

### S1. A predecessor's saved combined closure can re-add declaration-only scratch to the watch set

**Proven on Node 22 and 24; nonblocking.** Changed seam: `src/core/scheduler/keying.ts:436` and `:522`, called by `src/core/scheduler/bootstrap.ts:111` and `:117`.

A real predecessor store can hold the final combined closure in `test_files`, as well as hashes in `file_hashes`. The upgrade tests added by 004-50 seed hashes only. To cover this adjacent seam, the independent probe called predecessor `setClosure` and `trackUntracked`, then the actual `storeClosures`, after the predecessor bootstrap. The saved fast closure therefore contained `fixtures/.tmp/out.txt` as a declared input.

Candidate bootstrap correctly drops the hash. Baseline then passes the saved combined closure to `setClosure`, queuing the dropped path in `#untracked`. `resolveClosures` calls `trackUntracked`, which hashes and watches that path again. Fresh runner closure resolution later removes scratch from the fast closure, but its extra-watch entry remains. The initial fast run is stored once at revision 0; a full interval scan notices its scratch rewrite and advances to revision 1. The second scan is quiet. Both fast and slow results stay current and the fast file never re-runs.

This does **not** reproduce B1's declaration or stability-path loop: `#declarable` excludes the retained scratch, and the current runner closure no longer references it. It is incomplete cleanup of the brief's request to "drop declaration-only ignored entries from the extra-watch set", so it is recorded as a note in this bounded re-review rather than a new blocker.

Fix sized for one keying worker: after stored closures have been replaced by current runner closures, remove reintroduced dropped paths that no current static/observed closure, environment, installed lockfile or admitted artifact needs. Preserve paths with real consumers and keep the completion barrier. Add a complete predecessor-store test containing both persisted hashes and persisted combined closures; require no scratch extra and no interval revision. No public schema change is needed.

## Nits

None added. Wave 5.5 N1, the duplicated turn-row key, remains a previously recorded maintenance input and is outside this repair.

## What fits

- **Warm-cache selection, proven:** the slow-artifact rule applies both at ignored discovery and at all four declared-input assembly sites: bootstrap, policy reload, structural input changes and ignored-input relisting. `#drop` removes obsolete declaration-only hashes before start reconciliation. `#dropped` prevents a removed hash from masquerading as known absence when a real closure requires it later.
- **Required ignored extras, proven:** static generated code, shared observed reads, runner environment files and the installed hidden lockfile remain hashed and watched. When an old declaration also selects them, the candidate re-tracks them for their real consumer while excluding them from unrelated fast declarations. The new generated-code restart test verifies a rewrite while no daemon runs, then a watched edit, without re-running the unrelated fast file.
- **Artifacts, proven:** an allowed ignored `dist/index.js` remains declared for the slow file. Changing its bytes changes that file's key. Existing literal, wildcard, tracked-link, symlink-target, interval-addition and quiet-rewrite regression tests cover 004-28/38/41/44.
- **Tests and scope:** the new warm/cold test rewrites an existing scratch file on every fast run, asserts a stored current result and no scratch watch/tracked path, and performs two interval passes. The independent predecessor bootstrap and negative control strengthen its manually seeded hash fixture. No stability, watcher, ledger or `batch.ts` product code changed. The new `isInstalledPath` barrel export is an internal predicate; no public status type, persisted schema or runtime dependency changed. macOS remains unverified and outside this Linux review.

## Inputs for the next wave

1. B1's repair is accepted by this re-review. There is no remaining blocker to send to the human under the second-round rule. The coordinator owns landing, release timing, the fixture-glob workaround and board/status updates.
2. Carry S1 as a separate cleanup if selected. Its regression must use a predecessor store with saved combined closures, not just `file_hashes`. Current closures and environments must still retain ignored paths they actually need.
3. Preserve the failed full-gate and background-status caveats; PASS is the bounded review verdict, not an all-green suite claim. Earlier 004-48 results and wave 5.5 N1 need no renewed prosecution here.

This commit changes only the findings file.
