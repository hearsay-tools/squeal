# 003 wave 2.6 third review (003-29)

## Verdict

**FAIL dd4be01**. One proven blocker, one proven should-fix, no new nits. Wave 2.5 B1 is closed for ordinary argv `--require`, nested and package require preloads, and ordinary `NODE_OPTIONS`. It remains for quoted option names in `NODE_OPTIONS`: their computed dependencies are still unobserved and a stale pass remains current and inherits. The earlier recorder also introduces a Node 22 async-loader regression (S1).

Reviewed `647f6ce^..e9e36d2`: the 003-28 repair, integration test, runtime-copy fixes and 0.1.28 bundles. Candidate HEAD is `dd4be01a04285c482e31917e362f3bdaa320f145`; `e9e36d2..HEAD` changes only board, spec, status and brief documentation. Product and bundle content match the named endpoint. Prior wave 2.5 conclusions outside the preload slice were not re-prosecuted.

## Verification output

Commands ran at the clean candidate before this report was added. `npm run build` left tracked files unchanged. The task and reviewer gate explicitly require Vitest runs; no command read or wrote this repository's Squeal store. All independent probes, fixtures, logs and stores were under `/tmp/squeal-review-003-29-ibtm2n`, removed before committing. No cezar repository was accessed. Only the two daemons started by the shipped-plugin probe were stopped.

```text
$ git rev-parse HEAD
dd4be01a04285c482e31917e362f3bdaa320f145
$ node --version
v24.21.0
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
> squeal@0.1.28 lint
> biome check .
Checked 513 files in 157ms. No fixes applied.
$ npm run typecheck
> squeal@0.1.28 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.28 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.28 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(empty)
$ npx vitest run
 Test Files  192 passed | 1 skipped (193)
      Tests  1598 passed | 10 skipped (1608)
   Duration  77.40s (tests 96%, transform 3%, import 1%)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run \
    test/runners/node-test test/integration/node-test.test.ts --maxWorkers=2
 Test Files  22 passed (22)
      Tests  121 passed (121)
   Duration  21.66s (tests 96%, transform 2%, import 1%)
```

The full suite printed two `repair: gitdir incorrect` messages from its temporary scheduler fixtures; it exited 0. Node 22 printed `UNDICI-EHPA` experimental warnings. Node 22 full-suite green is unverified; the scoped runner/integration gate and independent preload probes ran on both supported versions. No full-suite retry was run.

After the report was drafted, Squeal delivered a separate baseline result at revision 0: `1801 current, 0 pending`, a completed full-suite checkpoint, and one known failure outside this slice: `test/watcher/reconcile-pass.test.ts:72`, "re-stats 10,000 tracked paths within the budget", `expected 528 to be less than 500`. That background run is not green; the manually required full-suite run above exited 0. The failing assertion is outside the reviewed range and is not a finding against this slice. Its first diagnostic is sufficient to identify the timing bound, so no `squeal why` or status command accessed the forbidden repository store.

## Blockers

### B1. Quoted `NODE_OPTIONS` require flags bypass the recorder ordering guard (proven)

Location: `src/runners/node-test/run/run.ts:163-169`, specifically the regular expression at line 167. Node tokenizes double quotes in `NODE_OPTIONS`, so `"--require" ./scripts/setup.cjs` and `"--require=./scripts/setup.cjs"` are valid require options on Node 22.23.3 and 24.21.0. The guard recognizes only an unquoted `--require` or `-r` followed by whitespace or `=`. It therefore does not prepend the recorder for either valid quoted form. The project's preload runs before the command-line recorder, reproducing the prior B1 ordering failure.

D5 explicitly says that when `NODE_OPTIONS` holds a `--require`, "the recorder is prepended there too". Goal 5 requires missed observed paths to enter keys, block inheritance when content differs, and schedule the file when changed. Vision principle 2 forbids an old result posing as current.

Minimal fixture:

```js
// project argv: []
// project env: { NODE_OPTIONS: '"--require" ./scripts/setup.cjs' }
// scripts/setup.cjs
require('./helper' + '.cjs');
// scripts/helper.cjs
globalThis.value = 1;
// test/a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('value', () => assert.equal(globalThis.value, 1));
```

