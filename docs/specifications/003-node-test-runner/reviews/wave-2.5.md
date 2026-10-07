# 003 wave 2.5 re-review

## Verdict

**FAIL 7e15b70**. One proven blocker, no new should-fix items, two non-blocking notes. Wave 2 B1 is only partly closed: `--import` preload observations are keyed, but a computed load from a `--require` preload still escapes every key. S1 is closed for the exercised project failures. S2 meets the coordinator's accepted next-local-revision bound; the no-edit case remains row 003-26.

Reviewed row 003-24: `b11ee2b`, `07310ab`, `5e2d00d`, `edc5d48`, `2ed5f49`, `9fc408a`, `917ba99`, `d63887b`, and their 0.1.24 bundles. HEAD is `7e15b70f1e67e9552087b4a6592a3489aec3ed9e`, rather than the brief's landing `cf0f21f`: the intervening change is only board, task and 002 status documentation. Product and bundle content match the candidate. No 001 or 002 product changes are reviewed here.

## Verification output

Commands ran on the clean candidate before this findings file was added. Build left tracked files unchanged. Probes used temporary repositories and stores under `/tmp`, never this repository's store or the cezar repository.

```text
$ git rev-parse HEAD
7e15b70f1e67e9552087b4a6592a3489aec3ed9e
$ node --version
v24.21.0
$ npm ci
added 56 packages, and audited 57 packages in 4s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
> squeal@0.1.24 lint
> biome check .
Checked 500 files in 231ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.24 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.24 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.24 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(empty)
$ npx vitest run
 Test Files  7 failed | 174 passed | 1 skipped (182)
      Tests  7 failed | 1548 passed | 14 skipped (1569)
   Duration  262.80s (tests 95%, transform 3%, import 1%)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run \
    test/runners/node-test test/integration/node-test.test.ts \
    test/cli/init-node-test.test.ts --maxWorkers=2
 Test Files  20 passed (20)
      Tests  142 passed (142)
   Duration  58.31s (tests 87%, transform 9%, import 3%)
```

Full-suite green is **unverified**. Six of its eight reported failures are disk exhaustion: SQLite reports `database or disk is full` in `repository-inputs`, `ensure`, both `stop` cases and `runner-failure`; the Codex plugin build reports `no space left on device`. The other two are the existing `status-wait` bound (`223.19442600000184` ms against 200 ms) and the hook latency test's 180 s timeout. Host load was about 55 to 74. These files are outside the reviewed slice and are not findings against it. All node:test runner, init and integration tests, including the revised enumeration ratio, passed in that Node 24 run and in the scoped Node 22 run. No full-suite retry was run.

## Blockers

### B1. `--require` preloads execute before the recorder and their computed loads remain unkeyed (proven)

Locations: `src/runners/node-test/run/run.ts:77-85`, `src/runners/node-test/runtime/recorder.mjs:12-16`, `src/runners/node-test/adapter-observed.ts:92-106`. The repair persists the paths the recorder saw, but the recorder is still installed with `--import`. Node executes every `--require` preload before any `--import`, regardless of their positions in argv. A project's require preload therefore runs before `module.registerHooks` is installed. Its computed dependency never reaches `preloadPaths`, so the new meta key cannot repair the gap.

Spec 003 D1 includes the closure of every `--import` and `--require` preload in the environment hash. Goal 5 requires an observed path outside the static closure to be stored, to block inheritance when its content differs, and to schedule the file when it changes. Vision principle 2 forbids an old result posing as current. This is the prior B1's remaining preload shape, not an unrelated new prosecution.

The temporary fixture used no tsx or installed packages:

```js
// argv: ["--require", "./scripts/setup.cjs"]
// scripts/setup.cjs
require("./helper" + ".cjs");
// scripts/helper.cjs
globalThis.value = 1;
// test/a.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
test("helper", () => assert.equal(globalThis.value, 1));
```

Adapter probes on **Node 22.23.3 and 24.21.0** produced the same result:

```text
run: completed; named test: pass
environment.files: ["package.json","scripts/setup.cjs"]
affected(["scripts/helper.cjs"]): {"direct":[],"transitive":[]}
note: preload closure incomplete: require() with a computed specifier at scripts/setup.cjs:1:1
assert environment.files includes scripts/helper.cjs: FAIL
```

The test closure also lacks the helper. The incomplete note names the uncertainty but does not stop a current pass.

Two real daemons launched from the **committed Claude Code plugin** on Node 24 confirmed the consequence:

```text
baseline: current=2, pending=0, stale=0, unknown=0; failures=[]; preloadKey=null
edit helper to globalThis.value=2:
  revision=1; current=2; failures=[]; runs=1; beforeRuns=1
start second worktree whose helper also sets value=2:
  current=2; failures=[]; inherited.count=2; runs=0
```

Both the named test and its file-level check remain current; the failing helper edit schedules no run. The second worktree inherits the baseline for content it never validated.

One-worker repair scope: install the synchronous recorder before project **require** preloads, for example through a first `--require` bootstrap that registers the hooks; retain the relative order and meaning of the project's argv. Add a computed-require preload regression on Node 22 and 24, asserting helper observation, re-run after its edit, and an inheritance miss for differing content. Cover a required package preload and nested preload as well. Bump adapter semantics/version if existing passes could otherwise survive the repair. This is the second and final review round: the coordinator must take this blocker to the human for disposition, not dispatch a third round automatically.

## Should-fix

None new. Prior S1 and S2 dispositions are below; the accepted no-local-edit follow-up is already 003-26.

