# Issue 33: does a declaration rebuild invalidate checks that never loaded it?

Researcher, 2026-10-18, 20-minute time box, documentation only. Issue: hearsay-tools/squeal#33 (read with `gh issue view 33 -R hearsay-tools/squeal`). Specs read: 011 C2, C3, C4, C6, C12, C14 and 013 V5 at `905b7b6c`.

Versions: installed Squeal **0.1.199** (`squeal --version`, plugin `squeal@hearsay` 0.1.199, git sha `e36fea56`), source at `905b7b6c` compared with tag `squeal--v0.1.199`; Vitest 4.1.10 (from the local cezarion checkout's `node_modules`, symlinked into the probe); cezarion read at local `82f97570c` (2026-10-16) and remote `main` `463a5bf01` (2026-10-18T06:51Z) through `gh api`.

Host load: one-minute load 7.12 on 24 CPUs at the start (08:57), 3.0 to 6.3 during the probes, 4.0 at the end; below the CPU count throughout, so the live probe ran.

## Verdict

**Not reproduced; the issue's premise is likely wrong in one part.** Rewriting a git-ignored `.d.ts` that no test loads, during a running check, invalidated nothing under 0.1.199 (verified by experiment). The UNKNOWN reason the issue quotes is emitted only for a file Vite's plugin container loaded (read in source code), and Vite does not load a `.d.ts` a test never imports. In cezarion `main`, `npm run typecheck` does not rebuild declarations only: `packages/web`'s `pretypecheck` runs `npm run build -w @wjarka/cezarion`, whose `build` is a plain `tsc`, which rewrites the server's `dist/*.js` as well as `dist/*.d.ts` (read in source code). So the file that moved was most likely a `dist/*.js` some test in the run loaded, and the breadth (147 checks in unrelated files) fits the adapter's rule that a moved file no test file's module graph reaches drops **every** file of the run (inferred). Which path moved is not determined: the reason text names it, and the issue does not quote it.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does an unrelated declaration rewrite invalidate a running check? | No, under 0.1.199, for a git-ignored `dist/lib.d.ts` no test imports (probe A). | verified by experiment (0.1.199) |
| 2 | Which inputs can produce "changed on disk after this run loaded it"? | Only loaded inputs: a project file Vite's plugin container loaded (stamped), or a cached module with no stamp. Static closure and declared inputs reach invalidation through revisions, not this reason. | read in source code (`905b7b6c`, same logic at 0.1.199) |
| 3 | Why would files that do not import the moved path be dropped? | `mayHaveRun`: a stale file no test file of the run reaches in its project's module graph taints every file of the run. 013 V5 states this rule ("all of the run's files when none imports it in the module graph (a computed `import()`)"). | read in source code; read in spec |
| 4 | Does the cezarion typecheck rewrite only declarations? | No. `packages/web` `pretypecheck` = `npm run build -w @wjarka/cezarion` = `tsc`, emitting `dist/*.js` and `.d.ts`. | read in source code (cezarion `main` `463a5bf01`) |
| 5 | Does the UNKNOWN reason name the changed file? | Yes, in both versions. 0.1.199: `vitest adapter: <paths> changed on disk after this run loaded it; …`; HEAD (gh-13, `88ccff4c`): the reason first, then the paths. | read in source code |
| 6 | Shared environment as a cause? | Not determined, because the probe's environment never moved and the real run's reason was not available. The reason quoted is the 001-146 stamp reason, not an environment-hash change. | inferred |
| 7 | 0.1.199 against current source | `sources.ts` and `worktree-paths.ts` unchanged; `moved.ts` changed only in reason wording (`88ccff4c`, gh-13) and in `aa260ef0` (011-06 touch re-queue). Same invalidation logic. | read in source code |

## Findings

**Probe (verified by experiment, 0.1.199).** A throwaway git repo under `/tmp/issue33.suGY/repo` (fixture copied under `probes/issue-33/fixture/`, every file suffixed `.txt`), `HOME` and `XDG_*` pointed at `/tmp/issue33.suGY/home` with only the `squeal@hearsay` entry of `installed_plugins.json` copied in, so nothing reached the real HOME's store. `squeal init`, `squeal start`, then `probe.sh <label> <path>`: edit `src/lib.ts` (in all three test files' closures) to start a run of three 8-second tests, rewrite `<path>` three seconds in, `squeal status --wait 90000`; `runlog.sh <rev>` prints each run's `report.json` `failure`, completed and withheld files.

