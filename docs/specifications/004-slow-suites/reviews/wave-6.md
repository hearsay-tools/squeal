# 004 wave 6 review

## Verification

Candidate verified: `17b0c227f13e03fa950635d5ca5a6c65ee378eae`, version 0.1.88. The worker initially started at `a46e09fc`, two documentation-only commits beyond the candidate (`docs/board.md`, `status.md`, `tasks/wave-6.md`). Verification below ran after checking out the exact candidate, on a clean tracked tree. The final review commit is based on the assigned worker branch, retaining those task instructions. There is no executable mismatch. 001-196 (0.1.87) underneath the pinned range is out of scope.

The review uses direct Vitest runs as its required independent check. The separate Squeal checkpoint does not replace them. The old wave-1 implementation brief's no-build instruction is superseded here by the repository and reviewer build gate; the build reproduced both committed plugins without drift.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.88 lint
> biome check .
Checked 728 files in 277ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.88 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.88 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.88 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)

$ npx vitest run
Test Files  2 failed | 324 passed | 1 skipped (327)
     Tests  2 failed | 2350 passed | 10 skipped (2362)
    Errors  1 error
  Duration  380.90s
exit 1
```

The initial Node 24 full gate is not green. Its failures were:

- `test/integration/node-test.test.ts:274`: the first new failure was recorded, but the assertion saw one run instead of both the first and its confirmation rerun.
- `test/integration/node-test-packages.test.ts:157`: each newly failing package consumer ran once where the assertion requires its confirmation run too.
- Unhandled `write EPIPE` at `test/harness/step-down.test.ts:39`, writing the stub daemon's response after the caller had closed the socket. All this file's test assertions passed; the unhandled error still fails the gate.

These tests and their rerun/socket implementations are outside this slice. The package test declares no slow tier; its cold store has no revived predecessor paths, and duration recovery is a restart path. Wave attribution is **unverified**, not blocking. The changed regression files passed in the full run. Load was 20 at the start and observed near 100 during the run. Isolated reruns are recorded below; they do not erase the original failures.

Installation warned about uncovered optional watcher and esbuild install scripts. Installation and build succeeded without changing the lockfile. Node 22's EnvHttpProxyAgent warning is reported where applicable.

The separate full-suite Squeal checkpoint completed on the same clean candidate:

```text
$ timeout 600 node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.86/dist/cli/squeal.mjs run --all --wait
Checkpoint 645ac1a5-7ba6-4917-8cd8-307937c0a909 started at revision 1: 327 test files
Checkpoint 645ac1a5-7ba6-4917-8cd8-307937c0a909 completed
Revision: 1
Known failures: 0
Affected checks: 2679 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 1
HEAD 17b0c22, clean at revision 1
exit 0
```

This is background evidence from the installed 0.1.86 daemon validating the candidate's test files and bundles. Its zero failures do not erase the independent Node 24 gate's failed assertions and unhandled error.

Node `v22.23.3`, with its bin directory first on PATH:

```text
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run --maxWorkers=4
Test Files  1 failed | 325 passed | 1 skipped (327)
     Tests  1 failed | 2351 passed | 10 skipped (2362)
  Duration  577.62s
exit 1
```

The only failure is `test/daemon/busy-store.test.ts:90`: both writer children print the `UNDICI-EHPA` experimental EnvHttpProxyAgent warning, where the assertion requires empty stderr. The three daemon-start assertions and the check for no start-failure notes passed. This warning-only failure is also recorded in reviews 5.5/5.6, predates this range, and remains outside it. Wave attribution is **unverified**, not blocking. A further warning-only rerun would not discriminate a wave regression; it is not repeated. All changed regression files and the Node 24 failure/error files passed in this full Node 22 run.

Independent probes on both Node `v24.21.0` and `v22.23.3` imported the freshly built product `dist` and used real stores under one private `/tmp` directory. No probe opened this repository's store, ran a daemon, used another project's tree or burned CPU. The small runner in the duration proof only supplies baseline environment/listing/closure calls. The source proof exercises `readSlowTier` with seeded known states and revisions; it tests the warning predicate, not scheduler re-keying.

```text
004-52 none: dropped from cache/store/watch
004-52 static: retained in cache/store/watch
004-52 environment: retained in cache/store/watch
004-52 lockfile: retained in cache/store/watch
004-52 observed: retained in cache/store/watch
004-52 artifact: retained in cache/store/watch
004-54 same-file/project newest key: durations 12,40; unrelated 99999/88888 ignored; resultKey null; pending; shortest first
004-55 artifact outside plugins: slow-only source and fast-only source counted; fixture/docs/artifact excluded; both source reverts clear clause
004-55 broad fast source declarations: changed fast-only AND slow-closure sources hidden, per amended D8 (nonblocking policy limitation)
exit 0 on both Nodes

