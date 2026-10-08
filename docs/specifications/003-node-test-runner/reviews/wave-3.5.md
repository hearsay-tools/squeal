# 003 wave 3.5 re-review (003-34)

## Verdict

**PASS e202b50**. No blockers, no should-fix findings, no nits. `reviews/wave-3.md` B1 and B2 are closed for every previously blocking form exercised on Node 22.23.3 and 24.21.0. This is the bounded second review of 003-33, not a claim that the full repository suite is green.

Reviewed `ee9d137^..2ec5dec`: the package identity and opaque-load repair, adapter version 6, and both committed 0.1.40 plugin bundles. Assigned HEAD was `e202b50885deeae0b2abeb81d0906b0dd331d10e`. Four later documentation commits explain the difference from the named range endpoint; `git diff --exit-code 2ec5dec HEAD -- src test plugins package.json package-lock.json` returned empty output and exit 0. Verification used an independent clone of that exact HEAD.

## Verification output

The clone, independent fixtures, scripts and their private stores lived under the owned scratch directory `/tmp/sq-review-003-34-S6wUkR`. No command read this repository's Squeal store or accessed `/home/agent/projects/cezar`. Product code in the assigned worktree was unchanged. Both builds reproduced the committed bundles without tracked changes. The repository's existing tests use their own temporary runtime directories and shared e2e install cache; no unrelated directory or process was removed or killed.

```text
$ git rev-parse HEAD
e202b50885deeae0b2abeb81d0906b0dd331d10e
$ node --version
v24.21.0
$ npm ci
added 56 packages, and audited 57 packages in 22s
18 packages are looking for funding
found 0 vulnerabilities
(exit 0)
$ npm run lint
> squeal@0.1.40 lint
> biome check .
Checked 566 files in 2s. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.40 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.40 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.40 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --short
(empty)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH node --version
v22.23.3
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run lint
> squeal@0.1.40 lint
> biome check .
Checked 566 files in 339ms. No fixes applied.
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run typecheck
> squeal@0.1.40 typecheck
> tsc --noEmit
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run build
> squeal@0.1.40 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.40 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git diff --exit-code -- plugins
(empty, exit 0)
```

npm printed install-script approval warnings for the existing esbuild and Parcel dependencies. Node 22 printed `UNDICI-EHPA` and SQLite experimental warnings. These did not change the successful gate exits.

### Broader tests: unverified completion

The following commands were started in the clone with inherited `NODE_OPTIONS` and `SQUEAL_OBSERVE` removed, and `TMPDIR` set to the owned scratch directory:

```text
$ PATH=/home/agent/.nvm/versions/node/v24.21.0/bin:$PATH npx vitest run --maxWorkers=2
 RUN  v5.0.3 /tmp/sq-review-003-34-S6wUkR/verify
 ❯ test/cli/codex.test.ts (13 tests | 1 failed) 9411ms
   ❯ squeal init --harness codex (6)
     × touches nothing under a scratch HOME/.codex or CODEX_HOME, run as the CLI 6057ms
(partial output; no completed-suite exit recorded)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run \
    test/runners/node-test test/integration/node-test.test.ts \
    test/integration/node-test-packages.test.ts test/e2e --maxWorkers=2
 RUN  v5.0.3 /tmp/sq-review-003-34-S6wUkR/verify
(partial output and experimental warnings; no completed-slice exit recorded)
```

Neither command's completed result was collected before two connection resets interrupted the reviewer. Host load samples were 91 and 74. The coordinator then explicitly instructed the reviewer to write the findings from the existing evidence, commit, and stop without further verification. Node 24 full-suite green, Node 22 slice green, and Node 22 full-suite green are **unverified**. The observed CLI failure is outside the candidate's changed files; no cause or regression is inferred from its partial output. These limitations do not become blockers under the review rules.

### External handoff probe: correct the extraction before trusting it

The original `/home/agent/squeal-defect-handoff/reproduce.mjs` was read and left unchanged. Running it on Node 24 against the clone exited 0 and reported six changed keys, but every closure was incomplete and reported only `module`. Its bare-import control's reason was:

```text
bare.mjs does not parse as a module: parse is not a function or its return value is not iterable
```

The bundle has a non-lexer `parse` at `plugins/claude-code/dist/cli/squeal.mjs:378`; its actual lexer is `parse2` at line 10584. Exporting `parse` makes this probe exercise the parser-error whole-fingerprint fallback. That apparent success is not evidence of this repair.

A scratch copy changed only the bundle export to `export {init,parse2 as parse};` and added a guard after `parserReady`: `parseModule('import { value } from "ext";', 'control.mjs')` must report `ext`, no incomplete reason, and `unnamed: false`. The guard passed on both Nodes. The corrected script used the production graph, trusted hidden lockfile, `installedDependencies`, `dependencyKeys`, `environmentHash` and `checkKey`, and direct Node test processes:

```text
$ <node-22.23.3-or-24.21.0> --disable-warning=ExperimentalWarning \
    <scratch>/reproduce-corrected.mjs <scratch>/verify
bare:     pass before, fail after, full key changed, ext reported, no parse error
computed: pass before, fail after, full key changed, module reported
alias:    pass before, fail after, full key changed, ext reported, no parse error
relative: pass before, fail after, full key changed, ext reported, no parse error
template: pass before, fail after, full key changed, module reported
builtin:  pass before, fail after, full key changed, module reported
legacy whole-fingerprint controls changed for all six forms
(exit 0 on Node 22.23.3 and 24.21.0)
```

