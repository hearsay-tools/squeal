# 011-127: what keys a test that builds the CLI at run time

Researcher for wave 21 R1, 2026-10-23. Brief: `cli-build-inputs-brief.md`. Probes and raw results: `probes/cli-build-inputs/`. Everything was measured on a scratch clone of main at 7580d1a1d (0.1.273) under `/tmp/r127`, with a scratch daemon from the clone's committed `plugins/claude-code/dist/cli/squeal.mjs` (0.1.273), host slots 4, on this 24-CPU host. Load is the one-minute average.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Which files | 79 files build while they run: 45 through `tsc -p tsconfig.build.json` (`buildCli`), 34 through esbuild. 59 of them have a key that lacks `src/` files their build holds: `test/daemon` 41, `test/cli` 4, `test/harness` 9, `test/integration` 3, `test/keys/validity/lock.test.ts`, `test/runners/node-test/graph-bundle.test.ts`. | verified by experiment |
| 2 | What their key holds | The static closure, plus observed paths that do not include what the builder read. The builders are native binaries that the recorder does not follow. `busy-tier.test.ts` keys 40 of the 595 `src/` files its build compiles. A reverted 011-126 slice read as a current pass in Squeal, and `vitest run` failed it. | verified by experiment |
| 3 | Option A cost | For the `scheduler.ts` edit, A adds 52 files: 1,397 s summed and 607 s wall at 4 workers (load 19 to 97). For the `standing.ts` edit, A adds 23 files: 658 s summed. The whole run was 555 files, 4,514 s summed and 1,498 s wall (load 21 to 48). | verified by experiment |
| 4 | Option B | Yes, and with no product change. A test that stats each file its builder lists gets those files into its observed set through C12 as it is. Seam: the build helpers. No store or key change, no `KEY_FORMAT_VERSION` or `RECORDER_VERSION` raise. Its cost per edit equals A's. | verified by experiment |
| 5 | Other options | A static import of `src/cli/main.ts` (about +5 s per file). The 001-399 middle row (it misses `scheduler.ts`). Caching the build (saves 3.7 s CPU per build and fixes no key). The slow lane (moves the cost and does not remove it). | verified by experiment / inferred |
| 6 | Recommendation | B, then A, then C. For the 45 `tsc` files, B and A re-run the same files on each edit. B covers new build tests without a list to maintain, and is exact for the esbuild bundles. | inferred |

## Findings

**Q1. Which files** (verified by experiment). One plain `vitest run` of the clone at 4 workers recorded each builder call with the test file that made it (`patch-builders.mjs`, `census.txt`). The run took 16 min 44 s wall at load 3 to 17, with 928 files and no failures. The builders:

- `tsc -p tsconfig.build.json` into a private `dist` (`buildCli` in `test/daemon/helpers.ts:64`, through `daemonSuite` and `suiteCli`): 41 `test/daemon` files, the 4 `test/cli` daemon files, and `test/harness/hung-daemon.test.ts`. It compiles every non-test `src/` file (595, `tsc --listFiles`). The CLI entry's esbuild graph holds 480 of them; the other 115 are `src/harness/**` (100), type-only files and the two other entries (`cli-reach.json`). `quietCli` builds nothing: it writes a stub (`test/harness/bundle-helpers.ts:96`).
- esbuild with the plugins' `bundleOptions` (`buildCodexBundles`, `buildOpencodeBundles`, `buildPiBundles`, `buildDist` in `src/harness/build.ts`, direct `build` calls): 25 `test/harness` files and the 3 `test/integration/pi-*` files. The validity bundles (`test/keys/validity/bundle.ts`, entry `driver.ts` and `entries/*`) serve `key-format.test.ts` and 4 validity files. `graph-bundle.test.ts` bundles `src/runners/node-test/graph/index.ts`.

The board row's count differs. `test/keys/validity` has 6 test files, not 12, and 4 of them build. `coverage.test.ts` and `pytest.test.ts` call no builder in a full run. No `test/store` file builds. All 3 `test/integration/pi-*` files build. The 9 harness files are new to the row: the 5 `test/harness/opencode-*.test.ts` files, `plugin-data-claude-code`, `ps-bundle`, `pytest-bundle` and `hung-daemon`. The `test/harness/opencode/**` and `test/harness/pi/**` globs do not match them.

**Q2. What their key holds** (verified by experiment, `gap.txt`). The scratch daemon's baseline completed all 928 files in 24 min 30 s (load 15 to 51). Its store gave, per build file, the closure, the observed set (`observed.` meta) and the declared inputs. One sample per directory (counts of `src/` files):

