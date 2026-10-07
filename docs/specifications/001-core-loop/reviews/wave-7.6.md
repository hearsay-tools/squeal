# Wave 7.6 review

Reviewer task 001-62 for spec 001, 2026-10-07. Range `f87067b..ae24aaf` (5 commits):

- 001-60: the `reviews/wave-7.5.md` B1 and B2 fixes in `dynamic.ts` and `stale.ts`, their tests and the D4 sentence.
- 001-61: the daemon's working directory and temp directory move out of the worktree (`scratch.ts`, `runner.ts`, `ensure.ts`, `open.ts`, `daemon.ts`, `test/daemon/scratch.test.ts`), with the D10 amendment.
- The bundle rebuild.

For 001-60 this is the third review of the 001-53 slice. I read the range against D4 (3) and D10 as amended, D11, `lessons.md` defect 13 and `reviews/wave-7.5.md`. I did not re-check what `wave-7.5.md` and earlier reviews list under "What fits".

## Verdict

**FAIL at `ae24aaf`.** Counts: 2 blockers, 2 should-fix, 6 nits. Both blockers are in 001-61.

**001-60 is clean.** `wave-7.5.md` B1 and B2 are closed. Each new test fails when its fix is reverted, and cost is unchanged. Conditional, sugar and array `exports` do not go stale. When a directory's `package.json` has `exports`, Vite does not fall back to `index`, so the importer has no transform cached until the entry exists, and the add re-runs it. The only miss is a `main` with a trailing slash (N1).

**001-61 broke two things that run tests:**

- **B1.** The new `TMPDIR` lies inside the repository's `.git`, inside the main checkout. A test that makes a temp directory now runs inside a git repository and under the project tree. Its outcome can differ from the agent's own `vitest run`, and the daemon stores that difference as a result.
- **B2.** A long-lived child process started during a runner call keeps the root as its working directory after the daemon goes idle. esbuild's service is one: Vite 6 and 7 start it for every TypeScript transform, and Vitest 5 (Squeal's floor) accepts both. On such a project the daemon tree pins the root again, which is defect 13.

Everything else the brief asked about holds. The working directory is restored across overlapping calls and throws. Relative paths and `TMPDIR` reach the fork workers on the first run and on later runs. Racing daemons never empty another daemon's temp directory. `git worktree remove` without `--force` succeeds under an idle daemon, which then exits 0 in about 1 s.

## Verification

The brief's branch HEAD is `5d2d86d`. It is one commit past the candidate and touches only `docs/board.md` and `tasks/wave-7.6.md` (N6). I ran everything on a detached worktree at `ae24aaf`.

```
$ git rev-parse HEAD
ae24aaf…   (detached worktree)
$ npm ci
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
Checked 338 files in 104ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
 Test Files  108 passed (108)
      Tests  844 passed | 7 skipped (851)
   Duration  48.37s
```

Cost: I ran `structural-cost.test.ts` alone three times, at a load average of 4 to 6 on 24 cores.

| cold | warm | first invalidate (add) | invalidate (add) | afterAdd | afterEdit | sourceWarm | sourceAfterAdd |
|---|---|---|---|---|---|---|---|
| 0.85–0.96 s | 10.3–11.4 ms | 18.1–20.9 ms | 4.5–5.4 ms | 15.6–16.5 ms | 12.8–15.3 ms | 10.3–12.8 ms | 13.7–17.2 ms |

Dropping the `node_modules` skip did not move the first `invalidate`; it is 18 to 21 ms, as before. `afterAdd` stays within 1 to 3 ms of `afterEdit`. The `cold / 4` guard has a margin of about 13 times. I have no CI figures for this range.

## Previous findings (`reviews/wave-7.5.md`)

| Finding | Status | Evidence |
|---|---|---|
| B1, virtual module | closed | `structural.test.ts` "import.meta.glob in a virtual module picks up the new file". It asserts the run passes after the add. With `found = source !== null && …`, the test fails. |
| B1, inlined dependency | closed | the same `it.each`, the inlined-dependency row. With the `/node_modules/` skip restored, it fails. D4 (3) names both cases. |
| B2, a `package.json` `main` target added | closed | "the file a package.json main names appears: the directory leaves its index". It asserts `affected` = [test] and the run outcome. With `entryDirectories` disabled, it fails. D4 has the sentence. |
| N1, an edited `package.json` | open, optional | Not taken. `directories` still comes only from an added or deleted `package.json`. It stays an input below. |
| N3, D4's CI figures | open | See S2. |
| N2, N4, N5, N6, N7 | unchanged | Outside this range. They remain inputs. |

