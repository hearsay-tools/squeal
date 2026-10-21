# What splits a whole suite's keys between worktrees (row 011-81)

Researcher findings for `key-split-brief.md`, 2026-10-21. Code read at `af4ab74da` (Squeal 0.1.242 sources). Probes in `probes/key-split/`; clones under `/tmp/squeal-011-81`, since removed. One-minute load during the probes: 31.9 to 36.6 on 24 CPUs.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Squeal, a version raise | Only the installed-dependency input of the environment hash differs. The package graph is usable, but the environment is opaque: `globalSetup` reaches `node:child_process`, so `dependencyKeys` puts the **whole** fingerprint in the environment hash. The whole fingerprint hashes the hidden lockfile, whose top-level `"version"` is the root package's version. | verified by experiment |
| 2 | Squeal, a stale install | `staleHiddenLockfile` does not fire. The key holds the old install's lockfile (top-level version 0.1.237), so the worktree shares with no 0.1.242 install, although its packages are identical. | verified by experiment |
| 3 | Cezar | Not the lockfile: both installs have the same `lock.yaml` and fingerprint. The runner files differ: every project's environment hashes **every** project's config file, and `f1ca49e6` changed `packages/web/e2e/vitest.config.ts`. All 5 projects re-key for a change only `e2e` reads. | verified by experiment |
| 4 | How often and what it costs | Squeal, 2026-10-21 (the only day the store keeps runs): 9 whole-suite re-keys in 4 worktrees, all version raises. 4.16 of 6.7 stored run-hours followed them (upper bound). Cezar, 7 days: 4 all-project re-keys (1 dependency install, 3 config-file edits), 2.75 + 0.93 run-hours; 48 setup-file re-keys of one or a few projects. A full 7-day count is not determined, because the stores pruned runs and revisions. | verified by experiment (store queries); 7-day squeal count inferred |
| 5 | Recommendation | Hash the hidden lockfile without the root's top-level `name` and `version` and without each workspace entry's `version`. pnpm's installed `lock.yaml` holds no own versions and needs no change for this cause. Separately, give each Vitest project only the root config, its own config and their `configFileDependencies`. Needs no key-format raise by the C3 rule; the alarm decides. | inferred, from verified 1 to 4 |

## 1. Squeal, a version raise