| File | Build holds | Static closure | Observed | Declared | Not keyed |
| --- | --- | --- | --- | --- | --- |
| `test/daemon/busy-tier.test.ts` | 595 (`tsc`) | 40 | 0 | none | 555 |
| `test/cli/run-all-verdict-daemon.test.ts` | 595 | 40 | 0 | none | 555 |
| `test/cli/warmup.test.ts` | 595 | 483 | 4 | none | 116 (1 the CLI can load) |
| `test/harness/opencode-hooks.test.ts` | 524 (esbuild) | 101 | 13 | none | 439 |
| `test/integration/pi-wake.test.ts` | 509 | 103 | 13 | none | 422 |
| `test/keys/validity/lock.test.ts` | 212 | 30 | 18 | none | 197 |
| `test/runners/node-test/graph-bundle.test.ts` | 20 | 17 | 1 | `graph/**`, `build.ts` | 8 |
| `test/keys/key-format.test.ts` | 212 | 242 | 28 | none | 0 |
| `test/harness/opencode/bundle.test.ts` | 524 | 608 | 13 | `src/**/*.ts` | 0 |

`busy-tier`'s observed set holds 24 other paths: `tsconfig.build.json` and `tsconfig.json`, `package.json`, `long-writer.ts`, `stall-preload.mjs`, and manifest lookups such as `deno.json` and `lerna.json`. The recorder keeps a spawn's file arguments, so `tsconfig.build.json` enters. It sees nothing that `tsc` reads. TypeScript 7.0.2's `bin/tsc` `execve`s the native `@typescript/typescript-linux-x64` binary (`node_modules/typescript/lib/tsc.js`). esbuild's service is a native binary too. C12 already names this limit: "Not seen ... what a non-Node child reads" (read in source code; spec 011 C12). `tsx` children are Node and are observed: `shared-store.test.ts` observes 350 `src/` files.

The 20 files without a gap either declare `src/**/*.ts` (16) or import their bundle's entry statically (`driver.ts`: `key-format`, `adapters`, `compare`, `reach`). Of the 59, 52 lack `src/core/scheduler/scheduler.ts` and 23 lack `src/core/status/standing.ts`.

The stale pass, reproduced: in the clone, `scheduler.ts` and `busy-resume.ts` were set back to 69a6c09b2^ (the 011-126 slice undone; `tsc --noEmit` clean). `squeal status test/daemon/busy-tier.test.ts` said `1 pass ... each with a current result` at revision 3. `npx vitest run test/daemon/busy-tier.test.ts` on the same tree failed: "stalls [... {"ms":9449}] ... expected [...] to deeply equal []". This is the 2026-10-23 sighting.

**Q3. Option A, measured** (verified by experiment; `measure.log`, `runs.json`, `option-a-added.txt`). Option A declares `src/**/*.ts` for the 59 files (`option-a.config.json`). Each edit applies a commit's `src/` diff reversed, then `squeal run --all --wait`. The added share is the gap files whose current key lacks the edited file.

| Run | Files run | Summed | Wall | Load (1-min) |
| --- | --- | --- | --- | --- |
| Current config, 011-126 edit (92b38a0f6, `scheduler.ts`) | 310, 22 of the 59 | 2,659 s | 790 s | 19 to 46 |
| Option A adopted (config change) | 66 | n/a | 532 s | 13 to 37 |
| Option A, same edit (other files already stored at their keys) | 65, all 59 | 1,586 s; A's added 52: 1,397 s | 617 s | 19 to 97 |
| Option A, 011-124 edit (761090640, `standing.ts`) | 555 | 4,514 s; A's added 23: 658 s | 1,498 s | 21 to 48 |