Private disabled-fix controls, Node 24:
004-52 cleanup call disabled: scratch still extra, true !== false, exit 1
004-54 duration fallback disabled: null !== 12, exit 1
004-55 prior unrestricted source predicate: fixture-only clause true !== false, exit 1
```

These controls change only private compiled copies, not the tracked candidate. All probe stores are closed and private probe scratch is removed before the findings commit.

Node 24 isolated forks for the two failed integration files and the file that emitted EPIPE:

```text
$ npx vitest run test/integration/node-test.test.ts test/integration/node-test-packages.test.ts test/harness/step-down.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  3 passed (3)
     Tests  17 passed (17)
    Errors  1 error
  Duration  59.36s
exit 1
```

Both confirmation-run assertions pass in isolation. The unhandled `write EPIPE` at the unchanged stub socket's `step-down.test.ts:39` recurs despite all 15 step-down assertions passing. Thus the isolated gate is also **not green**; no success is inferred from its passing file/test counts. This socket error is outside the pinned source delta and also absent from the full Node 22 run. Wave attribution remains **unverified**. No product or test fixes were attempted.

## Verdict

**PASS at `17b0c227` (0.1.88).** Zero blockers, one nonblocking policy note, zero new nits. This first review covers `3040e11d^..17b0c227`: 004-52, 004-54, 004-55, the accepted D8 amendment and both plugin bundles. Underlying 001-196 and earlier settled review findings are outside the slice. PASS is the bounded code-review verdict; it does not turn failed verification gates into passing ones.

## Blockers

None.

## Should-fix notes

### S1. A broad fast declaration hides executable source changes too

**Proven on Node 22 and 24; nonblocking policy limitation.** `src/core/state/slow-sources.ts:71` and `:79`; amended spec 004 D8 requires a source to be “selected by no fast test's declared `inputs`”.

That filter treats every fast declaration as a fixture declaration. This repository also declares `src/**/*.ts` for fast tests that run daemon or harness code (`squeal.config.json:5`, `:26`, `:47`). With `test/e2e` marked slow and the plugin artifact declared as in D5 and dogfooding, these declarations exclude all `src` paths from the source warning, including sources the stored fast closures name. A declared artifact outside `plugins/**` has the same overlap risk.

In the private real-store probe, `packages/widget/dist/**` is the slow artifact. A changed `src/only-fast.ts` and `packages/widget/src/index.ts` first turn the clause on under fixture-only fast inputs; the latter is explicitly in the slow closure. Adding fast declarations `src/**/*.ts` and `packages/widget/src/**` makes the clause false for both changed sources, while the artifact remains unchanged. The result is identical on both Nodes.

A real scheduler separately re-keys a slow file that directly closes over the edited path; this probe tests the warning predicate, not a bypass of that key/current-state check. The practical warning gap concerns sources behind an unchanged artifact. This follows the accepted D8 amendment exactly, so it is not a blocker or an unaccepted implementation deviation. “Current against” the unchanged artifact is still accurate. It limits how useful the extra warning is for the repository's actual broad source declarations.

If selected, the coordinator first narrows D8's fixture exclusion so executable-source declarations do not erase source evidence. One status worker then changes `artifactSources` and adds an overlapping-input regression, preserving content/revert comparison and leaving test keys/results unchanged. The discriminator must come from an explicit rule or recorded source evidence, not an assumption that all fast `inputs` are fixtures. No repair is required before accepting this conforming slice.

## Nits

None added.

## What fits

- **004-52, proven:** `src/core/scheduler/keying.ts:443` remembers only paths the existing 004-47/50 rule initially dropped, then `:458` releases revived paths only after current closures stop referencing them. The reverse index protects every current closure, the explicit named set protects environments, installed lockfiles and observed reads, and the same artifact predicate protects admitted slow inputs. Cleanup also runs when no new paths need hashing, which is the second bootstrap closure resolution's case. Removal clears the extra-watch set, in-memory cache entry and persisted hash together through the existing drop method. The added complete-store regression seeds hashes and a saved combined closure, replaces it with the actual runner closure, rewrites scratch, and scans every tracked/extra path. No extra revision or rerun remains.
- **004-52's adjacent consumers, proven:** the independent real-store probe recreates that hash/combined-closure/current-closure sequence. Declaration-only ignored scratch is removed. Five separate controls retain a static import, environment input, installed hidden lockfile, observed read and ignored declared artifact. These paths remain in the cache, persisted hashes and watch extras. A private copy with only the new cleanup call disabled fails the scratch-removal assertion. The product completion barrier and declared-input rules were not changed.
- **004-54, proven:** `src/core/scheduler/bootstrap.ts:152` changes only `durationMs` when the stored previous key has no results. The existing held-result assignment at `:158` remains untouched, and this new branch cannot make an old result current. `newestResults` at `:191` enumerates checks for the same project and path, chooses their latest recorded result's key, reads without advancing last-used (`byKey(key, 0)`), and filters the returned key's rows by both project and path. The independent baseline/ledger probe includes newer foreign-project and unrelated-path results deliberately sharing that key; 99,999 ms and 88,888 ms do not enter the duration. The own newest key contributes 7 ms plus 5 ms of file-level time, replacing an older 30 ms run; the other slow file contributes 40 ms. Both files remain pending with `resultKey === null` and order 12 ms before 40 ms. Disabling only the new fallback yields null instead of 12 ms. The added scheduler regressions cover both the held in-flight restart and graceful stop, including the activity's previous-duration field and run order.
- **004-55, proven against amended D8:** `src/core/state/slow-sources.ts:64` uses closures for this worktree's listed file identities, fast and slow. It excludes fast declared inputs, test files and slow directories; `sourcesChanged` keeps the policy/artifact exclusions and first-old/last-new content comparison. It has no `plugins/**` special case. The real-store `readSlowTier` probe declares `packages/widget/dist/**`: a slow-only `packages/widget/src/index.ts` and fast-only `src/only-fast.ts` both turn the clause on, and reverting each clears it while a changed fixture/doc remains. Fixture, doc and artifact changes alone leave it off. Restoring the prior unrestricted source predicate in a private build makes the fixture-only assertion fail. The shipped tests independently cover fixture/docs exclusion, fast-only and slow-only sources, revision additions and reverts.
- **Scope and contracts, proven:** no public status shape, persisted schema or dependency changed. The new source helper is internal. The rebuilt Claude Code and Codex bundles reproduce exactly from the candidate. Source paths outside `plugins/**` are supported by closure membership, not inferred by a build command; goal 8 still holds.

## Inputs for the next wave

1. No repair wave is required by this review. The coordinator owns integration, release and board/status changes.
2. S1 is a policy refinement, not a code-conformance repair. Until amended further, preserve the accepted D8 definition: fast tests' declared inputs are excluded even if they could also be build sources. Paths no listed closure names are outside that definition. The clause is not a general build dependency graph; this is a stated policy boundary, not an additional finding.
3. Preserve the independent full-suite and Squeal caveats recorded above. Re-runs do not erase initial gate failures. macOS remains unverified and outside this Linux review.

The review commit changes only this findings file. Private repositories, stores, compiled controls and probe scripts were removed before committing.
