# 003 wave 3 review (003-32)

## Verdict

**FAIL 210d06c**. Two proven blockers, no should-fix findings, no nits. The e2e proof holds for its fixture on both plugins and both Node versions. The new per-package keys can nevertheless keep a passing result current after an installed-package change makes the test fail.

Reviewed `edb5d35` (003-22), `7112b39` and `c9641f9` (003-18, 002-24), and the `8654424` 0.1.31 bundles against spec 003 and spec 001 D3. Candidate HEAD is `210d06cda252758cdceeb533e7d80153e792126a`. The commits after `c9641f9` declare the copied e2e fixtures as inputs and update the board and briefs. This is the current candidate containing the named range, not a different product implementation.

## Verification output

Verification ran in an independent clone at the exact candidate under `/tmp/squeal-review-003-32-HeiVZ5/verify`. The assigned worktree's product files were never changed. The clone's tracked files stayed clean, including after both builds; the shipped probes used bundle content equal to the committed plugins. This keeps the brief's no-build rule for the assigned worktree while checking the reviewer and repository build gate.

The manual Vitest commands are required by the repository and reviewer gate. No command queried this repository's Squeal store or accessed `/home/agent/projects/cezar`. Independent probes, their private stores, logs and the verification clone lived under the one scratch directory above. The repository tests also create their own fixture directories and the existing shared e2e install cache; those pre-existing test conventions were left intact. Every independent daemon was stopped through its own copied CLI. Scratch was removed before this report's commit; no directory or process belonging to another run was deleted or killed.

```text
$ git rev-parse HEAD
210d06cda252758cdceeb533e7d80153e792126a
$ node --version
v24.21.0
$ npm ci
added 56 packages, and audited 57 packages in 4s
18 packages are looking for funding
found 0 vulnerabilities
(exit 0)
$ npm run lint
> squeal@0.1.31 lint
> biome check .
Checked 519 files in 353ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.31 typecheck
> tsc --noEmit
(exit 0)
$ npm run build
> squeal@0.1.31 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.31 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --short
(empty)
$ TMPDIR=/tmp/squeal-review-003-32-HeiVZ5 npx vitest run --maxWorkers=2
 Test Files  200 passed | 1 skipped (201)
      Tests  1662 passed | 10 skipped (1672)
   Duration  411.11s (tests 98%, import 1%, transform 1%)
(exit 0)

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH node --version
v22.23.3
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run lint
> squeal@0.1.31 lint
> biome check .
Checked 525 files in 147ms. No fixes applied.
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run typecheck
> squeal@0.1.31 typecheck
> tsc --noEmit
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH \
    TMPDIR=/tmp/squeal-review-003-32-HeiVZ5 npx vitest run \
    test/runners/node-test test/integration/node-test.test.ts test/e2e --maxWorkers=2
 Test Files  34 passed | 1 skipped (35)
      Tests  207 passed | 3 skipped (210)
   Duration  120.12s (tests 98%, transform 2%, import 1%)
(exit 0)
$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npm run build
> squeal@0.1.31 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.31 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)
$ git status --short
(empty)
$ git diff --exit-code -- plugins
(empty, exit 0)
```

One full-suite proof ran, on Node 24. Node 22 full-suite green is **unverified**; its complete node:test runner directory, integration test and e2e directory passed. The three Node 22 skips are the two explicitly opt-in torn-status probes and the intentionally unsupported Codex `bin/squeal` scenario. The four new node:test e2e cases ran, not skipped. The full suite printed two `repair: gitdir incorrect` messages from its temporary scheduler fixtures. npm reported the existing esbuild and Parcel install-script approval warnings. Node 22 printed `UNDICI-EHPA` and SQLite experimental warnings. None caused a nonzero exit. Node 22 lint overlapped the full suite's temporary fixture creation, explaining its different file count; tracked candidate files stayed unchanged.

Independent scripts ran through the clone's tsx loader on each executable:

