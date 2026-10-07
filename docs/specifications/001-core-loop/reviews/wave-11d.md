# Review: 001-109 re-review (001-110, wave 11d)

## Verification

All commands and probes below ran at exact candidate `015e38cd5866adade62f7f12a899aba0c8491bd2`, with no tracked product edits. The build left the tracked tree clean; it stayed clean through all checks and probes. Starting HEAD was a later documentation-only commit, recorded as N1 below. After verification I returned to the task branch to commit this findings file alone.

```text
$ git rev-parse HEAD
015e38cd5866adade62f7f12a899aba0c8491bd2
$ git status --porcelain
(empty)
$ npm ci
added 56 packages, and audited 57 packages in 15s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
(exit 0)
$ npm run lint
> squeal@0.1.23 lint
> biome check .

Checked 491 files in 752ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.23 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.23 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.23 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(empty)
$ npx vitest run
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/5c8ce4c8-ec66-41ac-8faf-df66a9962c42

 ❯ test/cli/codex.test.ts (13 tests | 1 failed) 13151ms
   ❯ squeal init --harness codex (6)
     × touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI 6638ms
 ❯ test/harness/stop.test.ts (8 tests | 1 failed) 10172ms
   ❯ Stop within its 2 s hook timeout (review wave 3, N4) (2)
     × gives up on a locked store before Claude Code would kill it 2920ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/5c8ce4c8-ec66-41ac-8faf-df66a9962c42/test/fixtures/scheduler/.tmp/4e124da5-7ce9-4031-84bb-c9a61b07e518/main/.git/worktrees/staged/gitdir
 ❯ test/runners/node-test/fixtures.test.ts (10 tests | 1 failed) 44634ms
   ❯ node:test fixtures under the current Node (10)
     ❯ gen-big.mjs (2)
       × writes 1,000 modules and 200 test files, deterministically, under 2 s 35481ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/5c8ce4c8-ec66-41ac-8faf-df66a9962c42/test/fixtures/scheduler/.tmp/b93ba974-2db6-44df-ba2e-35f533033bf9/main/.git/worktrees/staged/gitdir
 ❯ test/harness/codex/bundles.test.ts (28 tests | 1 failed) 26161ms
   ❯ bundled Codex hooks, recorded JSON in and JSON out (1)
     × serve a codex exec session end to end 5152ms
 ❯ test/scheduler/refinement-lock.test.ts (2 tests | 1 failed) 27483ms
   ❯ scheduler: revisions during a refinement (D2, review wave 4.5 S3) (2)
     × stores a revision within 500 ms while the runner part of an earlier one waits on the runner 14109ms
 ❯ test/harness/latency.test.ts (1 test | 1 failed) 180071ms
   ❯ bundled hook latency (1)
     × stays under 80 ms p95 over 20 cold runs per hook 180066ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 6 ⎯⎯⎯⎯⎯⎯⎯

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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/6]⎯

 FAIL  test/harness/latency.test.ts > bundled hook latency > stays under 80 ms p95 over 20 cold runs per hook
Error: Test timed out in 180000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/latency.test.ts:144:3
    142|
    143| describe("bundled hook latency", () => {
    144|   it(`stays under ${BUDGET_MS} ms p95 over ${RUNS} cold runs per hook`…
       |   ^
    145|     const r = seeded();
    146|     const dir = runtimeDir();

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[2/6]⎯

 FAIL  test/harness/stop.test.ts > Stop within its 2 s hook timeout (review wave 3, N4) > gives up on a locked store before Claude Code would kill it
AssertionError: expected 1934.1354140000003 to be less than 1875
 ❯ test/harness/stop.test.ts:176:23
    174|       expect(elapsed).toBeGreaterThanOrEqual(STOP_WAIT_CAP_MS);
    175|       // In process, so no Node start: the margin is left over.
    176|       expect(elapsed).toBeLessThan(HOOK_TIMEOUT_MS - STOP_MARGIN_MS / …
       |                       ^
    177|     } finally {
    178|       clearTimeout(lock);

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[3/6]⎯

 FAIL  test/scheduler/refinement-lock.test.ts > scheduler: revisions during a refinement (D2, review wave 4.5 S3) > stores a revision within 500 ms while the runner part of an earlier one waits on the runner
AssertionError: expected 514.3308309999993 to be less than 500
 ❯ test/scheduler/refinement-lock.test.ts:47:40
     45|     const before = performance.now();
     46|     await h.batch("src/strings.ts");
     47|     expect(performance.now() - before).toBeLessThan(500);
       |                                        ^
     48|     expect(store.revisions.latest(h.worktreeId)?.number).toBe(added + …
     49|     expect(h.header()).toMatchObject({

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[4/6]⎯

 FAIL  test/harness/codex/bundles.test.ts > bundled Codex hooks, recorded JSON in and JSON out > serve a codex exec session end to end
Error: Test timed out in 5000ms.
If this is a long-running test, pass a timeout value as the last argument or configure it globally with "testTimeout".
 ❯ test/harness/codex/bundles.test.ts:86:3
     84|
     85| describe("bundled Codex hooks, recorded JSON in and JSON out", () => {
     86|   it("serve a codex exec session end to end", async () => {
       |   ^
     87|     const r = squealRepo();
     88|     r.apply(r.pass(), r.pass(SUBTRACTS));

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[5/6]⎯

 FAIL  test/runners/node-test/fixtures.test.ts > node:test fixtures under the current Node > gen-big.mjs > writes 1,000 modules and 200 test files, deterministically, under 2 s
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

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[6/6]⎯


 Test Files  6 failed | 170 passed (176)
      Tests  6 failed | 1481 passed | 8 skipped (1495)
   Start at  00:34:13
   Duration  280.99s (tests 96%, transform 3%, import 1%)
(exit 1)
```

