# Temporary checkout at a commit (topic temp-checkout, row 023-01, 2026-11-16)

Short answer: the checkout and the install are cheap; the test run is the cost. A detached `git worktree add` plus a frozen install takes 1 to 2 s with a warm package store and 7 to 8 s cold, and adds 15 MB (Squeal) or 1 MB (squawk) of disk beyond the checkout itself. 020's gate runs unchanged inside the checkout and writes its completed files to the shared store at X's keys. Running every missing file at X would take 5 to 12 minutes at width 12. So the default should run what the diff X..HEAD selects, within 020's 600 s budget. Three things need work before Squeal can own the checkout. A killed gate leaves its child process running and writing. `squeal ps` does not see that child. An overlay (red proofs) widens the gate's selection.

Examined: Squeal source and the released bundle 0.1.523 (`c13564931`; `origin/main` was `40efe47f5` for the probes), squawk `3e458b236`. Node 26.13.0, git 2.43.0, pnpm 12.15.0 (Squeal) and 12.11.2 (squawk), npm 11.20.0, 24 vCPUs. Probes ran 15:43Z to 16:08Z at a one-minute load of 9.5 to 35.2, stated beside each timing. Probes and outputs: `probes/temp-checkout/` (README).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Install time, disk, network | Worktree add 0.4 to 1.7 s. Warm install 0.65 to 0.77 s, no network, 1 to 15 MB new disk (pnpm hard links 0.5 to 0.8 GB from the store). Cold: 5.3 to 6.2 s, 163 to 304 MB downloaded. A checkout on another filesystem makes pnpm ignore the user's store and download everything again. | verified by experiment |
| 2 | Tests that need files git does not hold | squawk: 62 of 1,939 test files at X read a git-ignored path. 29 are the manual browser group, and 21 are unit files that pass without the build. Squeal: 41 of 1,887, all scratch files the tests write themselves. A build step can be declared only for node:test entries today (020 D15 `prepare`). Nothing warns about missing build output. | verified by experiment; read in source code |
| 3 | Collisions beside the user's tree | Few new ones: runs of two or more worktrees already overlap for 53% (Squeal) and 57% (squawk) of test-run time. New: old commits lack later isolation fixes, and Node resolves packages from parent folders. D14.4 warns about global setup, not about ports, databases, HOME or temp paths. | verified by experiment; read in source code; inferred |
| 4 | Location, store, cleanup | A worktree of the user's repository shares the store with no registration. Results carry X, `dirty` and the checkout's path hash, and stay 7 days after removal. SIGTERM stops everything in 5 s. SIGKILL leaves the gate's child running and writing, and leaves about 20 MB in `$TMPDIR`. `squeal ps` sees none of it. | verified by experiment; read in source code |
| 5 | 020 D3's runner in the checkout | Runs unchanged; second run reads what the first kept. Needs: no `--json` relaunch child, a files-only mode for overlays, a results-only verdict, and the shared store's durations. | verified by experiment |
| 6 | Run flow, budget, first slice | Checkout on the repository's filesystem, warm install, gate in-process on the files the diff X..HEAD selects at X plus named files, 600 s including the install. Builds, other Node versions and the manual groups stay out. | inferred from 1 to 5 |
| 7 | Red proofs (added by the human) | An overlay works: the gate failed HEAD's new test at its fix's parent (6 failed tests). 22% to 27% of new test files import a file the parent lacks; about half of those are test helpers that could be overlaid too. | verified by experiment (one run); read from git objects |

## Findings

### 1. Cost of the checkout and the install (verified by experiment, `measure-install.sh`)

Each run: a detached `git worktree add` at a main commit in a clone under `$TMPDIR`, then `pnpm install --frozen-lockfile` or `npm ci`. "New disk" means node_modules bytes with one link. The rest are hard links into the package store.