```text
$ <node-22.23.3-or-24.21.0> --disable-warning=ExperimentalWarning \
    --import <scratch>/verify/node_modules/tsx/dist/loader.mjs <scratch>/probe.mjs
12 package/load cases: identical conclusions on Node 22 and 24
all live runs completed; full production keys compared before/after observation and install
(exit 0 on both)
$ <node-22.23.3-or-24.21.0> ... <scratch>/extra-probe.mjs
argv preload alias: pass -> fail, key unchanged
NODE_OPTIONS preload alias: pass -> fail, key unchanged
observed-only helper importing ext: pass -> fail, key changed
workspace symlink whose module imports ext: pass -> fail, key changed
(exit 0 on both)
$ <node-22.23.3-or-24.21.0> ... <scratch>/type-probe.mjs
inline type-only import, verbatimModuleSyntax=false: pass -> pass, key changed
inline type-only import, verbatimModuleSyntax=true: pass -> fail, key changed
(exit 0 on both)
$ <node-22.23.3-or-24.21.0> ... <scratch>/shipped.mjs
claude-code: revision 0 -> 1, current=2, failures=0, runs=1 -> 1, key unchanged
codex:       revision 0 -> 1, current=2, failures=0, runs=1 -> 1, key unchanged
plain node --test --test-reporter=tap: exit 1, not ok 1 - value, 2 !== 1
(probe exit 0 on both)
```

The key probes called production `installedDependencies`, `dependencyKeys`, `environmentHash` and `checkKey`, hashing every returned closure/environment file. npm-style installs were generated by the existing `test/keys/install.ts` helper. Every install comparison had a trusted hidden lockfile and a changed whole fingerprint. The primary matrix bumped `ext` and an unused `setup` package together; the shipped-daemon reproduction bumped only `ext`. An in-memory observed store tested whether a completed run repaired a missed key. It did not repair either blocker: installed files are deliberately excluded from recorder paths. The scripts' first harness errors were corrected before the successful evidence above; failed harness attempts are not product findings.

## Blockers

### B1. Resolved installed imports are discarded when their written specifier is not the package name (proven)

Locations: `src/runners/node-test/graph/modules.ts:125-130` and `graph/packages.ts:18-32`. The resolver already returns the installed entry's real path, but the new package reporting ignores that path and calls `packageImport(from, specifier)`. That helper rejects `#` aliases and relative paths. No package or `module` fallback is recorded. The same collector feeds test closures and preload environments, so both lose the dependency.

Spec 001 D3 requires the installed-dependency segment to hold the packages reached by the closure; Vitest's reference `src/runners/vitest/packages.ts:68-83` extracts the package and lookup directory from a resolved installed entry. The 003-22 outcome promises the same per-package semantics. Vision principle 2 forbids an old result presenting as current. This is a regression from node:test's prior whole-lockfile key, not an accepted filesystem-read or undeclared-package miss.

Minimal fixture:

```json
{"name":"app","type":"module","imports":{"#ext":"ext"}}
```

```js
// test/a.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { value } from '#ext';
test('value', () => assert.equal(value, 1));
// node_modules/ext/index.js, with an ESM package.json
export const value = 1;
```

Configure one node:test project over `test/*.test.mjs`, `argv: []`. Install `ext@1.0.0` with the helper's trusted hidden lockfile, run the passing baseline, then write `ext@2.0.0` exporting `value = 2` and rewrite that lockfile. The project and test source stay unchanged. On both Node versions:

```text
closure.paths = [package.json, test/a.test.mjs]
closure.packages = {imports: [], builtins: [assert, test]}
environment.packages = {imports: [], builtins: [], runner: []}
whole fingerprint changed = true
full production check key changed = false
explicit adapter run = completed/pass before, completed/fail after
```

The shipped proof independently started each committed plugin's CLI against this fixture. Each daemon settled revision 0 with two current checks, zero failures and one run. After the install, each settled revision 1 with the same check key, two current checks, zero failures and still one run. A plain Node test process at the new install failed `2 !== 1`. This reproduces the false current pass on both plugins on Node 22.23.3 and 24.21.0, without relying on inheritance or a possible race.