The full run is **not green**. Five failures above are timeout or timing assertions; the node:test fixture fails because its child exits 1, with the cause not established by this output. The host's observed one-minute load reached 116.18. Host contention is a plausible explanation, not a proven cause for every failure. None of those failed assertions or fixture implementations belongs to 001-109's six-commit slice. They are recorded verification limitations, not findings against this wave.

The four files covering the repair passed with one worker:

```text
$ npx vitest run test/keys/packages.test.ts test/keys/install-refresh.test.ts test/runners/vitest/packages.test.ts test/runners/vitest/closure-packages.test.ts --maxWorkers=1
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/5c8ce4c8-ec66-41ac-8faf-df66a9962c42


 Test Files  4 passed (4)
      Tests  33 passed (33)
   Start at  00:38:33
   Duration  8.01s (tests 71%, transform 24%, import 4%)

    Isolate  4 workers spawned · ~136ms startup each (spawn + environment, per file)
             at least ~408ms faster with isolate: false — reuses workers across files instead of one per file
(exit 0)
```

Five short full-run failures were rerun individually in one serial command and passed:

```text
$ npx vitest run test/cli/codex.test.ts test/harness/stop.test.ts test/runners/node-test/fixtures.test.ts test/harness/codex/bundles.test.ts test/scheduler/refinement-lock.test.ts --maxWorkers=1 -t 'touches nothing under a scratch|gives up on a locked store|writes 1,000 modules|serve a codex exec session|stores a revision within 500 ms'
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/5c8ce4c8-ec66-41ac-8faf-df66a9962c42


 Test Files  5 passed (5)
      Tests  5 passed | 56 skipped (61)
   Start at  00:39:27
   Duration  22.48s (tests 92%, transform 6%, import 2%)
(exit 0)
```

The 180-second hook-latency test was not rerun: a calm-load latency claim remains **unverified**. No second full suite was run. The independent result-changing probes described below completed; their expected after-bump failures are probe outcomes, not root-suite failures.

### Fresh-clone `cezar` measurement

