# 011-141: tests that build the CLI or a bundle key what their build compiled

Worker b5d1bbdc, wave 23 W3, from `int/w22` at 016013a6b (0.1.275 candidate), 2026-10-23. Research: `research/cli-build-inputs.md` (row 011-127), option B. The brief put the build tests in the slow lane; after the measurement below, the coordinator chose the fast lane (2026-10-23, a repository-local choice), so they run in the fast lane.

## What changed

Test code, `squeal.config.json`, and the return value of two build functions in `src/harness/`. No store, key or recorder change, no `KEY_FORMAT_VERSION` or `RECORDER_VERSION` raise (011 C3: a change to what a key is computed from re-keys the affected checks by itself).

- `test/helpers/build-inputs.ts` (new): `observeBuildInputs` stats each listed path that is a file in the worktree outside `node_modules` and returns them relative, sorted; `observeMetafile` does it for esbuild's `metafile.inputs`; `tscObserved` runs `tsc` with `--listFiles` and stats what it printed. It stats also when `tsc` fails: `tsc` 7 prints the list beside its errors (exit 2, checked on a scratch project), so the edit that fixes a type error re-keys the test. The module imports nothing from `src/`, so a run under the recorder observes only what it stats.
- `buildCli` (`test/daemon/helpers.ts`) builds through `tscObserved`. Its `BuiltCli` type is unchanged.
- `buildDist` (`src/harness/build.ts`) and `buildOpencodeDist` (`src/harness/opencode/build.ts`) return their esbuild metafile (`Promise<Metafile>`, built with `metafile: true`); `buildOpencodeDist` returns its two builds' metafiles as one. The coordinator gave the row these two files for this change only, in place of a first version that copied both builders into `test/harness/bundle-helpers.ts`. The emitted bundles do not change: the Claude Code, Codex, OpenCode and Pi drift tests pass against the committed `dist`. `buildCodexBundles`, `buildOpencodeBundles` and `buildPiBundles` stat what they return, as do `pytest-bundle`, `plugin-data-claude-code` and `symlinked-source`.
- Direct esbuild callers stat their metafile: `ps-bundle.test.ts`, `codex/cache-fixture.ts`, `graph-bundle.test.ts`, and `bundleModule` in `test/keys/validity/bundle.ts` (for `lock.test.ts` and the other validity files; another tree's files lie outside the worktree and are not recorded).
- `squeal.config.json` declares no slow tier, as before the row. Commits 5e04db58e to a729ad4e3 listed the 59 files of `research/probes/cli-build-inputs/gap.txt` and the new test in `slow.include` (42 globs) for the measurement below; 6b4a31df1 took them out on the coordinator's decision.

## Tests

- `test/helpers/build-inputs.test.ts`: a nested Vitest runs two fixtures (`test/fixtures/build-inputs/`) under the real recorder, as Squeal runs a test file. `cli.fixture.ts` builds through `suiteCli` in `beforeAll`, as the daemon tests do; `bundle.fixture.ts` through `buildPiBundles`. Each fixture's recorded paths must hold every worktree file of an independent list: `tsc --listFilesOnly` (639 `src/` files at 016013a6b) and the metafile of the same Pi bundles built in memory. With `tscObserved` and the Pi helper returning without their stats, both cases fail (checked). The outer test stats what the nested run read, so it is keyed on that too.
- `test/policy/repository-inputs.test.ts`: the repository still declares nothing slow, so the build tests are fast-lane files. A new case gives `busy-tier.test.ts` the observed set `buildCli` reports (`tsc --listFilesOnly`, stat'ed in the mirror) and edits `src/core/scheduler/scheduler.ts`: `busy-tier` re-keys and `busy-store` (no observed build) does not. Without the observed set the case fails (checked).

## Seam map

- `tsc` callers: only `buildCli`. `suiteCli` and `daemonSuite` call it in `beforeAll`; `quietCli` builds nothing.
- esbuild callers: `buildDist` (through `buildCodexBundles`, `buildPiBundles`, and direct in four files), `buildOpencodeDist` (through `buildOpencodeBundles`), direct `build` in `ps-bundle`, `plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `codex/cache-fixture.ts`, `graph-bundle`, and `test/keys/validity/bundle.ts`. `plugin.test.ts`, `codex/plugin.test.ts` and `opencode/package.test.ts` declare `src/**/*.ts` and keep their direct calls (their `write: false` builds read only metafile outputs).
- The recorder wraps `statSync` (`src/runners/observe/fs.cjs`) and attributes in `beforeAll` by `__vitest_worker__.filepath`; observed sets merge across runs (`src/core/scheduler/observed.ts`), so a failing build never shrinks one.

## Measurement

This host, 24 CPUs, 2026-10-23, shared with the other coordinators' workers. Load is the one-minute average, sampled every 15 to 30 s by a poller of `squeal status` (`t/b5d1bbdc/poll.log`, scratch). `slow.maxLoadPerCpu` 1.0 means a load of 24, which the host stayed above throughout.

**The edit.** `git show 92b38a0f6 -- src/ | git apply -R` at 12:46:25 (load 41.8): the `scheduler.ts` edit the research measured, an 011-126 slice. The research's own reverted slice (69a6c09b2) no longer reverses at 016013a6b. The edit was measurement only, never committed, and checked out at 14:00:38. Right after it, `squeal status --wait 30000 test/daemon/busy-tier.test.ts` read "Pending (1): 1 slow, run after the fast tests": not current, where before this row it stayed current (research Q2). It re-keyed 364 of 934 files, 306 fast and 58 of the 60 slow ones; `graph-bundle` and `validity/lock` build nothing that holds `scheduler.ts`.

| Part of one `squeal run --all --wait` after the edit | Files | Wall | Load (min, median, max) |
| --- | --- | --- | --- |
| Fast lane, 12:47:04 to about 13:21 | 306 | about 34 min | 22, 48, 103 |
| Slow lane's load guard (D3), 13:21:18 to 13:31:19 | 0 | 10 min, its whole `slow.maxDeferMs` | 54, 70, 88 |
| Slow lane, one file at a time (D2 width under load), 13:31 to 14:00:32 | 58 | 29.5 min | 27, 52, 74 |
| Whole checkpoint | 364 | 4,408 s (73.5 min) | |

The slow lane waited for the per-user slot another worktree held in 9 of 112 samples (8 %). It took about 40 min from the end of the fast lane to the verdict.

An earlier run of all 60 slow files, after the `src/harness/build.ts` edit of f56e11f6b (checkpoint at df83ad165, 2,960 s for 61 files): guard 11:43 to 11:54, then 60 files serial 11:54 to 12:43 (49 min, load 26, 52.5, 94), waiting for the slot in 73 of 188 samples (39 %). About 60 min after the fast lane.

**The same files in a fast lane.** The 58 files with `flock … npx vitest run --maxWorkers=4` (the lock taken at 14:15:41): 557 s wall, 1,358 s summed, load 38, 58, 81. `hold.test.ts` took 279 s of it. The research measured option A at 607 s wall for 52 files at load 19 to 97, which agrees.

So, per `src/` checkpoint at about 2.2 per CPU: the slow lane adds about 40 to 60 min after the fast lane, the fast lane would add about 9 to 10 min of fast-lane wall (more where the files contend with the edit's other fast files). What the slow lane buys: an edit's own fast results never wait behind these 58. The repository-local levers are `slow.maxLoadPerCpu` (the guard's 10 min is spent on every pass here), `slow.maxDeferMs`, and the lane itself. Sent to the coordinator.

**Decision.** The coordinator, 2026-10-23: the fast lane. The slow lane added 40 to 60 min to a `src/` checkpoint (the 10 min guard, then one file at a time), the fast lane about 9 to 10 min, and the CPU per edit is the same in both, since `slow.trigger` is continuous. `slow.maxLoadPerCpu` and `slow.maxDeferMs` stay at their defaults. After the change (6b4a31df1), `squeal run --all --wait` completed at revision 29 with all 934 files current and the one known failure below.

**A failure seen on the way.** `test/harness/opencode-dispose.test.ts`, "serve: an abort of the new turn, then the old Stop's answer, stores nothing", misses its 2,000 ms idle deadline under load (+2,328, +2,116, +2,163 ms). It failed in the slow lane, in the direct run above, in W1's worktree (896f1939), and at the base 016013a6b in a scratch worktree (load 44, three attempts): not this row; the coordinator knows it as 008-38. A `squeal retry --reason load` is queued.

## Draft for spec 011 C12

In "Not seen, and left to `inputs` (D11)", after "what a non-Node child reads (a shell script's `cat`)": add ", such as a native builder (`tsc` 7, esbuild)". Then, after that list:

> A test that runs a native builder reports the builder's reads itself: it stats, from its own process, each file the builder lists (`tsc --listFiles`, esbuild's `metafile.inputs`), and the recorder keeps them as that test's observed inputs. In this repository the build helpers do it (`buildCli`, the bundle helpers; row 011-141), so a `src/` edit re-keys every test whose build compiled the file.

Under Testing, beside the recorder's tests: "a test file that builds the CLI or a bundle observes every file its builder lists (`test/helpers/build-inputs.test.ts`, under the real recorder)".

## Open

- All 79 build tests run in the fast lane: the 59 of this row and the 20 whose keys already held their build (`test/harness/codex/**`, `opencode/**`, `pi/**` and `plugin.test.ts` declare `src/**/*.ts`, row 001-399; `key-format` and the validity `adapters`, `compare` and `reach` tests import their bundle's entry).
- The reverted 011-126 slice of the research (69a6c09b2) no longer reverses at 016013a6b. The edit used here is 92b38a0f6 reversed, the research's measured `scheduler.ts` edit, also an 011-126 slice.