The same full-key failure was verified for `import { value } from '../node_modules/ext/index.js'`, an aliased JSON import mapped to `ext/data.json`, and a relative import of that JSON file. A preload `scripts/setup.mjs` importing `#ext` and assigning its value to a global also kept the key while the test changed from pass to fail, with the preload in argv and in project `env.NODE_OPTIONS`. Its environment held the setup and root manifest, but no installed package.

One-worker repair: derive the package identity and owning lookup directory from the resolved installed path before falling back to the written bare specifier for unresolved imports. Preserve scoped/nested packages and `manifest: true` for package-manifest loads. Report `module` for an installed target that cannot be assigned a package. Apply this through the shared module collector so preload and test packages agree. Add the alias, relative JavaScript/JSON and argv/environment preload regressions on Node 22 and 24; assert changed keys and a daemon rerun after the package bump. Preserve the ordinary unrelated-install key stability tests.

### B2. Some unnamed loads report neither their packages nor the whole-fingerprint fallback (proven)

Locations: `src/runners/node-test/graph/modules.ts:112-120` and `graph/parse.ts:35-43,69-72,99-103`. Two routes bypass `UNNAMED = "module"`:

1. The lexer turns a computed template import into `kind: "glob"`. A bare-package glob is unexpandable and gets an incomplete reason, but no opaque builtin. A relative glob entering `node_modules` drops every installed match with `inWorktree`, also without recording a package or fallback.
2. The new unnamed-load scan recognizes `require.resolve` and `import.meta.resolve`, but omits `createRequire`, which spec 001 D3 and Vitest's `sourceLoads` explicitly treat as opaque. `process.getBuiltinModule('module')` supplies it without an import statement that could otherwise expose the `module` builtin.

Use the B1 fixture with ordinary root metadata and replace its import/value declaration with any of:

```js
const leaf = 'index';
const { value } = await import(`ext/${leaf}.js`);
// or:
const leaf = 'index';
const { value } = await import(`../node_modules/ext/${leaf}.js`);
// or:
const r = process.getBuiltinModule('module').createRequire(import.meta.url);
const { value } = r('ext');
```

All three live controls passed with `value = 1` and failed with `value = 2` on Node 22 and 24. Before and after a completed observed run, each returned `packages: { imports: [], builtins: ['assert', 'test'] }`; the full production check key stayed equal across the trusted install change. Thus incomplete-closure notes do not protect the key, and the observation path cannot rescue it because `node_modules` stays outside observed project paths.

Spec 001 D3 case 2 requires whole-fingerprint keying for `createRequire`; the 003-22 brief requires “a load no specifier names” to report `module`, leaving fallback to the core. The core works when the sentinel is present: the control using `await import(name)` and the literal bare `require.resolve('ext')` control both reported `module` and changed keys on the same install change. The break is the adapter's incomplete reporting, not `dependencyKeys` ignoring a fallback.

One-worker repair: mark unexpandable template imports opaque, and retain package identities or mark opacity when expanded globs reach installed files. Include `createRequire` in the conservative source scan, following Vitest's established rule. Add all three pass/key/fail regressions and assert `module` or a complete installed-package set; also cover an opaque load in a preload so its environment falls back. A note alone is insufficient. B1 and B2 share `graph/modules.ts`; dispatch one repair worker or serialize their ownership.

## Should-fix

None. The proven breaks above block; the accepted custom-loader, child-process and no-local-edit observation-growth boundaries are not newly filed as findings.

## Nits

None.

## What fits

### E2e assertions substantiate their stated claims (proven in the fixture)

`test/e2e/node-test.test.ts:95-163` uses persisted run rows filtered by worktree, not timings, to assert exactly the math node:test file runs after its source edit and fix, and exactly the Vitest strings file runs after its edit. Settles require the runner refinement to finish. The second-worktree case asserts an empty run list, the exact inherited check count, and zero failures before editing it; its later edit runs only its own math file and leaves the first worktree passing. Both hook boundaries deliver the expected transitions and the suite checks the revision/header against status. `stop` checks that the daemon's socket no longer answers. These four cases passed on both Node versions with both committed plugins.