```text
$ git clone --quiet /home/agent/projects/cezar /tmp/rv110-cezar
$ git -C /tmp/rv110-cezar checkout --quiet c7fa7178
$ npm ci --prefix /tmp/rv110-cezar
added 559 packages, and audited 564 packages in 2m
(exit 0)
$ npx tsx docs/specifications/001-core-loop/tasks/001-105/measure-cezar.mts /tmp/rv110-cezar /home/agent/projects/cezar /tmp/reviewer-110-cezar.json
{
  "testFiles": 632,
  "projects": [
    "api-client",
    "contract",
    "server",
    "web"
  ],
  "reachChildProcess": 306,
  "reachOpaque": 310,
  "noPackagesReported": 0,
  "walkMs": 53791,
  "lockfileReadMs": 23,
  "keyingMs": {
    "firstWithScans": 1877,
    "coldGraphWarmScans": 28
  },
  "firstScans": {
    "scanned": 177,
    "ms": 1701
  },
  "wholeFingerprint": 367,
  "wholeByProject": {
    "api-client": {
      "files": 2,
      "whole": 0,
      "environmentWhole": false
    },
    "contract": {
      "files": 6,
      "whole": 0,
      "environmentWhole": false
    },
    "server": {
      "files": 391,
      "whole": 300,
      "environmentWhole": false
    },
    "web": {
      "files": 233,
      "whole": 67,
      "environmentWhole": false
    }
  },
  "reachUnnamedLoad": 230,
  "scanAll": {
    "packages": 555,
    "opaque": 26,
    "ms": 2049
  },
  "mainLiteral": {
    "kept": 0,
    "keptWhole": 0,
    "keptReachingChildProcess": 0,
    "keptReachingOpaque": 0,
    "stale": "node_modules/.package-lock.json does not describe the installed packages (not listed in it: node_modules/@fontsource/poppins); dependencies are keyed by their package.json files until npm rewrites it",
    "sample": []
  },
  "mainAsIs": {
    "kept": 265,
    "keptWhole": 0,
    "keptReachingChildProcess": 0,
    "keptReachingOpaque": 0,
    "stale": null,
    "sample": [
      "api-client:packages/api-client/src/protocol/tool-display.test.ts",
      "api-client:packages/api-client/src/utils/project-scope.test.ts",
      "contract:packages/contract/src/attention.test.ts",
      "contract:packages/contract/src/automation-schedule.test.ts",
      "contract:packages/contract/src/preview.test.ts"
    ]
  },
  "originAgain": {
    "kept": 632,
    "keptWhole": 367,
    "keptReachingChildProcess": 306,
    "keptReachingOpaque": 310,
    "stale": null,
    "sample": [
      "api-client:packages/api-client/src/protocol/tool-display.test.ts",
      "api-client:packages/api-client/src/utils/project-scope.test.ts",
      "contract:packages/contract/src/attention.test.ts",
      "contract:packages/contract/src/automation-schedule.test.ts",
      "contract:packages/contract/src/preview.test.ts"
    ]
  }
}
(exit 0)
```

The comparison checkout is at `13351da86ed4e44bb89ad54c284ab0115dc82c6b`, matching the worker's measurement input. Its hidden lockfile is stale because `@fontsource/poppins` is unlisted. `mainLiteral` therefore keeps zero keys. `mainAsIs`, the deliberate research comparison that bypasses trust checking, reproduces **265 of 632**, with zero kept whole-fingerprint / child-process / opaque-load keys. All four environments remain scoped. There are 367 whole-fingerprint files: 310 through builtin or unnamed loads, and 57 more through package opacity.

Read: 23 ms. Warm keying: 28 ms. First keying: 1,877 ms, including 1,701 ms scanning 177 packages; all-package scan: 555 packages, 26 opaque, 2,049 ms. These are one heavily loaded host's observations, not a quiet-host startup benchmark. The warm-keying 300 ms budget fits this run; calm startup performance is unverified here.

## Verdict

**PASS at `015e38cd5866adade62f7f12a899aba0c8491bd2`.** Counts: **0 blockers, 3 should-fix notes, 1 nit**. All three original blocking proofs in `wave-11b.md` are closed. This is the bounded re-review that the brief requests, not a claim that every dependency-sensitive result now has a sound key. The three additional cases below each retain the complete check key through a result-changing bump. Under the re-review rule, additional cases are notes; they are not promoted to blockers.

