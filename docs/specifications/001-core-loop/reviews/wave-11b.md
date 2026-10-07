# Review: 001-104 and 001-105 (task 001-106)

Reviewer task 001-106 for spec 001, 2026-10-07. In scope:

- 001-104: `806484f` (stale hidden lockfile), `3f1e39a` (D3).
- 001-105: `d15b567`, `78952f7`, `7750245`, `3d5e114`, `d4fa85e`, `9e4e7d1`, `5246b10`, `178ae09`, `613a48b`, `c1d9524`, `108b3dc`, `cd3b85d`, `28b8626`.
- The rebuild `c61a98e` (0.1.20).

The 002 and 003 commits between them belong to the other coordinator and are out of scope. I read the range against the wave 11 briefs for 001-104 and 001-105, D3 and D4 as amended, `research/per-package-keys.md` and `tasks/001-105/notes.md`.

The design as built:

- **001-104.** `staleHiddenLockfile` applies npm's trust rule to `node_modules/.package-lock.json`: no unlisted folder, no listed folder missing, none newer than the file, links compared with `lstat`. When the rule fails, the fingerprint hashes each package folder's path, name and version instead, and a note names the first offender.
- **001-105, scheme B.** `InstalledGraph` reads the trusted hidden lockfile as a graph. The environment hash holds the lockfile closure of `vitest`, of the setup and `globalSetup` closures' packages, and of the config files' imports and literal `require`s. Each test file's key adds a segment: the closure of the packages its project files import in one hop, minus the environment's. A file falls back to the whole fingerprint when its closure imports `child_process`, `worker_threads`, `module` or `cluster`, or when the runner reports no packages for it. A stale or non-npm lockfile puts the whole fingerprint in the environment hash.

## Verdict

**FAIL at `fc2bbbd`.** Counts: 3 blockers, 3 should-fix, 4 nits.

**Can a key now survive a dependency change that could alter a result?** Yes. Before 001-105, any change to the hidden lockfile moved every key. Now a key holds through a package bump that turns a `PASS` into a `FAIL` in three kinds of case, all proven on the 001-105 fixture:

- Vitest loads a package named by a string in the config: the test `environment`, `snapshotSerializers` (B1).
- A project file loads a package through `require`, which Vitest provides without any import: `require("x")` or `require.resolve("x/data.json")` (B2).
- A first-hop package spawns a child that loads another package (B3).

A worktree that inherits such a key receives a `PASS` reported as current while its own run would fail. None of the three is among the known misses the human accepted with scheme B ("an undeclared require or a computed `import()` of an undeclared package in-process, a `node_modules` path built by hand and read with `fs`"). None of them is stated in D3 either.

On `cezar` none of the three occurs. No kept file has a `require` in its closure, and every config uses `node` or `jsdom` without serializers. The measured share holds: 323 of 632 on a fresh clone. The blockers are about repositories that are not `cezar`, and about D3's claim to cover `require.resolve`.

The other probes hold:

- pnpm and yarn installs fall back to the whole fingerprint.
- A restored closure keys by the whole fingerprint until the runner resolves it again.
- A types-only package re-keys nothing, and one that also ships runtime code is keyed.
- The stale-lockfile note reaches status once per daemon, but again on every restart (S1).
- Under a running daemon, an unlisted package folder re-keys nothing until a restart (S2).

## Verification

HEAD is `fc2bbbd`, one commit past the build `c61a98e`. `git diff --stat c61a98e fc2bbbd` shows only `docs/board.md`, `lessons.md` and `tasks/wave-11.md`, so I ran everything at `fc2bbbd`.

```
$ git rev-parse HEAD
fc2bbbd6a146354d05773389ac33b4bbc5734a95
$ npm ci
(exit 0; install-scripts warnings for @parcel/watcher and esbuild)
$ npm run lint
Checked 472 files in 284ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: the committed bundles of both plugins match the build)
$ npx vitest run
 Test Files  168 passed (168)
      Tests  1436 passed | 8 skipped (1444)
   Duration  146.50s
```