| Probe | Path rewritten mid-run | Loaded how | Result |
|---|---|---|---|
| A | `dist/lib.d.ts` (git-ignored) | never | no revision, run stored, `failure: null` |
| B | `src/lib.ts` (tracked) | static import, all three | revision 4; the run was superseded by key and re-run, no stamp reason |
| C | `dist/gen.js` (git-ignored) | static import from `slow1` only | revision 7 (the path is in `slow1`'s key); only `slow1` re-run, `slow2`/`slow3` stored |
| D | `dist/dyn.js` (git-ignored) | computed `import()` in `slow3` | no revision, `failure: null`, all stored |
| E | `src/gen/dyn.ts` (git-ignored) | computed `import()` in `slow3` | no revision, `failure: null`, all stored |

D and E did not fire the 001-146 reason either, so the probe never produced the issue's UNKNOWN and could not exercise the all-files fallback. That D and E stored a result whose test executed bytes since rewritten is outside this issue's question and was not chased (time box).

**Source (read in source code, `905b7b6c`).** `src/runners/vitest/moved.ts` `withoutFiles` builds the quoted reason from `stale`; `src/runners/vitest/adapter.ts:443-486` computes `moved` from `#invalidateStale(vitest, loadedSince)` plus `#unsure` and passes `mayHaveRun(vitest, moved, testFiles, paths)`. `src/runners/vitest/sources.ts` `stale()` checks every cached module of every environment against its container stamp; "a cached module with no stamp is stale, whenever it was read". `cachedModules` keeps any ID `sourceOf` maps to a project file, and `src/core/fs/worktree-paths.ts` `isProjectFile` excludes only paths outside the root or under `node_modules`: git-ignored `dist/` is a project file. `mayHaveRun` walks `moduleGraph.getModulesByFile(file)` importers up to a test file; when no test file is reached, `reached.length > 0 ? reached : testFiles` drops all. `invalidateStale` calls `vitest.invalidateFile` before that walk.

**Cezarion (read in source code).** Local `82f97570c`: `harness-autosave-settlement.test.ts` imports only `../git-worktree.ts`, `../runs/store.ts`, `../workflows/run.ts` and testkits, and spawns child processes; `waits-parity.test.ts` is not in that checkout. Root `typecheck` runs web, contract, client, server; only `packages/web/package.json` has `pretypecheck`. Root `.gitignore` has `dist/`.

## Recommendation for Squeal

Get the reason text of one dropped run from the reporter (`squeal why <check>` or the run's `report.json` under `.git/squeal/runs/`) before designing: it names the moved paths in both versions. If they are `packages/cezar/dist/*.js`, the question becomes which test loads them through Vite and why the module graph did not connect it to the dropped files (a computed import, or an edge lost by the runner part's mid-run invalidation, 013 V7), not whether declarations count. The issue's expectation "invalidation follows what the run actually loaded" is already the rule for this reason; its weak point is the all-files fallback, which a spec could narrow, for example to the files that were running when the module was loaded.

## Open questions

- Which paths did the real reason name? Decides between "a loaded `dist/*.js`" (inferred) and something unexpected loading a `.d.ts`.
- Which cezarion test loads `packages/cezar/dist` through Vite (the local grep found ten test files mentioning `dist/` or `.d.ts`, e.g. `pack-check.test.ts`, `release/snapshot.test.ts`; not read further)?
- Did cezarion's daemon run with `observe.runtimeInputs` on (011 C12)? Not determined, because its `squeal.config.json` was not read.
- Why D and E fired no stamp reason in the probe (Vitest externalizing, or a timing in `stale(loadedSince)`): not determined in the time box.

## Limitations

One host, one synthetic repo, three tests, one Vitest project, Vitest 4.1.10, only 0.1.199 run (HEAD compared by reading). No cezarion run was reproduced; no repository gates ran (docs-only brief). The probe used the cezarion checkout's `node_modules` through a symlink, read-only.

## Sources

- hearsay-tools/squeal#33, `gh issue view 33 -R hearsay-tools/squeal`.
- `docs/specifications/011-core/spec.md` C2-C4, C6, C12, C14; `docs/specifications/013-vitest-runner/spec.md` V5, V7.
- `src/runners/vitest/moved.ts`, `src/runners/vitest/sources.ts:208-391`, `src/runners/vitest/adapter.ts:440-490`, `src/core/fs/worktree-paths.ts:24`; `git diff squeal--v0.1.199 HEAD -- src/runners/vitest/moved.ts`; commits `88ccff4c`, `aa260ef0`.
- https://github.com/hearsay-tools/cezarion `main` `463a5bf01`: `package.json`, `packages/cezar/package.json` (`"build": "tsc"`), `packages/web/package.json` (`"pretypecheck": "npm run build -w @wjarka/cezarion"`), read with `gh api repos/hearsay-tools/cezarion/contents/<path>`.
- Probe: `docs/specifications/011-core/research/probes/issue-33/` (`README.md`, `probe.sh`, `runlog.sh`, `fixture/`).