## Nits and non-blocking notes

- **N1, proven retention behavior; long-term cost plausible.** `observedStore.writePreloads` (`src/core/daemon/node-test-runners.ts:51-55`) unions every path ever observed, and `Observed.addPreloads` (`adapter-observed.ts:122-128`) only grows its set. Store pruning has no rule for these meta keys. Generated helper names or historical branch layouts can accumulate environment inputs and cause extra invalidation across worktrees. No size or latency break was demonstrated. Any compaction must preserve paths still needed by another live worktree; do not impose a truncation cap that loses evidence.
- **N2, plausible, not a demonstrated rejection.** Project isolation catches initial `openProject` errors, but a successfully opened project's later `invalidate`, `affected` and `environment` calls delegate directly (`adapter.ts:129-136`, `adapter-project.ts:83-94`). A later graph rebuild exception would still reject the composite call. Bad argv, a cyclic/bad tsconfig and an import through a symlink loop did not produce that exception in the probes. Do not dispatch hardening from this note without a reproducer.

## What fits

### Prior B1's `--import` cases (proven)

The completed-file observations now reach the environment, persist across adapter starts, and make the project affected. Independent probes passed for a worktree preload importing another preload with a computed helper, and a bare preload physically under `node_modules` importing a worktree helper. In the latter, the environment starts with just `package.json`, then gains `scripts/helper.mjs`; an edit makes its test transitive. Reachability crosses package nodes before filtering returned paths. The existing real-daemon integration test proves differing helper content misses, and the original worktree's helper edit runs only its project.

Adapter version 2 enters `projectEnvironment` and `environmentHash`, so version-1 node:test result keys cannot match. This conservatively re-keys the project, including passes that had no preload observation; it does not selectively migrate only the affected passes. A version bump cannot collect a `--require` helper that still executes before the recorder.

### S1 project isolation (proven for the exercised failures)

The catch around `openProject` is inside the adapter. The composite regression and integration test validate healthy node:test and Vitest projects beside an absent cwd. A directory that appears recreates its project, and a cwd that is a file stays skipped with one note. Bad argv, cyclic/bad tsconfig and a self-referential imported symlink did not reject startup or invalidation in the independent probes: resolver misses stay in closures or a subsequent child run can fail. Post-start graph exceptions remain unproven as N2 records.

### S2 next-local-revision bound (proven end to end)

Two shipped daemons shared a temporary git repository's store. B first held a pass under a key without `src/hidden.mjs`; neither process had observed that path. A subsequently ran a computed import and recorded it, while B's helper content differed. B still showed two current checks before any local edit, which is the accepted window. An unrelated edit to B's tracked README then produced:

```text
A observation: nodeTest.observed.p={"test/a.test.mjs":["src/hidden.mjs"]}
B before local edit: current=2, pending=0, stale=0, unknown=0
B unrelated edit: revision=1; current=2; failures=[test/a.test.mjs]
```

`invalidate` refreshes observations before `affected`; test-set growth is reported once, so refinement fetches the widened closure and re-keys. The accepted bound is therefore implemented for a write visible before the local refinement. This probe tests the repair of an already-current pass; it does not claim to reproduce the original tier-cache-hit race's exact interleaving. The adapter regression separately exercises two adapters created before A's run. With no local revision the daemon still does not poll runner observations; that is the existing 003-26 scope.

### Preload meta storage (proven)

Independent adapters over **separate SQLite connections** ran simultaneously and observed different helpers. The shared key became `["scripts/a.mjs","scripts/b.mjs"]`; both adapters learned both paths on their next invalidation. The transactional read/union/write does not replace another writer's additions. Raw-value caching checks the database again before reuse. The sibling key avoids an old daemon interpreting preload observations as test-file entries; an old binary still has its old observation semantics, so it must be restarted to receive the B1 repair.

### Init, notes and cost

The N1/N2 init regression tests pass: refused scripts no longer rename a uniquely seeded script, and a kept config without `nodeTest` receives suggestions without being overwritten. N3's new code-range tests pass for comments, strings, regex and template interpolation. N4 now reports preload reasons and summarizes incomplete test closures.

The enumeration ratio passed under full-suite load on Node 24 and in the scoped Node 22 run. A temporary generated graph probe measured adapter open and first `affected` separately on Node 24:

| Generated modules | Test files | Adapter open | First `affected` | Process RSS | Host load |
| --- | --- | --- | --- | --- | --- |
| 1,000 | 200 | 1,179 ms | 0.41 ms | 120 MiB | 55.53 |
| 10,000 | 2,000 | 16,279 ms | 0.32 ms | 365 MiB | 62.74 |

Open includes the Node probe, graph and initial notes/index construction. The measurements came from one process in that order, with no forced GC; RSS is process total, not retained graph heap. They do not establish a calm-host budget or a regression against wave 2. The first lookup is small; startup needs generous settle budgets, as the previous review said. Resolver-cache memory work remains the already assigned 003-27.

## Inputs for the coordinator

1. Take residual B1 to the human. Keep `--require` preloads explicit in the disposition; a blanket claim that preload observation is closed would be false.
2. 003-26 still needs scheduler work to re-key external observation growth without a local revision. Keep the current `invalidate`, then `affected`, then closure-fetch order; preload growth requires the environment to be fetched as well.
3. Preserve the passing `--import` and mixed-runner integration coverage. Add the `--require` shape to the proof if the human authorizes its repair.
4. Re-establish full-suite green when disk capacity and host load permit. The recorded failed full suite is not green verification and is not a proven product break of this slice.