For the scheduler edit, A adds 52 % to the summed test time and about 10 minutes of wall to a worker's `run --all --wait`. For the status edit, it adds 17 %. `test/daemon/hold.test.ts` (273 s at load 3 to 17, 280 to 295 s here) is about a fifth of what A adds. At the census's low load, the 59 files sum to 957 s. Over the 1,335 `src/**/*.ts` commits since 2026-10-01 (about 70 a day), 1,322 left at least one of the 59 keyed short. That is a mean of 42 files and 722 s of census time per commit (inferred: closures at 7580d1a1d against each commit's files, `exposure.txt`). Option A re-runs all 59 on every `src/` commit, so this is its cost per commit. During the A edit run, `busy-edit.test.ts` failed its 1,000 ms bound (4,632 ms) at 1.93 load per CPU: a load failure, not the edit.

**Q4. Option B: the run reports the bundle's inputs** (verified by experiment). The seam is test code, not the recorder. The recorder keeps the paths a Vitest worker stats or reads (C12). Reads in `beforeAll` are attributed to the file: `buildCli`'s `copyFileSync` of `package.json` is in each daemon test's observed set. A probe test built as `buildCli` does with `--listFiles`, then stat'ed each `src/` path it printed (`option-b.probe.test.ts.txt`). After one run, its observed set held all 595. An edit to `src/cli/ps-index.ts`, outside its static closure, made it pending and re-ran it. `busy-tier.test.ts` stayed current through the same edit. For esbuild, the helpers pass `metafile: true` and stat `Object.keys(metafile.inputs)` (`ps-bundle.test.ts` already reads a `Metafile`). Change sites: `buildCli` (`test/daemon/helpers.ts:64`), `buildCodexBundles`, `buildOpencodeBundles` and `buildPiBundles` in the test helpers, `buildDist` or a wrapper around it, `test/keys/validity/bundle.ts`, and `graph-bundle.test.ts`. No store, key or recorder change. C3 says a change to what a key is computed from "re-keys the affected checks by itself and moves nothing", so neither `KEY_FORMAT_VERSION` nor `RECORDER_VERSION` moves (read in source code; spec 011 C3). The alternative is to teach the recorder about `tsc` and esbuild. That would change what the recorder observes and needs a `RECORDER_VERSION` raise under C3, and it gains nothing over the helper (inferred). Each file runs once more on its first observation (C12). B's re-run set for the `tsc` files equals A's, because `tsc` lists every non-test `src/` file. To narrow it, `buildCli` can stat the CLI's esbuild graph (480 files) instead. The 112 commits that touched only `src/harness/**` (8 %) then leave the daemon tests alone. A type error in an unloaded file still fails `tsc` in those tests, and the typecheck gate also reports it (inferred).

**Q5. Other options.**
- C, a static import of `src/cli/main.ts` in `test/daemon/helpers.ts`. `test/cli/remove.test.ts` does this and lacks only 1 of the 480 loadable files (verified by experiment). A one-file Vitest run with that import took 5.8 to 6.7 s wall against 0.7 to 0.8 s without it (3.4 to 3.6 s user), 88 to 91 % of it transform, at load 25 to 30 (verified by experiment). Inside one tier, the transform cache is shared, so 5 s is an upper bound (inferred). The import also evaluates the CLI's modules in every test worker.
- The 001-399 middle row (`src/core/daemon/**`, `daemon-loop/**`, three `src/cli` files). 236 of the 1,335 commits (18 %) touch it, but it does not hold `src/core/scheduler/scheduler.ts`. It would not have caught the 2026-10-23 sighting (verified by experiment against history).
- Caching the built `dist` by a hash of its inputs. One `tsc` build costs 0.68 s wall and 3.7 s CPU (verified by experiment). There are 45 builds per full run, so about 170 s CPU. It fixes no key (inferred).
- `slow.include` for the 59 files. `run --all` covers both lanes (`squeal run --help`), so a worker's verdict still waits for them. The re-runs move behind the load guard and off the fast lane (inferred, not measured).

## Recommendation for Squeal

1. **B: the build helpers stat what their builder lists.** It is exact for every builder and covers a new build test that uses the helpers, with no list to keep. It is test-only and needs no format raise. Cost per edit: the same as A, measured above, less the `src/harness/**` edits if `buildCli` stats the CLI graph. Spec: a note under 011 C12's "Not seen" list (a native builder's reads are reported by the test that ran it) and under "Testing". Regression test: `buildCli` under the recorder records every `src/` file `tsc --listFiles` names. Also a `test/policy/repository-inputs.test.ts` case: an edit to `src/core/scheduler/scheduler.ts` re-keys `test/daemon/busy-tier.test.ts`.
2. **A: declare `src/**/*.ts` for the 59 files.** It is as correct today, at the same cost, but a new build test is uncovered until someone lists it. A directory glob such as `test/daemon/**` would also re-key the 49 in-process daemon files that do not build. Spec: none (C3's declared inputs). Regression test: the same `repository-inputs` case.
3. **C: a static import of the CLI entry.** It is correct for code the CLI loads and costs up to 5 s more per file run.
4. **Keep the 001-399 middle row or the status quo:** rejected. The middle row misses the case that happened, and the status quo leaves stale passes, now reproduced.

Whatever the choice, every `src/` edit then re-runs about 59 files that take 10 to 20 s each, and `hold.test.ts` takes 4 to 5 min. Shortening `hold.test.ts` is the cheapest single cut in that cost.

## Open questions

- Not determined: the wall time A adds to the `standing.ts` edit alone. That run mixed the added files with 532 others.
- Not determined: how much of the 5 s cost of option C a full tier shares. Only one-file runs were timed.
- For the human: is the A/B cost (about 600 s of wall at 4 workers for a central edit under load) acceptable for every worker's `run --all --wait`, or should these files move to the slow lane?
- Outside this row: the validity tests also read the last release from `git archive` of a tag. No path keys a moved tag.

## Sources

- Repository at 7580d1a1d: `test/daemon/helpers.ts:64` (`buildCli`), `test/harness/bundle-helpers.ts:96` (`quietCli`), `test/keys/validity/bundle.ts`, `test/keys/validity/driver.ts`, `squeal.config.json`, `src/core/scheduler/observed.ts`, `src/core/keys/observed.ts`, `src/core/store/schema.ts`.
- Spec 011 `spec.md` C3 (key format version, closure) and C12 (runtime-input recorder); 001 `tasks/001-399/notes.md`.
- `node_modules/typescript` 7.0.2: `lib/tsc.js`, `lib/getExePath.js`; esbuild 0.28.2 `lib/main.js`.
- Commits used as edits: 92b38a0f6, 761090640, 69a6c09b2.
- Probes and results: `probes/cli-build-inputs/` (README lists each file).