| Project | Packages | Worktree add | Checkout | Warm install | Warm new disk | Cold install | Cold download | Cold store and cache |
|---|---|---|---|---|---|---|---|---|
| Squeal `40efe47f5` | 321 | 1.4 to 1.7 s | 13,186 files, 264 MB | 0.65 s (load 31) | 15 MB (+797 MB linked) | 6.2 s (load 22) | 304 MB | 645 + 178 MB |
| squawk `3e458b236` | 702 | 0.4 to 0.5 s | 4,729 files, 64 MB | 0.67 s (load 15) | 1 MB (+506 MB linked) | 5.3 s (load 16) | 163 MB | 551 + 124 MB |
| npm lock fixture (`test/fixtures/keys/locks/npm`) | 8 | 0.01 s | 2 files | 0.77 s (load 15) | 25 MB, plus 23 MB in files with several links inside node_modules (npm copies) | 0.81 s (load 14) | 9.8 MB | 9 MB |

- Warm installs moved 12 to 59 KB on the network, which is noise against a background of 0.2 to 5.6 MB per 15 s. pnpm printed `reused 321` and `reused 702`, `downloaded 0`.
- **Another filesystem.** The squawk checkout on tmpfs (`/dev/shm`) logged: `The store at ~/.local/share/pnpm/store/v11 is not used because packages cannot be hard linked from it into this project. Using the store at /dev/shm/.pnpm-store/v11 instead.` The warm install then downloaded all 702 packages: 1.9 s, 121 MB, 546 MB of new store. Where the checkout lives decides whether the install is warm.
- squawk pins pnpm 12.11.2 in `packageManager`. The install log reads `Done in 518ms using pnpm v12.11.2`, so the global 12.15.0 ran the pinned version in the checkout.
- Removing a checkout (`git worktree remove --force`) took 1.0 to 1.5 s for the pnpm projects and 0.02 s for the npm fixture (load 17, `out/remove.txt`).

### 2. Files git does not hold

**Who reads them** (verified by experiment, `ignored-inputs.mjs` over `VACUUM INTO` store copies). A test file counts when its stored closure or observed reads name a path that X's tree lacks and that `git check-ignore` matches:

- squawk, 62 of 1,939 test files at X:
  - 29 are in the `e2e` browser group, which is at `manual` and needs a build and a browser.
  - 21 are `server` Vitest files. They read `packages/cezar/dist` (3 files), `packages/cezar/web` (7), `.ai/cezar/t` (6), and runtime state (`.ai/squawk/runs.db`, migration files, `.agents/skills`).
  - 10 are in node:test projects (`test:package`, `f2:package`) from older configurations. X's `squeal.config.json` no longer lists them.
- Squeal: 41 of 1,887 test files. All the paths are under `test/fixtures/vitest/.tmp` and `test/fixtures/node-test`, which the tests write and then read back.

**Do they fail without a build?** The 10 squawk `server` files that read `dist` or `web` all passed in the unbuilt checkout: 237 tests, 21.5 s, load 12.4. Three Squeal files that mention `dist` also passed: 24 tests, 5.9 s, load 12.1 (verified by experiment). In this sample, none of the unit tests needs a build. They check whether the build output exists. But their keys differ, as follows. The gate kept no result for `fs-browse.test.ts`, because it "read paths first seen during the run (packages/cezar/web/dist/index.html)". The first finding marks such files "not determined" in the lookup, because an untracked closure path is not in git (`../../018-ci-and-shared-results/research/results-at-commit.md`, Q2). So a result run in the checkout at the "no build" key is one the user's lookup never asks for (inferred).

**Declaring a build** (read in source code and official docs): `nodeTest[].prepare: { command, timeoutSeconds }` (020 D15). The gate reads it at the base and runs it once before the entry's first file, inside the budget. The daemon does not open such an entry. Vitest has no equivalent, and no setting covers the whole repository. When no build is declared, the gate says nothing about missing build output. D14.4's "changed path that no runner can load" line applies only to changed paths.

### 3. Shared resources and collisions