**Are all prior items closed?** B1 to B3, S1 to S3, N1 and N3 are closed for their recorded scenarios. N2 is only partly closed: an ESM import of a types-only package's manifest keys its identity, but a literal `require` of the same manifest does not. N4's guard is implemented and its boundary test passes; actual optimized Vitest execution was not replayed here.

**Can a package bump that changes a result still keep a key?** Yes. Apart from the misses explicitly accepted in D3, this review proves a literal require of a types-only manifest (S1), a test dependency that is also in the exempt config-plugin closure (S2), and a package loaded by a relatively required project helper (S3). Each is `PASS -> FAIL` with an identical environment hash and complete check key. Nothing in the passing verdict establishes safety for those cases.

## Scope and prior-item closure

Task 001-110, re-review of 001-109, against `reviews/wave-11b.md`, D3 and D4 as amended, `tasks/wave-11.md`'s 001-109 brief and `tasks/001-105/notes.md`. The six landed commits are `e48ac92`, `5c6e029`, `5c6ab9b`, `6e2c5e1`, `02b29c1` and `b32ae76`, plus build `015e38c` (0.1.23). Interleaved 002/003 changes and 001-111/112 are outside this re-review. Prior review and lessons files are inputs, not reviewed changes.

| Prior item | Disposition | Evidence at this candidate |
| --- | --- | --- |
| B1, config environment / serializer / docblock | Closed for the proofs | Config environment and serializer bumps move the environment input; the docblock package moves its file's segment. Each changed run from pass to fail. `environmentPackages` includes the resolved environment, reporters and resolved serializer / runner / snapshot-environment / diff paths. |
| B2, bare require / require.resolve | Closed for the proofs | Literal `require("cjs-pkg")` reports `test>cjs-pkg` and re-keys when its code changes; `require.resolve("data-pkg/data.json")` reports builtin `module` and uses `whole:`. Both changed pass to fail. Computed `require` and `import.meta.resolve` also use `whole:` and re-key. See S1 and S3 for additional shapes. |
| B3, first-hop package spawning an undeclared child dependency | Closed for the proof | `spawner` reaches `child_process`; bumping only `child-pkg` moves its importer's whole-fingerprint key and changes pass to fail. `outer -> middle -> spawner` does the same, two declared dependency edges down. See S2 for the new exemption overlap. |
| S1, repeated stale-lockfile note after restart | Closed | `Lockfiles.#noteOnce` checks persisted notes only on this daemon's first read; the real scheduler restart test leaves one note, and passes. The persisted predicate is wired through `WorktreeKeys` to the same worktree's store. |
| S2, top-level side-load under a live daemon | Closed for the proof | `InstallStamps.takeChange` runs before tier selection; `refreshInstall` reads environments and settles moved keys under the scheduler lock. The real scheduler test adds a folder without rewriting the hidden lockfile, hands in an empty reconciliation batch, and gets a different key and another run. Nested additions remain an explicit D3 miss. |
| S3, fallback wording | Closed as documentation | D3 lists the builtin / unnamed-load / unowned-node_modules / opaque-package / missing-package-report cases and accepted misses. D4 names the added source scan. The config-plugin exemption is stated, not implicit. |
| N1, unknown closure returning an empty segment | Closed | `keying.ts:171` now calls the project's `DependencyKeys.of(undefined)` when no runner closure exists. With a scoped environment that returns the whole fingerprint. |
| N2, types-only manifest import | Partly closed | ESM `import manifest from "@types/probe/package.json"` reports `manifest: true`, moves the key and changes pass to fail. Literal require loses the subpath; S1 below. |
| N3, claim that @types re-keys no file | Closed | D3 now says "re-keys no file that keeps its own segment" and explicitly excepts manifest reads. Existing whole-fingerprint fixture assertions still move on that bump. |
| N4, optimized file under .vite dropped | Guard closed; optimized integration unverified | `closurePackages` reports builtin `module` for an installed path that belongs to no package. The test passes with `/w/node_modules/.vite/deps_ssr/ext.js`. An actual optimizer run is not evidence supplied by that test. |

## Probe evidence

