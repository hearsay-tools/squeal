# 011-150: declared inputs broader than what a test reads

Researcher of row 011-150, 2026-10-23, 13:17Z to 14:10Z. Brief: `research/declared-inputs-brief.md`. Read: `docs/vision.md`, `docs/styleguide.md`, `research/edit-load.md`, `research/host-load.md` 3, spec 011 C3, C10 (`inputs`, `observe.runtimeInputs`), C12, each repository's `squeal.config.json`.

Versions: squeal source at `4e1ba068a` (glob compiler `src/core/keys/glob.ts`, keying `src/core/scheduler/keying.ts`); configs of squeal `88f90431c`, cezar `565fd3eaf`, toolkit-dev (untracked) and mvp-unveiled-july26 (untracked). Store copies taken 13:19Z; every 72-hour window ends at the store's last revision, 13:14Z. Cezar build: TypeScript 7.0.2, Vite 8.1.4 (rolldown 1.1.5). Load1 20 to 50 during the builds. Probes and how to re-run each: `probes/declared-inputs/README.md`.

**Units.** *Recorded seconds* (s): per test file, the sum of each check's newest stored duration, as in `edit-load.md`. *Re-keyed* means the edit changed the file's key; it is not what ran. A file re-keyed by several changed paths takes the first route of: the edited file itself, an import, a declared input, an observed read.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Inventory | Only squeal and cezar declare inputs. Per edit, declared inputs alone re-key 84 s in squeal (4% of what an edit re-keys) and 4,007 s in cezar (49%); observed reads alone re-key 696 s (36%) and 396 s (5%); imports 1,144 s and 3,698 s. In cezar two globs on the 83 browser specs make nearly all of it | read from store copies; routes by a walk checked against Vitest's graph |
| 2 | cezar's e2e | Each spec carries 1,885 declared files. The e2e build contains no test file: five test, testkit and spec edits left it byte-identical. Without test files (1,055 per spec) the specs re-key 31% fewer recorded seconds; with each spec's own helpers only, 45%; with the server and web import graphs only, 50%. Each set still re-keys 31 of the 32 spec FAIL transitions of 72 hours; the one it drops was FAIL to FAIL. But 420 of the 641 spec runs ran in the main checkout after pulls, and only 3 runs followed edits that the narrower sets drop | verified by experiment (build), read from store |
| 3 | squeal's reads | Observed reads re-key 696 s per edit: daemon, harness and integration tests whose child processes run the CLI from source (`hold.test.ts` observes 550 `src` files). Declared `src/**/*.ts` re-keys 49 harness tests that build bundles with esbuild, which the recorder cannot see. 42 FAIL transitions came through declared inputs only, 32 of them bundle drift; 13 through reads only, 5 of which passed again at the same revision | read from store, read in source code |
| 4 | What Squeal could offer | A note per broad glob: cheap and safe, but cezar cannot act on it, because a glob cannot exclude test files. Observed inputs for browser tests: high cost, they cannot see the build, and they would miss type errors. Per-file inputs: already in the config; 20% fewer re-keys for cezar. Nothing: squeal's declared inputs are already near tight (2%) | inferred from 1 to 3 |

## 1. Inventory