- **Worktrees already run side by side** (verified by experiment, `concurrency.mjs`, 7 days). In squawk, 32,036 runs from 347 worktrees spent 89.9 h running, 57.2% of that time with two or more worktrees at once, and up to 11. In Squeal, 14,837 runs from 331 worktrees spent 77.2 h, 53.4% of it with two or more, and up to 8. A temporary checkout is one more worktree.
- **squawk** (read in source code, `3e458b236`): its test and source code holds 34 `listen(0` calls. Seven `listen(port` calls take the port from a variable; the one traced (`preview/dev-server.test.ts`) gets it from `freePort()`. Other fixed ports appear as data in assertions (`port: 5173`). `vitest.setup.ts` points `CEZ_HOME` at a per-worker sandbox. `.ai/qa` (test environment, cockpit home) lies inside each checkout. The e2e group builds `dist`, starts the app with `--port 0` and needs a browser. It is `manual`, so the gate leaves it out by default (D14.1). A text search for docker, testcontainers and database server names in the unit tests matches only strings in assertions (for example `secret-redaction.test.ts`, `ubuntu-vps.test.ts`). SQLite files are per test.
- **Squeal** (read in source code): its global setup (`test/global-teardown.ts`) gives each run its own `TMPDIR` (`/tmp/squeal-vitest-<pid>-XXXXXX`), kills daemons its tests left, and sweeps the folders of dead runs. Squeal's own scratch is keyed by the worktree id (`squeal-links-<id>`).
- **New with a checkout at X** (inferred): X runs its own test code. A test-isolation fix that landed after X is absent there. squawk's sandbox for `~/.cezar` is such a fix. Setting `HOME` for the run, as the probes did, contains this.
- **Parent folders** (verified by experiment): Node resolved `require("only-in-parent")` from a checkout two levels below a folder that held `node_modules/only-in-parent`. A checkout under the user's tree (squawk's `.ai/squawk/worktrees/`, or `<repo>/.git/squeal/...`) can load a package from the main checkout's root `node_modules` that X's own install lacks. It then passes where a clean run of X fails. With pnpm the root folder holds only the root's direct dependencies, so this needs a package that X's code imports and X's lockfile does not list (inferred).
- **What the gate already prints** (verified by experiment and read in 020 D14.4): file counts per runner and group, each left-out group (`browser (manual) is left out: ...`), `global setup runs for: the root project (any selection)`, changed paths no runner can load, incomplete node:test closures, and preloads that may register module hooks. It prints nothing about ports, databases, containers, `HOME` or fixed temp paths.

### 4. Location, the store, and cleanup

- **The store** (read in source code; verified by experiment): `storePaths(commonDir)` puts the store at `<git common dir>/squeal/store.sqlite`. A `git worktree add` of the user's repository therefore writes to the user's store. In the clones, the gate wrote results with `commit_sha` X, `dirty` 0, and `worktree_id` = `sha256(realpath(checkout))[0:16]`. It wrote no `worktrees` row and no `test_file_keys`. It wrote one `runs` row only for a kept failure log (`<store>/runs/gate-<id>`). `results` is not a worktree-scoped table (`WORKTREE_SCOPED_TABLES`, `src/core/store/repos/worktrees.ts:19`). So results at X's keys outlive the checkout and fall under the 7-day rule (`prune-rules.ts`), which matches the human's "Keep 7 days".
- **The location** decides two things. It must be on the filesystem of the user's install, or pnpm downloads again (finding 1). It should not lie under a folder with a `node_modules`, or packages leak in (finding 3). `<common dir>/squeal/checkouts/` meets the first rule. It breaks the second, because the main checkout's root is one of its parents (inferred).
- **SIGTERM** (verified by experiment, `kill-probe.sh TERM`, load 9.5): the gate exited 3 and printed "the gate's process ended with exit code 143 without a whole report". No process with the checkout in its arguments was left 5 s later.
- **SIGKILL** (verified by experiment, five tries, load 9.5 to 14.5, `out/kill-sigkill.txt`): with `--json`, the gate runs in a relaunch child (`src/cli/code-gate.ts:131`). The child and its Vitest workers kept running after the parent died. One worker was seen 15 s after its parent's kill, and none was left 30 s later. One orphaned child wrote 4 files to the store after its parent was killed. Two of the five runs left four folders each in `$TMPDIR`, about 20 MB per run. Vite's `ssr` cache was 17 to 18 MB of that; the rest was `squeal-gate-*`, `squeal-gate-keys-*` and `squeal-observe-*` (`out/tmpdir-leftovers.txt`).
- **`squeal ps`** (verified by experiment): `squeal ps --json`, taken 1 s after a kill while the orphan ran, listed 0 orphans and did not name the checkout or the gate's pids (`out/ps-after-kill-summary.json`). Its rules attribute processes to daemons (`src/core/ps/flags-processes.ts`). A gate has no daemon.
- **squawk's own cleanup** (read in source code, `packages/cezar/src/git-worktree.ts`): one mutation lock per repository around create and remove (`withWorktreeMutation`), and `git worktree prune` before a create, "so the checks below describe the filesystem as it exists now". Before removal it releases the processes that run from the checkout (#781: "a dev server never keeps running from a directory that is gone"). Then `worktree remove --force`, `rm -r` and `prune`. git 2.43 offers `git worktree add --lock --reason <string>`, "keep the new working tree locked" (`git worktree add -h`). That a lock also keeps `prune` off a live checkout is inferred, not tested.