- `verified by experiment` Clones of `94607f2e3` (0.1.240) and `423953305` (0.1.242), each `npm ci --offline --ignore-scripts`. The two `node_modules/.package-lock.json` differ in one line, `"version": "0.1.240"` against `"0.1.242"` (line 3). The hidden lockfile has no `""` entry. `parts.ts` (`parts-output.jsonl`) shows every part of the environment hash equal (Vitest 5.0.3, adapter 3, resolved config, the 3 runner files, patches) except `installedDependencies`: `eb7f2a1aa6e6` against `ca5961f7643f`.
- `verified by experiment` `graphUsable: true`, no stale note. `environmentOpaqueBuiltins: ["child_process"]`, `environmentInputIsWholeFingerprint: true`. Without the opacity rule, all three clones would have one scoped input, `15ea8c68860f`.
- `read in source code` The path: `vitest.config.ts` sets `globalSetup: ["test/global-teardown.ts"]`. That file imports `test/daemon/strays.ts`, which imports `execFileSync` from `node:child_process` (line 1). `environmentPackages` adds the globalSetup closure's builtins (`src/runners/vitest/packages.ts:96-140`). `dependencyKeys` returns `{ environment: fingerprint, of: () => "" }` when `isOpaque(environment)` (`src/core/keys/dependencies.ts:35-40`). `installedDependencies` hashes `format.path + "\0" + content` of the whole file (`src/core/keys/environment.ts:208-211`). This is spec-conformant (011 C11, "when those import such a builtin [...] the environment hash holds the whole fingerprint"). It contradicts C3's intent for 001-199: "two builds that differ only in `package.json` version key every check alike".
- `inferred` Fixing only the opacity would not be enough. Under C11 case (1), every test file whose closure imports `child_process` (Squeal's daemon, harness and CLI tests) keys by `whole:<fingerprint>` and would still split on each raise.

## 2. Squeal, a stale install

- `verified by experiment` Clone `c`: `npm ci` at `76d961d54` (0.1.237), then `git checkout 423953305` without an install, as in `04a258b0`. `package.json` says 0.1.242, and the hidden lockfile says 0.1.237. `staleNote: null`. npm's rule compares package folders with the file, not with `package.json`, and the folders match. The fingerprint is `50949bac0176`, a third value for the same packages (`a` and `b` are the other two). The live `04a258b0` has the same fingerprint (`lockfile-parts-output.jsonl`).

## 3. Cezar

- `verified by experiment` Clones of `a7ee35b90` (head of `f1ca49e6`) and `5fc6dd862` (head of `7c144ff7`), installed with pnpm 12.11.2 offline. Both `node_modules/.pnpm/lock.yaml` have sha256 `98b71d50…`, the same as both live worktrees. `parts.ts` (`cezar-parts-output.txt`): in all 5 projects (`api-client`, `contract`, `e2e`, `server`, `web`) the graph is not usable (pnpm), so the whole fingerprint is the input. The fingerprint is equal. The only differing runner file in `api-client`, `contract`, `server` and `web` is `packages/web/e2e/vitest.config.ts`. `e2e` also differs in `environment.ts`, `.ai/scripts/test-env-lease.mjs` and its resolved config. The config diff removes `./workspace-registry.ts` from `e2e`'s `globalSetup`.
- `read in source code` `configFiles(vitest)` collects the root's and **every** project's `configFile` and `configFileDependencies` (`src/runners/vitest/project.ts:7-14`). `projectEnvironment` lists them for each project (`src/runners/vitest/environment.ts:29-50`). Every cezar project therefore hashes the same 9 files (`cezar-runner-files.json`): 6 config files of 5 projects, `vitest.config.ts`, `packages/web/vite.config.ts` and two sequencers.
- `read in source code` (installed `lock.yaml`) pnpm's installed lockfile lists importers by directory with each dependency's `specifier` and `version`. It holds no own version of the root or of a workspace package. A workspace dependency is `version: link:../contract`, `specifier: ^0.16.0`.

## 4. How often and what it costs

Read-only `node:sqlite` queries (`stores.ts`), window 2026-10-14 21:10 to 2026-10-21 21:10 CEST. An event is a revision whose changes hold an installed lockfile or a runner file. Its cost is that worktree's runs from the event to its next event, at most 4 hours. This is an upper bound: edits in the same window run too.

- `verified by experiment` **Retention.** The squeal store keeps runs only from 2026-10-21 (813 runs, 6.7 run-hours). Its revisions before 2026-10-21 are sparse (20 to 130 a day), and none holds a lockfile. Cezar keeps runs from 2026-10-14 (6,584, 84.4 run-hours), but it has no revisions on 10-17 and 10-18.
- `verified by experiment` **Squeal, 2026-10-21.** 9 lockfile events in 4 worktrees (`03d89750` 5, `04a258b0` 2, `07e4a729`, `5c664a42`). Each is `npm ci` deleting the old hidden lockfile. The deleted hashes match a version-only copy of the 0.1.240 file, one for each of 0.1.234 to 0.1.244, so every one was a version raise. Main took one dependency change in the 7 days (`c12dc371d`, 2026-10-14) and 61 versions (0.1.175 to 0.1.244). The windows re-ran 5,544 distinct test files (5.7 suites of 970) and took 4.16 of the day's 6.7 run-hours (62%).
- `verified by experiment` **Cezar, 7 days.** 52 events:

  | Cause | Events | Worktrees | Distinct files re-run | Run-hours |
  |---|---|---|---|---|
  | Installed lockfile (dependency change, 10-19) | 1 | 1 | 101 | 0.93 |
  | Config file every project hashes | 3 | 2 | 354 | 2.75 |
  | Setup files of `e2e`, `server` and `web` (worktrees started on a new main, 10-21 07:00) | 7 | 7 | 501 | 4.43 |
  | Setup file of `e2e` (mostly `agent-browser.ts`) | 34 | 11 | 577 | 29.65 |
  | Setup file of `web` | 7 | 1 | 501 | 0.60 |

  No environment-variable or allowlist event: cezar's allowlist is empty, and squeal has none. No key-format or adapter-version change in the window (format 20 since 2026-10-20, adapter 3).
- `inferred` Squeal re-keys the whole suite in a worktree each time it installs at a new version. With about 9 versions a day on main, that is several times a day per active worktree. A worktree that does not reinstall splits instead, as in question 2.

## 5. Recommendation

**Npm.** `installedDependencies` hashes the hidden lockfile with its top-level `name` and `version` removed, and with `version` removed from every `packages` entry that is not under a `node_modules` folder (the workspace folders). Everything under `node_modules/` stays whole: location, version, integrity, resolved, link and edges. Patches and the stale fallback stay as they are. Add an encoding tag to the hashed bytes, as `squeal-installed/2`.
- `verified by experiment` Effect on 2026-10-21 (`lockfile-parts-output.jsonl`). The 5 live squeal worktrees installed at 0.1.235 to 0.1.244 have 4 fingerprints today and 1 candidate (`ce39aaecc01a`). The 9 older worktrees (0.1.29 to 0.1.151) have 5 fingerprints and 1 candidate. Clones `a`, `b` and `c` share the candidate. `inferred`: `03d89750`, `cff86ecb`, `04a258b0`, `07e4a729` and `5c664a42` would then share every key whose closure files match, as same-commit worktrees share 99%.
- Why not the scoped input for opaque cases: 001-109 keys them by the whole install, because a child process or a worker can load packages that no import names. The whole install without own versions keeps that guarantee.

**Pnpm.** No change for this cause: the installed `lock.yaml` holds no own versions (question 3). `inferred`: a raise of a workspace package that also edits a dependent's specifier changes `specifier` under `importers` and re-keys everything. Dropping `specifier` where `version` is `link:` would cover it. Cezar's pnpm lockfile changed twice in 7 days, both real dependency changes, so this is not measured as a cost.

**Cezar's split (separate change).** A project's environment holds the root config file, its own config file and the `configFileDependencies` of these two, not those of sibling projects. `inferred`: Vitest loads each `projects` entry as its own config, so a sibling's config cannot change this project's resolved config. A file imported by two configs stays in both. On the pair above, `api-client`, `contract`, `server` and `web` (814 of 901 listed cezar files) would share, and only `e2e` would re-key.

**Regressions the change must pass.**
1. A dependency upgrade (a version or integrity under `node_modules/`) still re-keys every opaque test file and the opaque environment.
2. Adding or removing a workspace folder, or a link target change, still re-keys.
3. A stale hidden lockfile still falls back to package folders (001-104).
4. A test that reads the root `package.json` at runtime still re-keys on a raise. `read in source code`: `squealVersion()` reads it through `fs` (`src/core/daemon/version.ts`). It is caught by the observed runtime inputs (`observe.runtimeInputs` defaults to `true`, `src/core/types/policy.ts:270`) or by a declared input (`test/harness/plugin.test.ts` declares `package.json`). The regression must cover a test with observation off and no declaration: today the lockfile re-keys it by accident.
5. Per-project config: an edit to one project's config re-keys only that project, an edit to the root config re-keys all, and an edit to a shared dependency re-keys each importer.

**Key format.** `read in source code` 011 C3 and `key-format.ts`: "A change of a key's inputs re-keys its checks by itself." The new fingerprint never equals an old one, so no stored row is misread. One release re-keys every check once. `inferred`: no raise is needed unless the alarm (`test/keys/key-format.test.ts`) names a validity case whose outputs differ.

**Prior art.**
- `read in source code` Vite 8.3.2 `getLockfileHash` (`vite/dist/node/chunks/node.js:28820`) and Vitest 5.0.3 (`vitest/dist/chunks/index.DpLw24bj.js:7486`) hash the whole lockfile plus the patches directory's mtime. Their caches are per checkout, so the root version costs them one re-optimization, not cross-worktree sharing.
- `read in official docs` Turborepo hashes "Lockfile changes that affect the package" per package, and the whole workspace only for "Lockfile changes that affect the Workspace root" ("Updating dependencies in root `package.json`"). A package's own `package.json` is a separate package input ("Updating the name field"), so its version raise re-runs that package's tasks as a source file, not through the lockfile.
- `read in official docs` Nx's task hash includes "Versions of external dependencies".
- `read in official docs` Bazel keys each action by "inputs, output names, a command line, and environment variables".

None of them hashes the workspace's own version into the dependency input. Where the version matters, it enters as a source file, as Squeal's closures and observed inputs do.

## Open questions

- The 7-day squeal count and cost before 2026-10-21: not determined, because the store keeps runs about one day and pruned the older revisions.
- Whether the alarm names a validity case for the fingerprint change: not determined, because this research runs no test.
- 716a6766, named in `host-load.md`, is no longer a live worktree. Its 0% share is attributed to the same cause by its version (0.1.242 installed after the 0.1.240 pair), `inferred`.

## Sources

- Code at `af4ab74da`: `src/core/keys/environment.ts`, `dependencies.ts`, `hidden-lockfile.ts`, `packages.ts`, `key-format.ts`; `src/core/scheduler/keying.ts`, `lockfiles.ts`; `src/runners/vitest/packages.ts`, `project.ts`, `environment.ts`; `test/global-teardown.ts`, `test/daemon/strays.ts`; `docs/specifications/011-core/spec.md` C3, C11.
- Cezar at `a7ee35b90` and `5fc6dd862`: `vitest.config.ts`, `packages/web/e2e/vitest.config.ts`, installed `node_modules/.pnpm/lock.yaml`.
- Stores, read-only: `/home/agent/projects/squeal/.git/squeal/store.sqlite`, `/home/agent/projects/cezar/.git/squeal/store.sqlite`.
- Installed: vite 8.3.2, vitest 5.0.3 (clone `a`).
- Fetched 2026-10-21: https://turborepo.com/docs/crafting-your-repository/caching, https://nx.dev/docs/concepts/how-caching-works, https://bazel.build/remote/caching.
