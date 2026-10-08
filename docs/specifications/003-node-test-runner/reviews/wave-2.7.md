# 003 wave 2.7 fourth review (003-31)

## Verdict

**PASS dc55714**. No blockers, one proven should-fix, no new nits. `reviews/wave-2.6.md` B1 and S1 are closed: quoted `NODE_OPTIONS` requires are observed and keyed, and identity and transforming async loaders run on Node 22 and 24. The remaining should-fix concerns the warning for the accepted loader-thread observation boundary, not a demand to model arbitrary custom loaders.

Reviewed `bfccdff^..2cafe6f`, the 003-30 repairs, adapter version 4, Codex command flag and 0.1.30 bundles. Candidate HEAD is `dc55714b7653b06860939511f9cbbf9685a4e7df`, rather than the brief's endpoint `2cafe6f`. `2cafe6f..HEAD` changes only board, spec, status and task documentation; product and bundle content match. This is a bounded re-review of the preload slice. Previously settled project isolation, observation merge, reconciliation and recorder cost conclusions were not re-prosecuted.

## Verification output

Commands ran at the clean candidate before this report was written. `npm run build` left tracked files unchanged. The repository and reviewer gates require the manual Vitest run. No command queried this repository's Squeal store or accessed `/home/agent/projects/cezar`.

All independent probes, logs and fixtures were under `/tmp/squeal-review-003-31-WYtfM1`. The required repository tests also create and remove their own fixture directories. No independent daemon was started. The review's scratch directory was removed before committing; no process or directory belonging to another run was killed or deleted.

```text
$ git rev-parse HEAD
dc55714b7653b06860939511f9cbbf9685a4e7df
$ node --version
v24.21.0
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
(exit 0)
$ npm run lint
> squeal@0.1.30 lint
> biome check .
Checked 519 files in 134ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.30 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.30 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.30 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --porcelain
(empty)
$ TMPDIR=/tmp/squeal-review-003-31-WYtfM1 npx vitest run
 Test Files  196 passed | 1 skipped (197)
      Tests  1642 passed | 10 skipped (1652)
   Duration  94.21s (tests 96%, transform 3%, import 2%)
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH \
    TMPDIR=/tmp/squeal-review-003-31-WYtfM1 npx vitest run \
    test/runners/node-test test/integration/node-test.test.ts --maxWorkers=2
 Test Files  25 passed (25)
      Tests  156 passed (156)
   Duration  57.62s (tests 95%, transform 3%, import 2%)
(exit 0)
```

The full suite printed two `repair: gitdir incorrect` messages from temporary scheduler fixtures. Node 22 printed `UNDICI-EHPA` experimental warnings. Both commands exited 0. The full suite was run once on Node 24; Node 22 full-suite green is **unverified**. Its complete node:test runner directory, integration gate and independent probes were verified. No full-suite retry was run.

Independent probes ran through the installed tsx loader, once with each executable:

```text
$ <node-22.23.3-or-24.21.0> --disable-warning=ExperimentalWarning \
    --import ./node_modules/tsx/dist/loader.mjs <scratch>/probe.mjs
Node 22.23.3: 14/14 plain controls exited 0;
             14/14 shipped-runtime runs and adapter runs completed with pass
Node 24.21.0: 14/14 plain controls exited 0;
             14/14 shipped-runtime runs and adapter runs completed with pass
(exit 0 on both)
$ <node-22.23.3-or-24.21.0> --disable-warning=ExperimentalWarning \
    --import ./node_modules/tsx/dist/loader.mjs <scratch>/loader-loss.mjs
module.register through argv --import: completed/pass on both; generic hook note only
module.register through NODE_OPTIONS --import: completed/pass on both; notes=[]
loader helper absent from environment and test closure; affected(helper)=[]
(exit 0 on both)
$ <node-22.23.3-or-24.21.0> --disable-warning=ExperimentalWarning \
    --import ./node_modules/tsx/dist/loader.mjs <scratch>/version-worker.mjs
Node 22.23.3: adapterVersion=4; oldKeyDiffers=true; repeatStable=true
             workerExit=0; workerValue=1; userWorkerHelperRecorded=true
Node 24.21.0: adapterVersion=4; oldKeyDiffers=true; repeatStable=true
             workerExit=0; workerValue=1; userWorkerHelperRecorded=true
(exit 0 on both)
```