### 5. 020 D3's runner inside the checkout (verified by experiment, `out/gate-runs.txt`)

`squeal code --base HEAD --test <files>` ran unchanged in a clean checkout. With no diff, it selected only the named files. Squeal: 3 files, 10.5 s, load 17 to 21. squawk: 2 Vitest and 2 node:test files, 11.0 s, load 18. It wrote nothing to the project (`git status` empty). A second run read 2 files from the store and ran 1. What the flow needs from it:

1. **No orphan.** Call the gate in-process, or make its child end with its parent (finding 4).
2. **Only the named files.** An overlaid file makes the tree dirty, and declared inputs then widen the selection. One overlaid file selected 8 (5 Vitest and 2 node:test through declared `inputs`) and took 45.8 s (finding 7).
3. **A results-only answer.** The gate judges changed functions against CC and CRAP. The overlay run read `incomplete`, exit 3. A before/after comparison needs per-file outcomes, and `runs[].failed` already carries them.
4. **The shared store.** In a fresh store, no file has a stored duration, so the estimate reads "the time is unknown". First-seen reads also barred a keep on the first run: 1 of 3, 1 of 4, and 3 of 8 files. The second run kept them. In the real flow the checkout shares the user's store, which holds durations and the observed union (inferred).

### 6. Budget