Independent runner probes used the committed Claude Code plugin's recorder and reporter. Adapter probes checked the resulting environment, closure, affected set and hashes. Both quoted forms produced the same result on both Node versions:

```text
run: completed; named test: pass
observed.preloadPaths: []
environment.files: []
closure.paths: ["test/a.test.mjs"]
affected(["scripts/helper.cjs"]): {"direct":[],"transitive":[]}
environment hash before/after helper edit: equal
notes: []
```

One shipped-plugin proof ran two real daemons over a temporary repository's shared store. It included six projects: ordinary require, nested require, package require, ordinary environment require, quoted environment require and import. After their baseline, all six helpers changed from value 1 to value 2; then a second worktree started with those changed helpers:

```text
baseline: revision=0; current=12; pending=0; stale=0; unknown=0; failures=[]
observedPreloads.quoted: null
helper edits: revision=1; current=12; pending=0; stale=0; unknown=0
  failures=[env,import,nested,package,plain]
  new runs contain those five projects; quoted has no new run
second worktree: revision=0; current=12; inherited.count=12; runs=0
  failures=[env,import,nested,package,plain]
  quoted still inherits its original pass with helper value 2
```

The controls acquire the helper paths and retain their correctly failing results; the quoted project alone keeps its stale pass. This is a remaining shape of the prior blocking preload observation issue, not a new unrelated prosecution.

One-worker repair: tokenize `NODE_OPTIONS` with Node's quoting rules before deciding whether a require exists, or prepend the recorder whenever the variable is present without altering the project's options. Add both quoted forms to the Node 22/24 regression coverage, including observation, helper edit and an inheritance miss. Preserve the existing space/quote handling for the recorder path. Invalidate results stored under these incomplete semantics, as adapter version 3 did for version 2. Take this remaining blocker to the human; this review does not authorize another automatic fix/review round.

## Should-fix

### S1. The first-require recorder breaks an async `--loader` on Node 22 (proven)

Locations: `src/runners/node-test/run/run.ts:77-85` and `src/runners/node-test/runtime/recorder.cjs:17-19`. Installing the synchronous resolve hook before Node initializes its async loader makes Node 22.23.3 call the unimplemented `Hooks.resolveSync()` path. A healthy test process exits 7 before a complete report. `runNodeTest` correctly returns `crashed` with no completed files or results, so this does not create a stale current pass. It is a should-fix regression in the brief's explicit loader/compatibility question. D3 permits an unrecognized loader with Node's resolution rules and a note; goal 7 requires the project's loader chain to run.

The smallest discriminating fixture has an identity loader, with no helper imports or transformed source:

```js
// loader.mjs
export async function resolve(specifier, context, nextResolve) {
  return nextResolve(specifier, context);
}
// a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('one', () => assert.equal(1, 1));
```

Run the project's Node with `[recorder flags] --loader ./loader.mjs --test`, the shipped reporter and an explicit reporter destination. Set `SQUEAL_NODE_TEST_GRAPH` to a private temporary prefix. Controls used the previous recorder extracted from `647f6ce^` and the committed candidate recorder:

| Node | Recorder flags | Exit | Named result |
| --- | --- | --- | --- |
| 22.23.3 | none | 0 | pass |
| 22.23.3 | `--import <old-recorder.mjs>` | 0 | pass |
| 22.23.3 | `--require <candidate-recorder.cjs>` | 7 | no report |
| 24.21.0 | none | 0 | pass |
| 24.21.0 | `--import <old-recorder.mjs>` | 0 | pass |
| 24.21.0 | `--require <candidate-recorder.cjs>` | 0 | pass |

The candidate's Node 22 stderr includes:

```text
Error [ERR_METHOD_NOT_IMPLEMENTED]: The resolveSync() method is not implemented
    at Hooks.resolveSync (node:internal/modules/esm/hooks:323:11)
    at #resolveAndMaybeBlockOnLoaderThread (node:internal/modules/esm/loader:781:35)
    at nextStep (node:internal/modules/customization_hooks:189:26)
    at resolve (<plugin>/dist/node-test/recorder.cjs:19:24)
```