The copied fixture is configured by the shipped `init` and checks its two seeded entries, including cwd, argv and include. Its workspace install has tsx beside Vitest. The proof is for these declared/static inputs; it does not establish correctness of all package-resolution forms, as B1 and B2 show.

### Plugin copying retains the intended shipping boundary (proven for current files)

`test/e2e/plugins.ts:190-207` lists tracked files with `git ls-files -z`, then copies their worktree content, preserving modes. The new unit fixture asserts an uncommitted version change is copied, a deleted tracked file is omitted, untracked and other-plugin files are omitted, and the CLI remains executable. It passed on both Nodes. The existing shipping tests retain the no-`node_modules`-above-plugin check and drive the actual Codex shell command. Both builds reproduce the committed files. A separate version-bump-then-full-e2e experiment was not repeated; the unit test verifies the changed copy boundary directly, and the e2e directory verifies the resulting shipped fixture.

### Ordinary package reporting, observed inputs and type imports (proven for the exercised forms)

The committed package tests pass: ordinary bare first-hop and transitive packages, tsx and setup dependencies in the environment, `child_process` whole-fingerprint fallback, and unrelated-install stability. The independent bare `ext` and `ext/data.json` controls re-keyed. A workspace symlink whose project module imports `ext` reported `{from: 'packages/ws', name: 'ext'}` and re-keyed when ext changed. A computed import of an observed-only project helper also re-keyed on that helper's package bump through the original file's `module` fallback, even though the observed helper itself is not parsed into `packages()`.

`import { type T } from 'ext'` was conservatively reported as an import by the lexer. With tsx and `verbatimModuleSyntax: true`, the package's side effect ran and its bump failed the test, with a changed dependency segment. With the option false, tsx dropped that side effect and both runs passed, but the segment still changed. This is conservative extra invalidation, not a proven narrow-key miss. Explicit `import type` stays dropped as the existing graph tests require.

### Loader/preload follow-up and explicit limits (proven by tests and source)

The argv and project `NODE_OPTIONS` programmatic-registration tests pass on both versions and assert the loader-thread uncertainty warning while the loader executes. The graph now reads project `env.NODE_OPTIONS` in preference to the daemon's value, otherwise its inherited value, by `adapter-project.ts:165-167`; the runner uses the same override precedence. The new alias preload probes prove that flag ingestion alone does not prevent B1. Computed/preload and quoted-require tests remain green. No arbitrary custom-loader observation guarantee is inferred from them.

Adapter version 5 appears in project environments and conservatively invalidates previous node:test environments. It does not make a too-narrow version-5 key safe. The accepted scheme-B misses, declared inputs for filesystem/child-process work, loader-thread uncertainty and row 003-26 remain as documented; the review did not reopen their prior conclusions.

## Inputs for the next wave and dogfooding

1. Repair B1 and B2 before treating the per-package proof as complete. Keep the core interface unchanged: a resolved installed entry reports the owning `PackageImport`; a load whose set cannot be named reports the builtin `module`. Test these contracts before asserting inheritance.
2. Preserve the four node:test e2e cases and add an install-bump scenario that changes a named test outcome while project sources stay constant. Assert that the daemon records a new run and reports the failure at the new revision, rather than only comparing hash helpers.
3. The dogfooding worker should record package aliases, relative installed imports, template imports and `createRequire` forms actually present in the target suites, and compare direct Node failures with Squeal's current state when a package install changes. A clean initial baseline alone will not expose either blocker.
4. Continue to declare loader-thread, filesystem and spawned-child inputs. Record which checks inherit and which re-run, with run rows and revision-aware delivery evidence. Keep the accepted other-worktree observation-growth bound distinct from these local install regressions.