I ran the probes in throwaway `test/runners/vitest/zz-probe-106*.test.ts` and `test/scheduler/zz-probe-106*.test.ts` files and deleted them before the commit. Each Vitest probe ran on the 001-105 fixture (`test/fixtures/vitest/packages`, Vitest 5.0.3). It wrote the install with `writeInstall`, ran the files, bumped one package, computed every file's dependency inputs exactly as `test/runners/vitest/packages.test.ts` does, and ran the files again.

| Probe | Re-keyed by the bump | Outcome after the bump |
| --- | --- | --- |
| `require.resolve("data-pkg/data.json")` plus `readFileSync` in a test file, no `node:module` import; bump `data-pkg` and its `data.json` | none (packages `{imports: [], builtins: ["fs"]}`) | `PASS -> FAIL` (B2) |
| `require("cjs-pkg")` in a test file; bump `cjs-pkg` | none (packages `{imports: [], builtins: []}`) | `PASS -> FAIL` (B2) |
| test imports `spawner`, whose `index.js` runs `node -e "require('child-pkg')"`; bump `child-pkg` | none (packages `[spawner]`, no builtins) | `PASS -> FAIL` (B3) |
| `// @vitest-environment custom` docblock; bump `vitest-environment-custom` | none | `PASS -> FAIL` (B1) |
| config `environment: "custom"`; bump `vitest-environment-custom` | none (environment packages `setup2-pkg, setup-pkg, vitest, plugin-pkg`) | `PASS -> FAIL` (B1) |
| config `snapshotSerializers: ["ser-pkg"]`; bump `ser-pkg` | none | `PASS -> FAIL` (B1) |
| config `setupFiles: ["test/setup.ts", "setup2-pkg"]` (a package setup file); bump `setup2-pkg` | all three files | unchanged in the probe: the probe did not recreate the instance, which the daemon does on a lockfile change |
| `import p from "@types/node/package.json"` with only `.d.ts` beside it; bump to 24.0.0 | none (`@types-only`) | unchanged in the probe for the same reason; see N2 |
| pnpm, yarn layouts (read `environment.ts:110-120`, `dependencyKeys`) | `graph` is built only for `HIDDEN_LOCKFILE`, so any other format puts the whole fingerprint in the environment hash | fits |
| scheduler harness: hidden lockfile listing a missing folder, start; lockfile edit with the same reason; config edit; restart | note persisted once at start, not again for the edit or the config re-read; a second copy after the restart | S1 |
| scheduler harness: trusted install, start; `node_modules/sideloaded/package.json` written and handed in a batch; restart | key unchanged under the running daemon; changed after the restart | S2 |