The shipped-runtime probes passed the committed Claude Code plugin's recorder and reporter explicitly to `runNodeTest`. All four `cmp` checks between the source runtime files and the two plugins' copies exited 0. Adapter probes used the source adapter over temporary fixtures and an in-memory observed-store implementation; they opened no repository store. Cross-worktree checks compared production `environmentHash` values for otherwise identical fixture directories with a shared observed set, not two running daemons.

## Blockers

None. The two findings named by the brief are closed in the exercised shapes. No additional recorder-induced crash was found in the loader matrix on either supported version.

## Should-fix

### S1. Programmatically registered loaders miss the loader-thread uncertainty warning (proven)

Location: `src/runners/node-test/adapter-project.ts:150-165`, particularly the flag-only list at lines 158-160, and `runtime/recorder.cjs:22`. The new recorder deliberately skips internal loader threads. The new diagnostic identifies only `--loader` and `--experimental-loader` tokens. A loader installed with `module.register()` from a project preload has the same observation boundary, but does not get its warning. An argv preload importing `node:module` gets the older generic “may register module hooks; resolving with Node's own rules” note, which does not explain the unobserved inputs. A registration preload from `NODE_OPTIONS --import` gets no note at all in this probe.

The 003-30 outcome requires “whatever Squeal cannot observe said in a note”. Vision principles 2 and 7 require honest provenance and evidence. D5 now accepts the loader-thread blind spot and calls for a project note; D3 already treats custom loaders as unrecognized. This is a non-blocking diagnostic gap within that accepted boundary, not a newly asserted custom-loader coverage contract. The static graph's generic programmatic-hook warning predates this range; this finding concerns the new fallback warning's missing equivalent entry paths.

Minimal fixture, valid on both Node versions:

```js
// argv: ["--import", "./register.mjs"]
// or argv: [], env: { NODE_OPTIONS: "--import ./register.mjs" }
// register.mjs
import { register } from 'node:module';
register('./loader.mjs', import.meta.url);
// loader.mjs
const { value } = await import('./helper' + '.mjs');
export async function load(url, context, nextLoad) {
  const loaded = await nextLoad(url, context);
  return url.endsWith('.test.mjs')
    ? { ...loaded, source: String(loaded.source).replace('__VALUE__', String(value)) }
    : loaded;
}
// helper.mjs
export const value = 1;
// a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
test('value', () => assert.equal(__VALUE__, 1));
```

The value replacement proves that the loader and its computed dependency executed. Results on Node 22.23.3 and 24.21.0 were identical:

```text
argv registration:
  run=completed; named outcome=pass
  observed.preloadPaths=[register.mjs]
  environment.files=[package.json,register.mjs]
  notes=[preload "register.mjs" imports node:module and may register module hooks;
         resolving with Node's own rules]
NODE_OPTIONS registration:
  run=completed; named outcome=pass
  observed.preloadPaths=[register.mjs]
  environment.files=[register.mjs]
  notes=[]
both:
  static test closure.complete=true; static preload closure.complete=true
  helper absent from every returned environment/closure
  affected([helper.mjs])={direct:[],transitive:[]}
```

The separate adapter matrix changed the helper to `value = 2`: the environment hash stayed equal, another fixture with that helper matched the baseline environment hash, and an explicitly requested run failed. These are adapter/hash checks; this review does not claim a new two-daemon end-to-end proof. An explicit `--loader` control has the same missing dependency but correctly says that loader-thread inputs enter no key and must be declared.