The throwaway scripts lived outside tracked files; scratch projects were in the repository's ignored fixture `.tmp` directory and were removed. The scripts were deleted before the review commit. Product code was not changed.

Each result-changing phase used a fresh real Vitest adapter and an install written by the repository's `writeInstall` helper. The project test and config source were identical between phases. The package's version and contents changed from `1.0.0` / `one` to `1.0.1` / `two`. Fresh scratch roots avoid process-wide caches of externally imported config modules hiding a real result change. The keys come from `installedDependencies`, `dependencyKeys`, the real adapter's environment / closure, and, for the boundary cases below, `coreEnvironmentInputs`, `environmentHash` and `checkKey` with git-blob hashes of each input. No inherited-state plumbing was needed: identical complete keys and a different real outcome are enough to prove the collision.

| Probe | Before / after | Dependency key inputs | Disposition |
| --- | --- | --- | --- |
| Config `environment: "custom"`, bump its package | pass / fail | Environment changes | Original B1 closed |
| Docblock custom environment, bump its package | pass / fail | File segment changes | Original B1 closed |
| Config `snapshotSerializers: ["ser-pkg"]`, serializer output `one` then `two` against one inline snapshot | pass / fail | Environment changes | Original B1 closed |
| Literal `require("cjs-pkg")` | pass / fail | File segment changes | Original B2 closed |
| `require.resolve` + `readFileSync` of package JSON | pass / fail | `module`, `whole:` changes | Original B2 closed |
| `spawner`, undeclared package required by its child | pass / fail | Whole-fingerprint check key changes | Original B3 closed |
| `outer -> middle -> spawner`, same child-only bump | pass / fail | Whole-fingerprint check key changes | Requested transitive probe fits |
| Opaque config plugin imports `plugin-dep`; its transform substitutes the dependency's value into a test | pass / fail | Scoped environment changes | Exemption retains the plugin's dependency closure |
| `const pkg = "cjs-pkg"; require(pkg)` | pass / fail | `module`, `whole:` changes | Requested computed-load probe fits |
| `readFileSync(new URL(import.meta.resolve("data-pkg/data.json")))` | pass / fail | `module`, `whole:` changes | Requested resolution probe fits |
| ESM import of types-only manifest, assert its version | pass / fail | File segment and full key change | N2's ESM shape fits |
| Literal require of that manifest | pass / fail | Same complete check key | S1 |
| `outer -> middle -> spawner` also reached by the config plugin's declared dependency closure | pass / fail | Same complete check key | S2 |
| `require("./helper.cjs")`; helper requires `cjs-pkg` | pass / fail | Same complete check key | S3 |

The first spawner experiment accidentally let its child inherit the review process's cwd, so both phases failed to resolve `child-pkg`. That run proves nothing about a result flip. The corrected experiment sets the child's cwd to the scratch root, as an ordinary spawning package can, and observes pass / fail with the key results above.

**Same-version reinstall / cache.** Reuse one `PackageScans` across `installedDependencies` reads at the same root. Initially `cache-pkg@1.0.0` contains plain ESM. Replace it with code importing `node:child_process`, keep version 1.0.0, and change only that entry's integrity to represent the different bytes. Before: scoped segment `33557d5fcf49827124545ddda63c992eface6cf70d87c39b756f531df9b83601`. After: `whole:618dc30f6fcd8754c8e36eddea025cfd552cef9e7f95b493384b477599b18544`. Opaque scans increase from 1 to 2. Integrity is part of the cache key; the old nonopaque answer is not reused. Changing package contents without changing its trusted lockfile identity is not the integrity probe, and is not settled here.

## Blockers

None under the bounded re-review rule. The original three blocking proofs are now discriminating passing cases. The notes below are not an assertion that their stale-key escapes are harmless.

## Should-fix notes

### S1. N2 remains open for a literal require of a types-only manifest (proven; nonblocking)

`src/runners/vitest/graph.ts:138` and `src/runners/vitest/packages.ts:47`.