A transforming loader with a computed helper import gave the same Node 22 crash and passed on Node 24. The identity control rules out that transformation as the cause. One-worker repair: add this Node 22/24 identity-loader control to runtime tests and make recorder installation compatible with async-loader initialization while preserving observation before require preloads. Do not silently remove the project's loader or the recorder; keep failure honest if the combination cannot be supported.

## Nits

None new. The prior review's union-only observation retention and unproven later graph-exception notes were not reopened by this delta.

## What fits

### Ordinary preload observation and shipping (proven)

Independent probes on Node 22.23.3 and 24.21.0 observed and keyed helpers loaded by ordinary argv `--require`, a required nested preload, a required package under `node_modules`, `NODE_OPTIONS` with `--require`, `--require=`, or `-r`, and an environment `--import`. Each helper appeared in `environment().files`, its content changed the environment hash, and `affected` named the project's test file. The shipped-plugin proof confirms helper edits run the five healthy control projects; the existing integration test confirms a worktree with different require-helper content misses and an unchanged worktree inherits with zero runs.

The per-file test child records its own graph. The new runtime tests cover argv order and a recorder path containing spaces and a double quote. The clean build and plugin tests establish that both plugins ship `recorder.cjs` and `reporter.mjs`, with the removed `recorder.mjs` absent. Runtime directory replacement fixes the stale-copy problem.

### Version 3 is conservative, not selective (proven by source and controlled hashes)

`NODE_TEST_ADAPTER_VERSION` is `"3"`, appears in each project environment and enters `environmentHash`. Holding core inputs and files constant, version-2 and version-3 environment hashes differed in every matrix case. This re-keys every node:test project, including projects with no require preloads; it does not selectively migrate only formerly unobserved passes. Version-3 hashes with equal inputs remain stable. The version field changes no Vitest adapter semantics; the release's Squeal version is separately an environment input for all runners. The bump correctly prevents old version-2 keys matching, but cannot repair B1's still-missed observation.

### Recorder cost and resolution (proven for the probe; universal compatibility disproven by S1)

A fresh process loaded 500 ESM and 500 CommonJS modules, five alternating runs with and without the committed recorder on each Node version. Both modes produced the same sum, `249500`; the recorder wrote 1,002 unique edge lines. Measured medians:

| Node | No recorder | With recorder | Added time |
| --- | --- | --- | --- |
| 22.23.3 | 176.14 ms | 202.82 ms | 26.68 ms |
| 24.21.0 | 173.24 ms | 194.07 ms | 20.83 ms |

Host load was about 5.5. These are process-wall measurements, including startup, not an enforced budget or a comparison against the prior recorder. The hook returns `nextResolve`'s result without rewriting its URL or conditions. The 1,000-module probe and existing tsx, graph and runtime tests demonstrate ordinary resolution compatibility, not compatibility with every custom hook. S1 disproves a blanket "never changes project resolution" claim.

### Explicit boundaries remain

A preload spawning Node with a fresh environment and no recorder does not expose that child's helper to observation or keys on either version. Child processes and filesystem reads already require declared `inputs` under D3 and the accepted spawn boundary; this is not a new finding. A custom `--loader` is explicitly unrecognized and noted under D3. The transforming-loader probe on Node 24 observes its computed helper, but the loader entry itself is not a static preload root; it must not be treated as complete loader-dependency coverage. No broader custom-loader guarantee was established.

The no-local-edit observation-growth case remains row 003-26 and is unchanged. This review does not repeat the already settled two-daemon observation merge or project isolation checks.

## Inputs for the coordinator

1. Send B1 to the human as the remaining blocker after the authorized third round. The normal require repair works, but "every `NODE_OPTIONS` require is observed" is still false.
2. S1 fits one runtime/runner worker with a Node 22 async-loader regression. Preserve require-preload observation and the project's argv meaning when repairing it.
3. Keep the existing ordinary require, nested, package and mixed-runner integration coverage. Add quoted option names; testing only a quoted recorder path does not test a quoted option name.
4. Keep 003-26 and the declared-input/custom-loader boundaries explicit in the proof and dogfooding briefs. The green repository gates do not cover B1 or S1's adversarial cases.