The script's fixed adapter-version strings were held constant across each install comparison; they do not establish version 6 independently. Version 6 is established by the candidate source and shipped daemon proof below.

### Shipped daemon proof: the install bump actually reruns the files

An independent script started each committed plugin's CLI in its own fixture and runtime directory. A trusted install of `ext@1.0.0` exported value 1; the bump to `ext@2.0.0` exported value 2. Test and project sources stayed constant. The fixture held 13 test files across four projects:

- `#ext`, relative JavaScript, aliased JSON and relative JSON imports;
- an unexpandable bare template and an expanded relative glob into `node_modules`;
- imported `createRequire`, `process.getBuiltinModule('module').createRequire`, and computed `getBuiltinModule`;
- an argv alias preload, a project `env.NODE_OPTIONS` alias preload, and an opaque `NODE_OPTIONS` preload;
- one plain control importing no installed package.

The script waited for current checks and no pending runner refinement, then compared persisted run rows and the exact failed-file set after the install. Results were identical:

```text
node        plugin       revision  current checks  baseline files  rerun files  failed files  plain reran
v24.21.0    claude-code   0 -> 1    26              13              12           12            false
v24.21.0    codex         0 -> 1    26              13              12           12            false
v22.23.3    claude-code   0 -> 1    26              13              12           12            false
v22.23.3    codex         0 -> 1    26              13              12           12            false
(probe exit 0 on both Nodes; each owned daemon stopped)
```

An initial probe placed its daemon log inside the watched fixture and the Codex run saw extra runs. Moving that harness log outside the fixture made both plugins satisfy the exact assertions. The successful evidence above comes from the corrected harness; the initial attempt is not a product finding.

## Blockers

None. Prior B1 and B2 are closed by source inspection, full production key comparisons and actual shipped daemon reruns on both Node versions.

## Should-fix

None in this bounded re-review. The external probe's extraction error is recorded as a verification limitation, not a finding against the product delta. The existing recorder-environment work in 003-35 and the prior reviews' accepted loader and observation boundaries remain outside this repair.

## Nits

None.

## What fits

### B1: resolved installed identity reaches test and preload keys (proven)

`src/runners/node-test/graph/modules.ts:133` now uses the resolved target before the written-specifier fallback. Its shared collector calls `installedPackage` for an installed target. `graph/packages.ts:45` derives the name and lookup directory from the last `node_modules/`, preserves scopes and nesting, and marks an owning `package.json` import with `manifest: true`. `modules.ts:163` reports `module` for an installed file that cannot be assigned a package. Test and preload closures both aggregate this collector through `graph.ts:128` and `graph.ts:143`.

The alias and relative probes report `{from: "", name: "ext"}` without opacity. The shipped proof covers both JavaScript and JSON, argv and project `NODE_OPTIONS` preloads, and shows the package bump rerunning and failing each affected file. The plain control stays current without another run. Scoped/nested installs, a tsconfig alias to a vendored install, manifest loads and `.bin` fallback have explicit assertions in `test/runners/node-test/graph-packages.test.ts`; their broad test run completion is unverified here, so those additional shapes are supported by source inspection rather than claimed as an independently completed test gate.

### B2: opacity or installed matches protect every previously blocking load (proven)

`graph/modules.ts:118` reports `module` when a template glob cannot be expanded. At line 124, an expanded glob retains the packages of its installed matches instead of dropping those matches. `graph/parse.ts:48` includes `createRequire` in the conservative source scan; line 109 names literal `getBuiltinModule` loads and marks computed ones opaque. `dependencyKeys` consumes the existing `module` sentinel without a core interface change.

The corrected external probe establishes the whole-key fallback for unexpandable templates and `createRequire`. The shipped proof additionally establishes the expanded installed glob, both ways of reaching `createRequire`, a computed builtin, and an opaque preload's environment fallback. All become failed current checks after the install change, rather than retaining their old passes.

### Regression coverage and shipping boundary (read in source; live proof above)

`test/runners/node-test/packages-resolved.test.ts` turns the prior ten package/load probes into live adapter runs before and after the install, asserting changed dependency segments and pass-to-fail outcomes. `test/integration/node-test-packages.test.ts:130` checks the source daemon's actual run rows and failed-file set, with the plain file excluded. The earlier per-package tests retain the unrelated-install stability, runner/preload package, and `child_process` fallback behaviours; expected lookup directories change to the directory holding the resolved install.

Both Node builds reproduce both committed 0.1.40 plugins, and the independent daemon proof uses those plugins. The prior wave-3 e2e and tracked-worktree copying conclusions are not reopened by this delta. Their broader rerun remains unverified as recorded above.

## Inputs for the next wave

1. Preserve resolved installed identities in the shared collector and retain `module` as the conservative fallback; the core interface and argument order need no change.
2. Preserve the actual install-bump rerun test and the unchanged plain control. Before broadening any external probe, assert a non-opaque literal import parses successfully so bundle-name changes cannot masquerade as a repair.
3. Complete the recorded full-suite and Node 22 slice gates under suitable load before claiming repository-wide green. This review closes B1 and B2; it does not supply those missing gate results.
4. Continue 003-35 and the documented dogfooding follow-ups in their existing scope. No new repair row is required by this review.