I probed the `package.json` entry against a fresh instance on the same root, with `src/uses.ts` exporting from `./pkg`, `src/pkg/index.ts` present, and then the entry added:

| `src/pkg/package.json` | added | before the add | `affected` | candidate run | fresh run |
|---|---|---|---|---|---|
| `"main": "lib.ts"` | `lib.ts` | fail (reads `index`) | [test] | pass | pass |
| `"main": "lib"` | `lib.ts` | fail | [test] | pass | pass |
| `"main": "./dist/x.js"` | `dist/x.ts` (twin) | fail | [test] | pass | pass |
| `"exports": "./lib.ts"` | `lib.ts` | file error | [test] | pass | pass |
| `"exports": { ".": "./lib.ts" }` | `lib.ts` | file error | [test] | pass | pass |
| `"exports": { ".": { "import": …, "default": … } }` | `lib.ts` | file error | [test] | pass | pass |
| `"exports": { "import": …, "default": … }` (sugar) | `lib.ts` | file error | [test] | pass | pass |
| `"exports": { ".": { "node": … } }` | `lib.ts` | file error | [test] | pass | pass |
| `"exports": ["./lib.ts"]` | `lib.ts` | file error | [test] | pass | pass |
| `"main": "lib/"` | `lib/index.ts` | fail | **[]** | **fail** | pass |

Every `exports` form gives a file error before the add, not the `index` fallback. Vite resolves `exports` first and does not fall back, so the import was unresolved and rule 1 handles it. The `exports` part of `entryDirectories` therefore never decides an outcome. It is harmless, but D4's "or a string `exports` or `exports["."]`" describes a case Vite does not have (N2).

## Blockers

### B1. Vitest's temp directory is inside the repository, so tests that make temp directories get different results under the daemon (proven)

`scratch.ts:21` puts `tempDir` at `<common-dir>/squeal/tmp/<worktree-hash>/`. `adoptScratch` (`scratch.ts:42-44`) points `TMPDIR`, `TMP` and `TEMP` there, and every fork worker inherits them: Vitest builds each task's env from `process.env` on every run (`vitest/dist/chunks/index.DpLw24bj.js:11725`). The common dir is the main checkout's `.git`. So `os.tmpdir()` in a test is now `<main>/.git/squeal/tmp/<hash>/`, inside a git directory and below the main checkout.

Test, as the agent would write it:

```ts
const dir = mkdtempSync(join(tmpdir(), "x-"));
// expects "not a repository"
execFileSync("git", ["rev-parse", "--absolute-git-dir"], { cwd: dir });
```

| Where it runs | Outcome |
|---|---|
| `npx vitest run`, `TMPDIR=/tmp` | **pass** |
| `npx vitest run`, `TMPDIR=<common-dir>/squeal/tmp/x` | **fail**: `expected '/home/agent/projects/squeal/.git\n' to be 'NOT A REPO'` |
| a real `squeal daemon` on a linked fixture worktree (baseline) | **fail**, stored as the result |

Inside that directory, `git status` fails with "this operation must be run in a work tree". Any upward search from a temp directory now reaches the main checkout: `package.json`, `tsconfig.json`, linter configs and `node_modules`. I did not prove the search case on a fixture that has `node_modules` in the main checkout.

This breaks goal 3 ("Everything the agent is told is true"). D11's "inherits the environment of the hook that started it with no additions" is there so the daemon runs what the agent would run. The agent is told `PASS -> FAIL` for a test that passes when it runs the test itself. The FAIL is stored under the check's key and is inherited by every worktree with the same inputs (goal 4).

The location is the brief's choice and is written into D10, so the fix includes a spec amendment. The defect 13 goal needs only a temp directory outside the root and outside the spawner's `TMPDIR`. Nothing requires it inside the repository.

Fix (one worker, `scratch.ts`, `open.ts`, `test/daemon/scratch.test.ts`, D10):

- Move `tempDir` outside every repository. One option is `/tmp/squeal-<uid>/tmp/<worktree-hash>/`, beside the socket fallback in `paths.ts`, created private as `prepareSocketDir` does. That is also the `os.tmpdir()` a shell without `TMPDIR` gets on Linux.
- Keep emptying it under the lock.
- In `scratch.test.ts`, add a fixture test that asserts `git rev-parse` fails in `mkdtemp(tmpdir())`, run by a real daemon.
- Amend D10 and the `status.md` line.