`cezar`, measured again on a fresh clone. I ran `git clone /home/agent/projects/cezar /tmp/rv106/cezar`, `git checkout c7fa7178` (the research's `origin/main`) and `npm ci` (13 s). The new hidden lockfile is byte-identical to `/tmp/ppk/cezar-origin`'s. Then `npx tsx docs/specifications/001-core-loop/tasks/001-105/measure-cezar.mts /tmp/rv106/cezar /home/agent/projects/cezar` (load average 23):

```
testFiles 632, reachChildProcess 306, reachOpaque 308, noPackagesReported 0
walkMs 14065, lockfileReadMs 24, keyingMs { warm: 57, coldGraph: 41 }
mainLiteral  kept 0   (stale: not listed in it: node_modules/@fontsource/poppins)
mainAsIs     kept 323, keptReachingChildProcess 0, keptReachingOpaque 0
originAgain  kept 632
```

The figures match `tasks/001-105/notes.md`. I also scanned the closure files of the 324 files that do not fall back. None has a literal `require(` or a `require.resolve(`. Two reach `import.meta.resolve('tsx')` (`packages/cezar/src/ci-wait/controller.ts:73`, through `contract.test.ts` and `preview-stop.test.ts`). It builds a command line no test there spawns, and `tsx` is 4.23.0 in both installs. That is another way to resolve without importing `module`; B2's fix covers it.

## Blockers

### B1. Packages Vitest loads by name from the config are in no key (proven)

`src/runners/vitest/packages.ts:52` (`environmentPackages`).

**What happens.** The environment set holds `vitest`, the setup and `globalSetup` closures' packages, and the config files' imports and `require`s. Vitest also imports packages named only by strings, for every test file of a project or of an environment:

- `test.environment: "custom"`, or a `// @vitest-environment custom` docblock, loads `vitest-environment-custom`. `jsdom`, `happy-dom` and `@edge-runtime/vm` are covered because they are `vitest` peers.
- `snapshotSerializers: ["ser-pkg"]` loads `ser-pkg`.
- Not probed, same mechanism: `test.runner`, a custom `pool`, `sequence.sequencer` given as a package name.

The resolved config is in the environment hash, but only as the string. The bump of `vitest-environment-custom` and of `ser-pkg` re-keyed nothing, and each test then failed.

**What breaks.**

- The 001-105 outcome: "never reuses a result its dependencies could change".
- D3's environment hash is meant to hold "what every test file of the project can load".
- The vision: "stale results do not mislead agents".
- Before 001-105, any such bump moved every key.

**Fix (one worker, `src/runners/vitest/packages.ts`, `test/runners/vitest/`).**

- In `environmentPackages`, add as imports from the project root: a non-builtin `environment` (both `<name>` and `vitest-environment-<name>`), every `snapshotSerializers` entry that is a bare specifier, and `runner`, `pool` and `sequence.sequencer` when they are bare specifiers.
- For docblock environments, either collect the docblock names during `testFiles()` (Vitest reads them when it builds specifications) or add every installed `vitest-environment-*` package to the environment set.
- Fixture test in `packages.test.ts`: the two probes above re-key every file of the project.

### B2. `require` in a project file is invisible, and `require.resolve` does not fall back (proven)

`src/runners/vitest/graph.ts:94-127` (`importTargets` reads only `transformed.deps` and `dynamicDeps`), `src/core/keys/packages.ts:12` (`OPAQUE_BUILTINS`).

**What happens.** Vitest's module runner gives every inlined module a `require` without any import. So a test file or a project file can call `require("cjs-pkg")` or `require.resolve("data-pkg/data.json")` without importing `node:module`. Neither call appears in Vite's transform deps:

- the closure reports no package, so the key holds no identity for it;
- no opaque builtin is reported, so there is no fallback.

D3 gives `module` as the fallback because "`require.resolve` can load a package no import names". The fallback misses the common way a Vitest file reaches `require`. `import.meta.resolve` is the same case (seen on `cezar`, without effect there).

**Failure scenario.** A CommonJS-style test does `const { parse } = require("yaml")`. Worktree A validates with `yaml` 2.4. Worktree B's install has `yaml` 2.5, which changes `parse`, and nothing else the test imports. B inherits A's `PASS` as current. B's own run would fail.

**Fix (one worker, `src/runners/vitest/graph.ts` and `packages.ts`).**

- Scan each project file's source on disk, cached per transform as D4 rule 3 already does for `import.meta.glob`, with `packages.ts`'s `REQUIRE` pattern.
- Each literal `require("x")` of a bare specifier adds `x` as a bare import from the importer's directory.
- Any `require.resolve(`, any non-literal `require(`, any `createRequire` and any `import.meta.resolve(` adds the `module` builtin, so the file falls back.
- Tests: the two probes above. Re-measure `cezar`'s share; my scan expects no change.

### B3. A first-hop package that spawns does not send its importers to the whole fingerprint (proven)

`src/core/keys/dependencies.ts:44-46`. The fallback looks only at the builtins of the closure's project files.

**What happens.** `test/spawner.test.ts` imports `spawner`. Its `index.js` runs `node -e "require('child-pkg')"`. The key holds `spawner`'s lockfile closure, which does not contain `child-pkg`. Bumping `child-pkg` re-keyed nothing, and the test failed. The same holds for a test that runs a package's binary through `execa`, `cross-spawn` or `tinyexec` (for example `execa("tsc")`), and for packages that start workers.

The research's trace found no such file on `cezar` (its 8 child-process files spawn from project files), and its list of B's misses does not name this case. `tasks/001-105/notes.md` names it under "Not done". D3 does not mention it.

**Fix: a decision, then one worker.**

- (a) Code. Mark an installed package "opaque" when one of its runtime files imports `child_process`, `worker_threads`, `cluster` or `module`. Memoize the mark per identity, like the types-only scan, which already walks every package folder (`packages.ts`, `hasRuntimeFile`). A test file whose segment closure contains an opaque identity keys by the whole fingerprint. Identities already in the environment set are exempt, since `vitest` and `vite` spawn by design. Re-measure `cezar`: many packages import `child_process` for one-off uses, so the share may drop below 300.
- (b) Spec. The human accepts it as a known miss. D3 then says plainly that a package that spawns or starts a worker is keyed by its own lockfile closure only. `notes.md` keeps the example.

## Should-fix

### S1. The stale-lockfile note is persisted again by every daemon start (proven)

`src/core/scheduler/lockfiles.ts:35,74`.

`#notes` is per `Lockfiles`, so per daemon. The probe persisted one note at the first start, nothing for a lockfile edit with the same reason or a config re-read, and a second identical note after a restart. Notes are capped at 20 (`MAX_PERSISTED_NOTES`), so a worktree restarted often shows the same sentence several times and pushes real notes out. D3 says "recorded once each time it changes".

**Fix.** In `#noteOnce`, also skip a text that `persistedNoteTexts(store, worktreeId)` already holds, as the bootstrap does for unmatched-input notes. Lockfiles would need the set or a predicate through `KeyingOptions`. Add a scheduler test, which is also missing for the wiring itself (`3d5e114` has none): a stale lockfile at start gives one persisted note, and a restart gives no second one.

### S2. Under a running daemon, an unlisted package folder re-keys nothing until a restart (proven)

`src/core/scheduler/keying.ts` (staleness is checked only inside `setEnvironments`).

**What happens.** `node_modules` is ignored and only the lockfile file is watched. A folder added without rewriting the lockfile creates no revision and no environment read, so 001-104's rule is not applied again. In the probe the key was unchanged after the folder was written and handed in a batch, and changed only after a restart.

**Why it matters.** The 001-104 outcome: an install that bypassed the hidden lockfile "can never keep an environment hash from changing". Under scheme B the bypass is worse than a missed re-key. A test that imports the side-loaded package keys it as `absent:` in both worktrees. So a result run with the package present is inherited by a worktree without it.

**Why not blocking.** Before 001-104 this never re-keyed at all. The row's done-when is met at the function level.

**Fix.** 001-107's `InstallStamps.check()` already lists the root `node_modules` entry names before every tier (`scheduler.ts:263`). When the stamp moves and the lockfile did not, re-read the environments (`readEnvironments`) before the tier. That covers top-level folders. Nested ones stay a restart's job; say so in D3. Test: the probe above.

### S3. D3 overstates what the fallback covers

Whatever B2 and B3 decide, D3's parenthetical "(a process, a thread or `require.resolve` can load a package no import names)" reads as coverage of those three. Today the fallback covers them only when a project file imports the builtin. Amend D3 with the fix. Also list scheme B's accepted misses in one sentence: undeclared in-process requires, hand-built `node_modules` paths, and whatever B3 decides. The status closure-method line could then point at it.

## Nits

- **N1.** `src/core/scheduler/keying.ts:165`: a test file with no runner closure gets `""` from `setInstalled`'s callback. `""` means "no package segment", which under a scoped environment hash ignores every package. No path reaches it today, because every keyed file goes through `WorktreeKeys.setClosure`. The fail-safe value is the whole fingerprint: return `this.#dependencies.get(ref.project)?.of(undefined) ?? ""`.
- **N2.** `src/core/keys/packages.ts:38-43`: `package.json` counts as not runtime, but a test can import it (`import p from "@types/node/package.json"`). Such a package keys as `@types-only`, so its version bump keeps the key. The probe showed the key holding. It could not show the flip, because the instance was not recreated. Plausible and rare. Count `package.json` as runtime when a project file imports it by subpath, or key the types-only constant with the version.
- **N3.** D3 says "so `@types/node` re-keys nothing". Files that fall back still re-key on it, as `test/runners/vitest/packages.test.ts` asserts for `spawn.test.ts`. Say "re-keys no file that keeps its own segment".
- **N4.** (unverified) With `deps.optimizer.ssr.enabled`, Vite serves pre-bundled packages from `node_modules/.vite/...`. `closurePackages` turns that path into no name (`packageName` rejects a leading `.`) and drops it, so such packages would be in no key and trigger no fallback. Not probed. Worth one fixture case with B1 or B2: a path under `node_modules/.vite` could send the file to the whole fingerprint.

## What fits

Settled here; the next wave need not re-check it:

- **001-104's rule.** It matches npm's documented one: unlisted, newer and missing folders, links by `lstat`, workspaces' own `node_modules` walked. The folder fallback re-keys on add, remove and version change, and each kind is tested (`test/keys/hidden-lockfile.test.ts`). Lockfile read plus check: 24 ms on `cezar` at load 23, within the 25 ms budget.
- **The graph.**
  - `InstalledGraph` resolves as Node does, skipping `…/node_modules` directories.
  - Nested installs (`node_modules/a/node_modules/b`) resolve to the nested copy.
  - Links follow `resolved` and key as `workspace:`.
  - Optional peers that are absent key as `absent:`, so installing `jsdom` moves `vitest`'s environment.
  - Closures are memoized per graph.
- **The 001-105 fixture.** The bumps of an externalized package's declared dependency, an inlined package's dependency, a setup package and a config plugin each re-key exactly their users, and those tests pass.
- **Types-only.** A package with only declarations keys as a constant; one that ships `.d.ts` and `.js` is keyed.
- **pnpm, yarn (all three layouts), bun and rush.** `graph` is `null`, so the environment hash holds the whole fingerprint. That is the stated fallback, not a gap.
- **Restored closures.**
  - `bootstrap.ts:84` sets the stored paths with no packages, so `of(undefined)` gives the whole fingerprint.
  - The recheck at `bootstrap.ts:104-113` resolves misses through the runner and keys them per package.
  - A hit under the whole key is sound, since that key is the stricter one.
- **Key transitions.**
  - `KeyIndex.setInstalled` re-keys each file once with the new environment hash and segment.
  - A lockfile change first moves every key to a provisional environment hash (`provisionalEnvironments`), so no key can hit with the old segments.
- **Shared lockfiles.** `Lockfiles.set` reads a shared lockfile once per call and keys each project with its own environment set.
- **`cezar`.** 323 of 632 kept on a fresh clone, none reaching `child_process`, 0 under npm's rule. Keying 41 to 57 ms against the 300 ms budget.
- **The build.** `c61a98e` matches `npm run build` (tree clean after the build), and the version moved to 0.1.20 in `package.json` and both plugin manifests.
- **Out-of-row test edits.** `d4fa85e` and `9e4e7d1` are justified in `notes.md`: the old lockfile edits changed nothing any test loads.

## Inputs for the next wave

One repair worker for 001-105, owning:

- `src/runners/vitest/packages.ts` and `graph.ts`;
- `src/core/keys/packages.ts` and `dependencies.ts`;
- `src/core/scheduler/lockfiles.ts` and `keying.ts`, for S1, S2 and N1;
- tests under `test/runners/vitest/`, `test/keys/` and `test/scheduler/`;
- D3 and D4.

Order:

1. **B2** first. It is in-process and cheap. It reuses the per-transform source scan from D4 rule 3. The scan must stay inside the 300 ms keying budget on `cezar`, so measure with `measure-cezar.mts`.
2. **B1** next, in `environmentPackages`. It needs the resolved project config, which `projectInputs` already has.
3. **B3** only after the coordinator, or the human, picks (a) or (b). If (a), report the new `cezar` share with the same script on `/tmp/rv106/cezar` (fresh `npm ci` of `c7fa7178`) against the main checkout.
4. **S1, S2, S3 and N1 to N3** fold in with them. S2 touches `scheduler.ts:263`, which 001-107 owns. Agree it with that row's owner, or the coordinator.

Still missing after this range:

- The `node:test` runner reports no packages, so its files key by the whole fingerprint (003-22, other coordinator). It must call `RunnerClosure.packages` and `RunnerEnvironment.packages` in the `{ from, name }` form `closurePackages` produces: worktree-relative `from`, the importer's directory for a bare name, `<dir>` for `<dir>/node_modules/<name>/…`. It should also report `require` and `import.meta.resolve` per B2.
- pnpm's `lock.yaml` `snapshots` graph is not read (whole fingerprint).