D3: "unless a project file imports the package's own `package.json`, which keys its version". `sourceLoads` finds `require("@types/probe/package.json")`, but `importTargets.add` turns it into just `@types/probe`. `closurePackages` then has no subpath with which to set `manifest: true`. `InstalledGraph` treats the package as types-only and uses its constant instead of its installed identity.

The test is:

```ts
import { expect, it } from "vitest";
it("version", () => expect(require("@types/probe/package.json").version).toBe("1.0.0"));
```

The package contains only its manifest and `index.d.ts`. Bump it to 1.0.1. Both phases complete; the outcome is pass then fail. Both complete check keys are `aa504ae2234afc4d9c6c9a5a155230af0596032e9e4ebaacdbf0fa9e7f3deae4`. The closure reports `{ from: "test", name: "@types/probe" }` without `manifest`.

**One-worker fix.** Preserve the manifest-read flag or the original subpath through the bare-require seam. Apply it when building `PackageImport`, including config-file requires. Add a real adapter fixture test that bumps a types-only manifest loaded through `require` and asserts both a changed key and the pass-to-fail flip. The existing direct `PackageImport` unit test alone cannot discriminate this loss at the caller.

### S2. A shared opaque identity is exempt even when a test calls it (proven; new nonblocking note)

`src/core/keys/dependencies.ts:52`.

D3's test fallback: "its package set holds an opaque package". The config exemption's reason is that "the runner and the config's plugins drive the run in Vitest's process and no test file imports them". The implementation computes a test's identities **minus every environment identity before checking opacity**. That erases an opaque dependency reached both by a config plugin and by a test.

Install these declared edges:

```text
config -> plugin-pkg -> spawner
 test  -> outer -> middle -> spawner
```

`plugin-pkg` also has an ordinary declared `plugin-dep`, and does not call `spawner`. `spawner` exports `actual()`, which runs Node with the project root as cwd and `process.stdout.write(require('child-pkg'))`. Only the test calls `actual()`. `child-pkg` is intentionally not declared by `spawner`, the reason B3 needs the whole fingerprint. Bump only `child-pkg` from exporting `one` to `two`; the test expects `one`.

Both phases complete, pass then fail. Both complete keys are `5e41412ca1ba6a6f66b07403478be25105945e255dc19d2b08fbd46ec0910bfb`. The environment is scoped; the test reports `outer` and no opaque builtin. The config plugin's closure still enters the environment hash, as the accepted exemption requires, but the exclusion hides the test's separate call into that opaque closure. This is different from the accepted miss in which the runner or config plugin itself starts an undeclared package in a child.

**One-worker fix.** Determine test opacity on its complete package identities, before removing environment identities from the segment. Keep the runner/config exemption when deciding whether the *environment* is whole. For segment construction, subtract shared identities only after a nonopaque test closure is established. Add this overlap fixture and the existing plugin-only fixture: a plugin-only project should retain scoped keys, while an actual test user of the shared spawning package should use `whole:`. Re-measure the `cezar` share, since this narrower exemption may reduce it.

### S3. A relatively required project helper hides its package dependency (proven; new nonblocking note)

`src/runners/vitest/graph.ts:150`.

001-109's outcome: "no package bump that can change a test's result leaves its key in place". D4 reports "the targets of literal `require` calls found by a scan of each project file's source". The new scan sends every literal require through `add`, which accepts bare package names and builtins only. `require("./helper.cjs")` is neither. It neither adds the helper as a graph target nor marks the load opaque.

```ts
// test/probe.test.ts
import { expect, it } from "vitest";
it("value", () => expect(require("./helper.cjs").value).toBe("one"));
```

```js
// test/helper.cjs
exports.value = require("cjs-pkg").value;
```

`cjs-pkg` changes its exported value from `one` to `two` with its bump. Both complete keys are `a84606e0aa85274cf05ae5f091ce28d65ff4e853dfdd3facc2c686e8c6282fbd`, with pass then fail. The adapter reports no package and its closure includes only the test and snapshot path, not `helper.cjs`. This requires no undeclared in-process dependency of an installed package. The helper is a project file. Worker notes acknowledge the relative-require closure gap, but D3's accepted-miss sentence does not name it.