### B2. A child process started inside a runner call pins the root after the daemon goes idle (proven for an esbuild plugin; the Vite 6 and 7 case is unverified)

`inRootWhileRunning` (`scratch.ts:57-69`) sets the daemon's working directory to the root for each runner call, creation included. A child process spawned during the call inherits that directory, and nothing moves it out afterwards.

esbuild records `process.cwd()` when its module loads (`esbuild/lib/main.js:2266`), then spawns its service there (`:2275`, `:2377`). The service lives as long as the process does.

Probe: a real `squeal daemon` on a linked fixture worktree, spawned with `cwd` = root and the caller's `TMPDIR`, with a `vitest.config.ts` plugin that calls `esbuild.transform` from its `transform` hook. After the baseline, and 5 s idle:

```
daemon cwd now  …/main/.git/squeal
held inside root/callerTmp  ["1866102 cwd …/linked"]
```

The same probe without the plugin holds nothing. Process 1866102 is the esbuild service, a child of the daemon. The row's own done-when check (`held(pid)` in `scratch.test.ts`) walks descendants, so it would fail on this fixture.

The plugin is not exotic. Vitest 5, Squeal's peer floor (`package.json`: `"vitest": ">=5"`), accepts `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`. Vite 6 and 7 transform TypeScript with esbuild (`vite:esbuild`), so on those projects every daemon's tree would pin its root. I did not run a Vite 6 or 7 fixture. That is the defect 13 harness case: a harness that refuses to remove a directory a live process holds. `git worktree remove` itself still succeeds, and the daemon then exits and takes the service with it. The `status.md` line "Deleting an idle daemon's root no longer needs `squeal stop` first" therefore holds for that kind of removal only.

Fix (one worker, `src/core/daemon/scratch.ts`, `runner.ts`, `test/daemon/scratch.test.ts`, D10): pick one, and amend D10 to match.

- **(a) Root only around `run`.** Hold the root as the working directory only around `run`, which is where Vitest forks its test workers. `open`, `invalidate`, `affected`, `closure`, `enumerate`, `testFiles` and `environment` then run in `scratch.workDir`. Instance creation would load the config and plugins with the scratch directory as working directory. A config that reads a relative path then differs from `vitest run`, so test that case before choosing this.
- **(b) Keep the design and narrow D10.** State that the daemon holds nothing in the root itself, and that a process the project's tools start during a runner call may hold it until the daemon exits. Add a test with the esbuild plugin that asserts `git worktree remove` succeeds and the daemon exits.

Option (a) closes defect 13 for Vite 6 and 7 projects; (b) does not. Either way, add the esbuild-plugin fixture to `scratch.test.ts`.

## Should-fix

- **S1** (proven). `<common-dir>/squeal/tmp/<hash>/` is emptied only when a daemon starts (`prepareScratch`), never on exit, and never for a worktree that no longer exists. After `squeal stop`, a marker file stayed. After `git worktree remove` and the daemon's exit, the directory and what a test left in it (`x-7rCDhb`) stayed. A retired worktree's leftovers stay in the main checkout's `.git` with nothing to reap them. Before this range they went to a `TMPDIR` its owner reaps. Fix: remove `tempDir` in `#shutdown` after `runner.close()` and before the lock release. If B1 moves the directory, this still applies.
- **S2.** D4 still gives CI figures "before rules 2 to 4" (`spec.md:75`). `reviews/wave-7.5.md` N3 asked for them to be replaced, and its fix-row inputs asked for the same. The local figures in D4 (`17 to 19 ms`) are also older than the `status.md` line's. Replace both with the 001-60 figures, plus CI figures from a run on `main` at or after `ae24aaf`.

## Nits