Per test file at X: the summed test durations of its newest stored run (verified by experiment, `durations.mjs`; a lower bound, since setup and transform time are left out; the durations were recorded under this host's load).

| Repository | Files | Sum | Median | p90 | Max | All at width 12 | Half at width 12 | All at width 4 |
|---|---|---|---|---|---|---|---|---|
| squawk (no e2e) | 1,842 | 8,529 s | 0.79 s | 15.1 s | 240 s | 711 s | 363 s | 2,132 s |
| Squeal | 1,881 | 7,620 s | 0.61 s | 9.4 s | 183 s | 635 s | 312 s | 1,905 s |

The first finding found no row with X's content for 49.5% (Squeal) and 75.5% (squawk) of the files at main commits under a day old. Running every missing file at X would take 5 to 9 minutes at width 12 and 16 to 27 minutes at width 4. That is over the 600 s budget on most machines. The checkout and install cost 2 to 8 s of it.

### 7. Red proofs: HEAD's test files over X

- **One overlay run** (verified by experiment). X = `6eef38f51`, the parent of squawk's fix `961b5a266`. `claude-forked-command.test.ts` was copied from the fix into the checkout. The gate failed it with 6 failed tests (`claude typed forked command > fails the fork when its turn ends with error_during_execution`, ...), which is the red the proof wants. The failure was not kept in the store (first-seen reads). The other 5 kept files carry `dirty` 1. Their keys hold the overlaid bytes, so they mean "X with this test file". That is correct, but the lookup at X never asks for those keys (inferred).
- **How often an overlay breaks on imports** (git objects only, `overlay-imports.mjs`, 200 first-parent main commits each):

  | Repository | New test files whose import is missing at the parent | Changed test files | Missing only test-side files (helper, testkit, fixture) | Missing a source file |
  |---|---|---|---|---|
  | squawk | 27 of 100 | 125 of 1,445 | 67 of 152 | 85 of 152 |
  | Squeal | 4 of 18 | 10 of 116 | 7 of 14 | 7 of 14 |

  A missing test-side file (squeal `test/scheduler/drive-fixture.js`, squawk `__fixtures__/claude-*`) can be overlaid with the test. A missing source file (the fix's new module, for example `worker-scope/job.ts`) makes the file fail on import. That is red for the wrong reason, and it must be reported apart from an assertion failure (inferred). The regex reads static imports at line start, so dynamic imports are not counted.

## Recommendation for Squeal

1. **Run flow** (inferred from 1 to 5):
   1. Take the repository's worktree lock and `git worktree prune`.
   2. `git worktree add --detach --lock` at X, on the filesystem of the user's tree, with a marker that names the owner pid and start time.
   3. Run a frozen install with the project's package manager. With pnpm, use the store the user's tree uses.
   4. Run the gate in-process, under the same budget, with `HOME` and `TMPDIR` pointed at a per-run folder. Run only the selected files.
   5. Print before/after per file.
   6. Stop the run's process group, `worktree remove --force`, delete the run folder, `prune`.

   At start, sweep checkouts whose marker names a dead owner. The daemon's prune can sweep them too.
2. **Scope and budget.** By default, run the files that the diff X..HEAD selects at X (D3.1's selection) and the named files, and only those with no result at X's key. Use 600 s in all, install included. Run every missing file only when asked, with D17.1's estimate and rerun line. One commit apart, 9% (Squeal) to 27% (squawk) of the keys differ, so a near base costs little (first finding, Q4).
3. **Report per file:** pass, fail, did not finish, not run (budget), and "not comparable". A file is not comparable when it reads files git does not hold, or, for an overlay, when it imports a source file X lacks. Overlay test-side files that X lacks together with the named test.
4. **Out of the first slice:** builds (no `prepare` beyond 020 D15's node:test entries), the `manual` groups (browser e2e), another Node version, and X whose lockfile or Node pin differs from the user's tree, which topic 023-02 covers. The install would still work for that last case: warm, it is under a second.

The tradeoff: Squeal owning the checkout costs 2 to 8 s and a cleanup path. A printed recipe costs nothing in Squeal but leaves the agent to clean up, and SIGKILL in this probe already left orphans and `$TMPDIR` folders behind.

## Open questions for the human

1. Where may the checkout live? Inside the repository's git folder it shares the filesystem with the install, but Node can load the main checkout's packages through the parent folders. Outside any project needs a folder on the same filesystem, which Squeal cannot always find.
2. Overlay for red proofs: should a test file whose import X lacks read "not comparable" and not run, or run and show the import error?
3. Should a run at X default to the diff's selection, as recommended, or to every file with no result at X?

## Sources

- Squeal at `c13564931` and bundle 0.1.523: `src/core/store/paths.ts`, `repos/worktrees.ts:19`, `prune.ts`, `prune-rules.ts`; `src/core/fs/git-layout.ts:48`; `src/core/daemon/paths.ts:113`; `src/cli/code-gate.ts:131`; `src/core/ps/flags-processes.ts`; `test/global-teardown.ts`; `vitest.config.ts`, `squeal.config.json`.
- Specs: 020 D1, D3, D11.7, D14, D15, D17 (`../../020-quality-gate/spec.md`); 001 D8 as amended; first finding `../../018-ci-and-shared-results/research/results-at-commit.md`; hand runs `../../011-core/research/hand-runs-2026-11-16.md` item 4 (on `origin/main` `f6c03b822`).
- squawk at `3e458b236` (read-only clone): `vitest.config.ts`, `packages/*/vitest.config.ts`, `packages/web/e2e/vitest.config.ts`, `.ai/scripts/test-env-up.sh`, `squeal.config.json`, `pnpm-workspace.yaml`, `packages/cezar/src/git-worktree.ts`, `git-worktree-release.ts`.
- Stores, as `VACUUM INTO` copies: `~/projects/squeal/.git/squeal/store.sqlite`, `~/projects/cezar/.git/squeal/store.sqlite`.
- Tools: `pnpm install --help` (12.15.0), `git worktree add -h` (2.43.0), Node 26.13.0 module resolution (shown by experiment).
- Probes and outputs: `probes/temp-checkout/` (README).