One-worker repair: extend the existing conservative programmatic-hook diagnostic to state the loader-thread observation limit and `inputs` remedy. Apply equivalent detection to `NODE_OPTIONS` import/require preloads, including the inherited value, so a registration preload cannot silently avoid it. Exact static recognition of arbitrary `register()` calls is unnecessary; a conservative warning on preloads importing `node:module` is consistent with the existing graph note. Add argv and environment registration regressions on Node 22 and 24 that assert the warning while preserving successful loader execution and require-helper observation. Keep the accepted custom-loader boundary explicit; do not promise full observation as the diagnostic fix.

## Nits

None new. Observation retention, other-worktree reconciliation without a local edit (003-26), declared child-process inputs and prior cost conclusions are unchanged by this range.

## What fits

### Prior B1: quoted require ordering, observation and keys (proven)

Both exact prior probes, `"--require" ./scripts/setup.cjs` and `"--require=./scripts/setup.cjs"`, passed with the shipped runtime on both Node versions. The preload computed `require('./helper' + '.cjs')`. Its setup and helper appeared in `observed.preloadPaths` and the adapter's environment. Changing the helper changed the environment hash, `affected` selected the test file, a different-helper fixture missed that environment hash, and the explicitly requested rerun failed as expected.

The same conclusions held for five additional accepted spellings: `--re"quire"`, an empty quoted prefix before `--require`, quoted `"-r"`, an escaped character in a quoted option name, and a quoted preload value. Ordinary spaces and quoted fragments behave as the tokenizer comment specifies. Negative controls `-r./setup.cjs`, `-r=./setup.cjs`, `--requ ./setup.cjs` and a tab between the require name and value were rejected by both Nodes with exit 9; those rejected forms are not remaining valid preload escapes. The malformed-token fallback is covered by the repository's tokenizer tests.

### Prior S1: loader compatibility and honest flagged fallback (proven)

Plain controls and shipped-runtime runs completed with a named pass on both versions for an identity `--loader`, argv `--experimental-loader=`, a transforming loader, a quoted `NODE_OPTIONS --experimental-loader=` beside a quoted require preload, and `module.register` from an import preload. Transforming tests contained `__VALUE__`, so a pass establishes that the project's loader actually ran; no loader was removed. Require-preload helpers remained observed, affected the file and changed its environment hash in all of these mixed cases.

Flagged async loaders emit the explicit loader-thread limitation once per loader through the project's once-only note set. A computed helper used by the loader itself remains unobserved on both Nodes, as the amended D5 boundary says; declare it in `inputs`. The programmatic-registration warning exception is S1 above. A separate user `Worker` control loaded its helper successfully and the shipped Codex recorder recorded the helper on both versions: the skip is limited to internal threads.

### Shipping and version 4 (proven)

The build left the tree clean. Recorder and reporter copies in both committed plugins equal their sources. Holding core inputs and project configuration fixed, changing only adapter version 3 to 4 changed the production environment hash on both Nodes; repeating the version-4 hash was stable. The bump invalidates all node:test version-3 environments conservatively, including projects without require preloads. It is not a selective migration of only formerly missed quoted-preload results. The Codex command flag and bundle tests passed in the full Node 24 gate.

## Inputs for the coordinator

1. The prior B1 and S1 need no further repair based on this review. Preserve the quoted-option and mixed-loader regressions through the proof wave.
2. Fold this review's S1 warning repair into one worker row. Keep successful project loader execution, argv order and before-preload observation; the fix can be diagnostic and need not broaden the custom-loader contract.
3. Proof and dogfooding must declare inputs used only inside custom loader threads, whether registered by flags or programmatically, and inputs used by child processes or filesystem reads. Green gates do not establish coverage of those excluded inputs.
4. Keep 003-26's accepted no-local-edit observation-growth limitation separate. This range did not change or re-prove it. The next proof wave should use the shipped plugins; this review's additional key-miss checks were at the adapter/environment boundary, not a replacement for that end-to-end proof.