- **N1** (proven). A `package.json` `"main": "lib/"`, with a trailing slash, followed by the add of `lib/index.ts`: `affected` = [] and the run reads `index`, while a fresh instance reads the new file. `join(dir, "lib/")` keeps the slash, so it never equals the base `…/lib`. Normalise the trailing slash in `entryDirectories` (`stale.ts:486`).
- **N2.** The `exports` part of `packageEntries` and of D4's sentence covers a case Vite does not have. With `exports` present, Vite does not fall back to `index`; see the table above. Either drop it and say why in D4, or keep it and say that it is defensive.
- **N3.** The 001-60 `status.md` line says "wave 7.5". It is wave 7.6.
- **N4.** The 001-61 `status.md` line sits under "## Links" (`status.md:62`), after the 001-58 line, which was already misplaced there. Both belong in the amendment log above "## Research".
- **N5.** `scratch.test.ts` deletes the root with `rmSync`. The defect 13 harness runs `git worktree remove`, which also removes `<common-dir>/worktrees/<name>`. My probe shows that path works: `git status --ignored` lists only `node_modules/`, the remove succeeds without `--force`, and the daemon exits 0 after 1.0 to 1.2 s. A test would keep it working.
- **N6.** The brief's branch HEAD is `5d2d86d`, not the candidate `ae24aaf`. The difference is docs only.

## What fits (do not re-check)

- **`wave-7.5.md` B1 and B2.** Each has a test that asserts the run outcome, plus `affected` for B2. Each test fails with its fix reverted. D4 (3) names the virtual module, the inlined dependency and the `package.json` entry.
- **`package.json` entry forms.** `main` with or without an extension, with a TypeScript twin, and a nested ancestor `package.json` match a fresh instance. Conditional, sugar and array `exports` are not stale, because Vite does not fall back to `index` under `exports`.
- **Cost.** Dropping the `node_modules` skip and adding the ancestor walk added nothing measurable. `afterAdd` is within 1 to 3 ms of `afterEdit`, and the first `invalidate` is 18 to 21 ms.
- **`inRootWhileRunning` restore.** With overlapping calls, the working directory stays the root until the last call ends. A rejected call and a synchronous throw both restore `workDir`. There is one counter per daemon (`#run` builds the runner once).
- **No other `process.cwd()` readers.** No daemon path outside a runner call reads `process.cwd()` (`src/core`, `src/runners`). `runGit` always passes `cwd`. The watcher and reconciliation never see the switch.
- **Relative paths and `TMPDIR` in fork workers.** In a real spawned daemon, a test that reads `vitest.config.ts` relatively passes on the baseline and again after an edit. The worker's `process.cwd()` is the root, and `TMPDIR`, `TMP` and `os.tmpdir()` are the daemon's `tempDir` on both runs. Vitest rebuilds the worker env from `process.env` on each run, and forks are spawned per run.
- **Races for one worktree.** Three daemons started against a live one all exit 0 ("another daemon serves"), and a marker file in the winner's `tempDir` survives. `prepareScratch` runs only after the lock. Shutdown releases the lock after `runner.close()`, so a successor cannot empty a directory the old instance still uses.
- **Idle hold and removal.** With no long-lived child (B2), the idle daemon's tree holds nothing under the root or the caller's `TMPDIR`, and its working directory is `<common-dir>/squeal/`. `git worktree remove` succeeds without `squeal stop`, and the daemon exits 0.
- **`ensureDaemon` spawn.** The spawn's `cwd` is the store directory, and the socket path is derived from the environment before `adoptScratch` changes it.

## Inputs for the next wave

1. **001-61 fix row (B1, B2, S1, N4, N5)**. It owns `src/core/daemon/scratch.ts`, `open.ts`, `daemon.ts` (shutdown only), `runner.ts`, `test/daemon/scratch.test.ts`, D10 and one `status.md` line.
   - B1: move `tempDir` outside every repository, created private and emptied under the lock. Test with a real daemon that `git rev-parse` fails in `mkdtemp(os.tmpdir())`.
   - B2: choose (a) or (b) above and amend D10. Add the esbuild-plugin fixture, asserting either that nothing is held while idle (a) or that removal and exit work (b).
   - S1: remove `tempDir` at shutdown, after `runner.close()` and before the lock release.
   - N5: run `git worktree remove` in the test, not `rmSync`.
   - Budget: the daemon is still ready within the hooks' spawn budget, so no new work before the socket is up. The full suite passes.
2. **001-60 tidy (S2, N1, N2, N3)**, docs and a one-line `stale.ts` change. Its own row, or folded into the coordinator's next docs commit. If the human buys no fourth round for this slice, S2 and N3 are docs only, and N1 is a nit.
3. **Carried, not this slice.** `wave-7.5.md` N1 (an edited `package.json` re-points its directory) fits the N1 change above. `wave-7.5.md` N2 (concatenated dynamic imports) and N5 (the closure gap at virtual ids and `node_modules`) need a spec decision first. `wave-7.5.md` N4 waits on 001-54, and N7 (the flaky `waiter.test.ts` bound) is outside this slice.