| Repository | Config | Declared inputs | Store |
|---|---|---|---|
| squeal (main checkout and worktrees, `squeal-r1-0.1.259` included: its `.git` points into squeal's) | tracked | 12 test globs, 24 input globs | 463 edits in 72 h |
| cezar | tracked | 23 test globs, 83 input globs | 304 edits |
| toolkit-dev | untracked | none (`"inputs": []`) | 126 edits |
| mvp-unveiled-july26 | untracked | none | 0 test files, last revision 2026-10-19 |

*read in config, read from store copies.*

Recorded seconds re-keyed per edit (watch revisions of 1 to 9 paths), by route:

| Repository | Own file | Import | Declared alone | Observed alone | Total | Edits with a declared-alone re-key: p50, p90 |
|---|---|---|---|---|---|---|
| squeal | 3 | 1,144 (59%) | 84 (4%) | 696 (36%) | 1,927 | 117 of 463: 0 s, 446 s |
| cezar | 32 | 3,698 (45%) | 4,007 (49%) | 396 (5%) | 8,133 | 245 of 304: 5,799 s, 5,811 s |
| toolkit-dev | 0 | 0 | 0 | 219 (100%) | 219 | none |

*read from store copies.* The route needs the static import set, which the store keeps merged with declared and observed paths. `routes.py` takes a closure path that is neither declared nor observed as the runner's. Where a path is both, a regex import walk decides. The walk found 7,950 of 7,950 stored runner paths for 150 squeal files, with 4 extra. For cezar it found 2,163 of 2,322; the 159 misses are `package.json`, `tsconfig.json` and old node:test reads, not TypeScript imports. *verified by experiment.*

The globs that re-key the most (72 h; a file re-keyed through two globs counts under each):

| Test glob | Input glob | Files covered | Test files carrying it (recorded s) | Edits hitting it | Declared-alone s, 72 h (per edit) |
|---|---|---|---|---|---|
| cezar `packages/web/e2e/*.e2e.ts` | `packages/cezar/src/**` | 941 | 83 (5,732) | 87 | 504,112 (1,658) |
| same | `packages/web/src/**` | 665 | 83 | 79 | 456,547 (1,502) |
| same | `packages/web/e2e/**/*.{ts,mjs}` | 111 | 83 | 38 | 214,174 (705) |
| same | `packages/cezar/scripts/**` | 44 | 83 | 10 | 57,958 (191) |
| same | `packages/contract/src/**` | 53 | 83 | 8 | 46,353 (152) |
| cezar `.github/scripts/*.test.cjs` | `.github/scripts/**`, `.github/workflows/**` | 85, 15 | 45 (704) | 23, 4 | 2,881, 2,829 |
| squeal `test/harness/opencode/**/*.test.ts` | `src/**/*.ts` | 597 | 17 (165) | 97 | 12,908 (28) |
| squeal `test/harness/codex/**/*.test.ts` | `src/**/*.ts` | 597 | 15 (87) | 97 | 8,695 (19) |
| squeal `test/harness/pi/**/*.test.ts` | `src/**/*.ts` | 597 | 11 (76) | 97 | 6,753 (15) |
| squeal `test/integration/node-test.test.ts` | `src/**/*.ts` | 597 | 1 (72) | 97 | 4,389 (9) |
| squeal `test/runners/pytest/**/*.test.ts` | `src/runners/pytest/runtime/**` | 2 | 32 (464) | 5 | 2,052 (4) |

Every other pair of test glob and input glob re-keys under 1,500 s in 72 h. The full table is in `routes.py`'s output. *read from store copies.*

## 2. cezar's browser tests

**What a spec exercises.** `environment.ts`, the e2e project's `globalSetup`, runs `.ai/scripts/test-env-up.sh`. That script runs `build-e2e.sh`: `tsc -p packages/cezar/tsconfig.json` and `vite build` of `packages/web`, into the git-ignored `.ai/qa/build/cezar`. A shared server then serves that build to Chrome through `agent-browser`, under a lease. *read in source code, cezar `565fd3eaf`.* The cezar tsconfig excludes `src/**/*.test.ts` and `src/**/*.testkit.ts`. The walk from `packages/web/src/main.tsx` reaches no test file, and no source uses `import.meta.glob`. *read in source code.*

| Part | Files | Not tests | What the build reaches | Eager | Lazy (route chunks) |
|---|---|---|---|---|---|
| `packages/cezar/src/**` | 941 | 282 `.ts` (545 tests and testkits) | 271 from `src/index.ts` | 254 | 17 |
| `packages/web/src/**` | 665 | 358 `.ts/.tsx` (285 tests) | 354 from `main.tsx` | 242 | 112 |
| `packages/web/e2e/` `.ts/.mjs` | 111 | 83 specs, 28 helpers | a spec imports 4 helpers at the median, 9 at most | | |

*read in source code (import walk).* The web build has 72 JavaScript chunks and no source maps. *verified by experiment.* The server has no per-page split, because every module it builds ships. A page loads the 242 eager web modules plus the lazy chunks it opens. So per-page narrowing could drop at most 112 of 354 web modules.

**Experiment.** `build-diff.sh` built the e2e bundle in a scratch clone, once per edit, 6 to 27 s per build. It hashed each output tree without `.d.ts` files: tsc 7.0.2 writes `server/server.d.ts` with its members in a different order from run to run, and no browser test runs a `.d.ts` file.

| Edit | Server output | Web output |
|---|---|---|
| none, three builds | same 3/3 | same 3/3 |
| comment in `packages/cezar/src/server/git.test.ts`, in `core/owned-input-delivery.testkit.ts`, in `packages/web/src/routes/task-thread/activity-summary.test.tsx`, in `packages/web/src/test/fixture-serve-env.test.ts`, in `packages/web/e2e/session-footer.e2e.ts` | same | same |
| comment in `packages/web/src/routes/task-thread/activity-summary.tsx` | same | same (the minifier drops comments) |
| comment in `packages/cezar/src/core/managed-session.ts` | changed (tsc keeps comments) | same |
| string literal in `activity-summary.tsx` (positive control) | same | changed |
| string literal in `packages/cezar/src/open-url.ts` | **build failed**: `TS2367`, so every spec fails | none |

*verified by experiment.*

**Narrower sets**, scored over the 72-hour edits and FAIL transitions (`narrow-e2e.py`):

| Set | Declared files per spec | Edits re-keying a spec | Recorded s re-keyed (per edit) | FAIL transitions still re-keyed: 72 h, whole store |
|---|---|---|---|---|
| S0 today | 1,885 | 212 of 304 | 1,203,791 (3,960) | 32 of 32; 61 of 63 |
| S1 without test and testkit files | 1,055 | 146 | 825,479 (2,715), −31% | 31; 51 |
| S2 S1, and of `packages/web/e2e/` only the spec's own imports and setup files | 953 | 139 | 657,910 (2,164), −45% | 31; 51 |
| S3 S2, and only what the server and web walks reach | 938 | 129 | 600,590 (1,976), −50% | 31; 51 |

*read from store copies, sets inferred from the walk and verified for S1 by the experiment.* Of the 33 FAIL transitions in 72 h, 29 come from one `start` revision of the main checkout (rev 111, 21 October). All 29 have the same error, "rmSync is not defined", and pass at rev 112. That revision changed `packages/web/e2e/failure-setup.ts` and `agent-browser.ts`, a setup file and a helper that every set keeps. One FAIL is `environment.ts`. The other three are `session-footer.e2e.ts`: rev 18 after edits to its page's components (kept), rev 49 after an edit to the spec itself (kept), and rev 19. Rev 19 is the one transition the narrower sets drop: FAIL to FAIL, after edits to `ci-wait/*.test.ts` only. Over the whole store, from 14 October, the narrower sets drop 10 more transitions that followed test-file changes only. Seven are a worktree's first result. Two are PASS to FAIL with timing or browser errors ("value never stayed stable", "CDP Runtime.runIfWaitingForDebugger"). One is FAIL to FAIL. The build does not change on a test-file edit, so these 10 are timing or environment failures, not effects of the edits. *read from store; cause inferred from the experiment.*

**What ran.** In 72 h the specs ran 641 times (44,407 recorded s), one file per run. 420 of these runs were in the main checkout, 418 after pulls. 208 runs had no earlier run of the file in that worktree in the store, so the store cannot judge them. Only 3 runs (390 s) followed edits whose changes S1 to S3 drop. The slow lane runs one file at a time and runs only the newest key, so most re-keys never run. A narrower set reduces stale browser verdicts in worktrees. It would also let a branch that changed only tests share main's results. It would not reduce the runs this store shows. *read from store copies.*

## 3. squeal's reads and declared inputs

Re-keys without an import, 72 h (recorded s; share of the non-import total of 361,000):

| Route, test folder | File re-keys | Recorded s | Why |
|---|---|---|---|
| observed, `test/daemon` | 3,194 | 169,415 (47%) | child processes and Workers run the CLI and daemon from source; `hold.test.ts` observes 550 `src` files, the median `test/daemon` file 271 |
| observed, `test/harness` | 1,139 | 68,421 (19%) | hooks and CLI run from source in children, 38 `src` files per file |
| declared, `test/harness` | 3,797 | 32,111 (9%) | bundles built from `src` by esbuild: `buildDist` (pi helpers), `build()` in `codex/plugin.test.ts`, `codex/cache-fixture.ts`, `opencode/package.test.ts` |
| observed, `test/integration` | 1,173 | 30,093 (8%) | a daemon from source; 182 `src` files per file |
| observed, `test/scheduler`, `test/keys`, `test/cli` | 1,312 | 45,244 (13%) | fixtures; `key-format.test.ts` reads sources to hash them |

*read from store copies, read in source code (squeal `4e1ba068a`); "why" per folder inferred from the observed paths and the helpers.* Commit `1b298a1c9` gave the reason for the `src/**/*.ts` input: "bundles built from src". esbuild reads files in its native binary, and the recorder wraps Node's `fs` only (C12). 21 of the 49 test files in the store that carry `src/**/*.ts` observe no `src` file at all. *read in source code, read from store.* The bundles' import closure, from the 35 entry points of `bundleOptions` and each plugin's `entries/`, holds 572 of the 597 `src/**/*.ts` files. Narrowing the input to that closure would have saved 839 s of the 38,839 declared-alone s (3 edits). *read in source code (walk), read from store.*

FAIL transitions, 72 h: 116 test files.

| Route of the changed paths | Files | Recovered at the same revision | Passed later | Failing again or open |
|---|---|---|---|---|
| own file or import | 48 | 9 | 26 | 13 |
| declared (alone, or with observed) | 42 | 1 | 20 | 21 |
| observed only | 13 | 5 | 3 | 5 |
| no changed closure path in the store | 13 | 2 | 3 | 8 |

*read from store copies.* 32 of the 42 declared failures are bundle drift ("cli/squeal.mjs differs from the build", "cli/ps.mjs differs"). These are `plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts` and `pi/package.test.ts`, which compare the committed `dist` with a fresh build. They turn FAIL on every `src` edit that changes a bundle, until someone rebuilds `dist`. The other 10 are in the same four files with no summary, plus `codex/version-copies-hook`, `codex/kept` and `pi/host-exit` (through `plugins/pi/**`). The store holds 49 test files that carry `src/**/*.ts` (45 at the commit). The other 42 turned FAIL through declared inputs 0 times. They hold 33,289 of the 36,757 declared-alone s of the carriers. Of the 13 observed-only failures, 5 passed again at the same revision (load), and 5 are `opencode-dispose` and `opencode-hooks` timing failures ("killed the held Stop at +2116, at or after its idle deadline"). 3 passed after a later edit: `version-sensitive`, `hold`, and `key-format` (the key-format guard, by design). *read from store copies.*

## 4. What Squeal could offer

| Option | Cost | Soundness | Saving, with evidence |
|---|---|---|---|
| Observed inputs for browser tests (what the server served) | High and specific to one app. Today `observed.e2e` holds 1 path per spec at the median (`.npmrc`). The build runs in `globalSetup` in Vitest's main process, and the recorder runs in workers (C12). TypeScript 7 and rolldown read files in native code. The served files are git-ignored, and C3 drops ignored paths. The web build has no source maps, so a served chunk does not name its sources. The server is shared under a lease, so its reads do not belong to one spec | Would miss build breaks: a type error in any non-test server module fails the build and every spec (experiment). It cannot see what a page does not request | At most the lazy web chunks a page does not open: 112 of 354 modules. Runs saved in the 72 h store: at most 3 |
| A note when one glob re-keys many files per edit | Low: keying already tells a declared path from a runner path (`keying.ts` `declaredFor`, `isDeclaredInput`) | No change | Only what the repository changes after the note. In cezar, two globs re-key all 83 specs on 87 and 79 of 304 edits; 66 edits (22%) re-keyed them through test or testkit files only. The obvious fix, S1 (−31% of re-keyed seconds, verified safe by the build experiment), **cannot be written today**: the glob compiler rejects negation (`glob.ts:14`), and tests sit beside sources in every folder (545 of 941 files) |
| Per-file declared inputs | None for the map: `inputs` already maps a test glob to input globs (C10) | As sound as the globs | S2 over S1: a further −20% (825,479 to 657,910 s), with each spec keeping its imports and setup files. Can be written today only by listing the e2e files the server reads |
| Nothing: repository configuration | None | Unchanged | squeal: declared `src/**/*.ts` is needed (esbuild), and its bundle closure saves 2%. cezar: S1 would need about 400 listed files, kept by hand |

*inferred from findings 1 to 3; each cited number is tagged there.*

## Recommendation for Squeal

None: the brief asks for numbers, not design. The evidence supports three statements. In cezar, declared inputs are half of what an edit re-keys, and 31% of that is test files that the build provably does not contain. The config syntax cannot exclude those files. Narrower inputs change stale states and sharing, not this store's runs, which pulls drive.

## Open questions

1. Per-spec runtime use (pages, requests, server code run per spec): not determined. A run needs `agent-browser`, which the cezar provider fetches from GitHub releases, and a Chrome session. Neither was run in the isolated home. The static bounds above stand in for it.
2. Whether S1 would have let worktrees share main's browser results: not determined. The store keeps one key per worktree and file and no earlier closures, and 208 of the 641 runs had no earlier run in that worktree.
3. Re-keyed is not ran: the per-edit seconds are what a key change exposes, not CPU. For squeal and toolkit, what each route actually ran was not split here.
4. Keying a browser test by its build output instead of its inputs: the experiment shows the output did not change on 5 test edits or a web comment edit. This was not evaluated further, because it is design.

## Sources

- Store copies: `~/projects/{squeal,cezar,toolkit-dev,mvp-unveiled-july26}/.git/squeal/store.sqlite` with `-wal` and `-shm`, copied 2026-10-23 13:19Z; tables `test_files`, `meta` (`observed.*`, `nodeTest.observed.*`, `pytest.observed.*`), `revisions`, `transitions`, `results`, `runs`.
- Configs: `git show 88f90431c:squeal.config.json` (squeal), `git show 565fd3eaf:squeal.config.json` (cezar), `~/projects/toolkit-dev/squeal.config.json`, `~/projects/mvp-unveiled-july26/squeal.config.json`.
- squeal source at `4e1ba068a`: `src/core/keys/glob.ts`, `src/core/keys/closure.ts` (`assembleClosure`, `createDeclaredInputs`), `src/core/scheduler/keying.ts`, `src/core/daemon/node-test-runners.ts`, `src/harness/build.ts` (`bundleOptions`), `test/harness/bundle-helpers.ts`, `test/harness/codex/cache-fixture.ts`, `test/harness/pi/helpers.ts`; commit `1b298a1c9`; spec 011 C3, C10, C12.
- cezar source at `565fd3eaf`: `packages/web/e2e/vitest.config.ts`, `packages/web/e2e/environment.ts`, `.ai/scripts/build-e2e.sh`, `.ai/scripts/test-env-up.sh`, `packages/cezar/tsconfig.json`, `packages/web/index.html`, `.ai/browsers/agent-browser.md`; package metadata of `typescript` 7.0.2 (per-platform binaries) and `vite` 8.1.4, `rolldown` 1.1.5 (native bindings).
- Experiment: a scratch clone of cezar at `565fd3eaf` under `/tmp/di150`, `node_modules` copied from the main checkout, `build-diff.sh` 2026-10-23 13:40Z to 13:50Z; the clone and logs are removed, the hashes are in finding 2.
- Probes: `probes/declared-inputs/` (README lists each script and the commands).