**One-worker fix.** Prefer resolving relative literal requires into graph targets with their missing-path candidates and scanning the reached project files. A smaller conservative repair can report `module` for a literal relative require, keeping the whole fingerprint so this package-bump escape closes; that alone does not cover a later edit of the helper's contents, so state that separate limitation. Add a real helper fixture and assert the bump changes the key and result. Fold the chosen behavior into D3/D4.

## Nits

### N1. Starting HEAD was not the named candidate (proven; nonblocking)

`docs/board.md:210` at starting commit `e91d1b3`; the corresponding task brief was also updated there. The task named build `015e38c`, but the worktree initially held `e91d1b3470bd8b94a4604384441f24f4039d1e7a`. The delta was only `docs/board.md` and `tasks/wave-11.md`, including this running review. I detached at exact build `015e38c` before `npm ci`, all checks and all probes. No evidence from the initial commit is used to claim verification of the candidate. **Fix size:** coordinator dispatch metadata only; no product repair.

## What fits

The next wave need not repeat:

- The original environment, docblock, serializer, bare-require, resolve-plus-fs and direct-spawner proofs.
- A distinct spawning package two dependency levels down is scanned through its lockfile closure and sends the importer to the whole fingerprint.
- The accepted plugin exemption leaves all of the plugin's *declared* dependency identities in the scoped environment hash. A real transform driven by a changed plugin dependency re-keys and changes the run's outcome.
- A source-level computed require and `import.meta.resolve` report `module`; their consumers use the whole fingerprint.
- The scan cache differentiates a same-version reinstall by integrity, with an additional scan and a changed segment. Its identity also includes the installation root, so another install cannot supply a cached scan of the same location/version/integrity at this root.
- Stale-note restart deduplication, top-level install-stamp refresh, the unknown-closure fail-safe, and the unowned-node_modules boundary guard have the implemented callers and passing repair tests.
- The fresh-clone `cezar` share is 265/632, with no kept whole-fingerprint or opaque-load file. Literal trust checking rejects the comparison checkout's stale hidden lockfile and keeps zero instead. The measurements distinguish those two claims.

## Inputs for the next wave or human decision

No mandatory fix wave is dispatched by this verdict. The brief says this is the last 001-105 repair round and blockers go to the human. There are no repeated blockers. The coordinator should surface S1 to S3 as the concrete remaining answer to the key-soundness question, and decide whether to repair them or explicitly accept them. Neither the review nor the passing tests accept these new misses on the human's behalf.

The interfaces a follow-up must preserve:

1. The Vitest adapter supplies `RunnerPackages` before core key construction. `PackageImport.from` is worktree-relative, the importer's directory for a bare name and the directory holding `node_modules` for a resolved entry. Do not discard a manifest subpath before its `manifest` flag reaches `InstalledGraph.identities`.
2. `Lockfiles.set` reads installed metadata with the daemon-owned `PackageScans`, then constructs `dependencyKeys`. Preserve the install-root + location/version/integrity cache identity and the opaque-on-unreadable rule. A version-preserving integrity change must scan again.
3. `DependencyKeys` hashes every declared runner/plugin environment identity regardless of opacity exemption. When determining a test's opacity, S2 needs its complete identity set; the set difference is for encoding a nonopaque segment, not for deciding whether its test can spawn.
4. Before selecting a tier, `InstallStamps.check` / `takeChange` precede `refreshInstall` under the scheduler lock, then selection runs again. Keep the top-level side-load and restarted-note proofs green. Nested folder additions without a lockfile rewrite remain accepted until a separate decision changes D3.
5. Re-measure with the existing script and the same `c7fa7178` / `13351da8` comparison installs. Report the kept share even if below 265. The warm-keying budget is 300 ms; this run's 28 ms fits. Cold scanning is a distinct startup cost; this heavily loaded run measured 1.877 s, not a new warm-budget failure.

Still outside this slice: node:test package reports (003-22), pnpm/Yarn per-package graphs, persisted scans across daemon restarts, and macOS verification. This review does not re-prosecute prior settled architecture or those unfinished rows.
