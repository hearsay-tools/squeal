# 011-141: tests that build the CLI or a bundle key what their build compiled

Worker b5d1bbdc, wave 23 W3, from `int/w22` at 016013a6b (0.1.275 candidate), 2026-10-23. Research: `research/cli-build-inputs.md` (row 011-127), option B, with the build tests in the slow lane (the coordinator's choice under the human's word for repository-local choices).

## What changed

Test code, `squeal.config.json`, and the return value of two build functions in `src/harness/`. No store, key or recorder change, no `KEY_FORMAT_VERSION` or `RECORDER_VERSION` raise (011 C3: a change to what a key is computed from re-keys the affected checks by itself).

- `test/helpers/build-inputs.ts` (new): `observeBuildInputs` stats each listed path that is a file in the worktree outside `node_modules` and returns them relative, sorted; `observeMetafile` does it for esbuild's `metafile.inputs`; `tscObserved` runs `tsc` with `--listFiles` and stats what it printed. It stats also when `tsc` fails: `tsc` 7 prints the list beside its errors (exit 2, checked on a scratch project), so the edit that fixes a type error re-keys the test. The module imports nothing from `src/`, so a run under the recorder observes only what it stats.
- `buildCli` (`test/daemon/helpers.ts`) builds through `tscObserved`. Its `BuiltCli` type is unchanged.
- `buildDist` (`src/harness/build.ts`) and `buildOpencodeDist` (`src/harness/opencode/build.ts`) return their esbuild metafile (`Promise<Metafile>`, built with `metafile: true`); `buildOpencodeDist` returns its two builds' metafiles as one. The coordinator gave the row these two files for this change only, in place of a first version that copied both builders into `test/harness/bundle-helpers.ts`. The emitted bundles do not change: the Claude Code, Codex, OpenCode and Pi drift tests pass against the committed `dist`. `buildCodexBundles`, `buildOpencodeBundles` and `buildPiBundles` stat what they return, as do `pytest-bundle`, `plugin-data-claude-code` and `symlinked-source`.
- Direct esbuild callers stat their metafile: `ps-bundle.test.ts`, `codex/cache-fixture.ts`, `graph-bundle.test.ts`, and `bundleModule` in `test/keys/validity/bundle.ts` (for `lock.test.ts` and the other validity files; another tree's files lie outside the worktree and are not recorded).
- `squeal.config.json`: `slow.include` lists the 59 files of `research/probes/cli-build-inputs/gap.txt` and the new `test/helpers/build-inputs.test.ts`, by glob where a glob selects only build tests (`busy-*`, `died*`, `handover*`, `restart-handover*`, `scratch*`, `start-*`, `step-down*`, `symlinked-*`, `test/integration/pi-*`, and a brace list for five `opencode-*` files, since `opencode-fixture.test.ts` builds nothing). 42 entries select exactly those 60 files.

## Tests

- `test/helpers/build-inputs.test.ts`: a nested Vitest runs two fixtures (`test/fixtures/build-inputs/`) under the real recorder, as Squeal runs a test file. `cli.fixture.ts` builds through `suiteCli` in `beforeAll`, as the daemon tests do; `bundle.fixture.ts` through `buildPiBundles`. Each fixture's recorded paths must hold every worktree file of an independent list: `tsc --listFilesOnly` (639 `src/` files at 016013a6b) and the metafile of the same Pi bundles built in memory. With `tscObserved` and the Pi helper returning without their stats, both cases fail (checked). The outer test stats what the nested run read, so it is keyed on that too.
- `test/policy/repository-inputs.test.ts`: the slow lane selects 60 files, each glob selects one, `busy-tier.test.ts` is in it and `drain-timers.test.ts` (in-process) is not. A new case gives `busy-tier.test.ts` the observed set `buildCli` reports (`tsc --listFilesOnly`, stat'ed in the mirror) and edits `src/core/scheduler/scheduler.ts`: `busy-tier` re-keys and `busy-store` (no observed build) does not. Without the observed set the case fails (checked).

## Seam map

- `tsc` callers: only `buildCli`. `suiteCli` and `daemonSuite` call it in `beforeAll`; `quietCli` builds nothing.
- esbuild callers: `buildDist` (through `buildCodexBundles`, `buildPiBundles`, and direct in four files), `buildOpencodeDist` (through `buildOpencodeBundles`), direct `build` in `ps-bundle`, `plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `codex/cache-fixture.ts`, `graph-bundle`, and `test/keys/validity/bundle.ts`. `plugin.test.ts`, `codex/plugin.test.ts` and `opencode/package.test.ts` declare `src/**/*.ts` and keep their direct calls (their `write: false` builds read only metafile outputs).
- The recorder wraps `statSync` (`src/runners/observe/fs.cjs`) and attributes in `beforeAll` by `__vitest_worker__.filepath`; observed sets merge across runs (`src/core/scheduler/observed.ts`), so a failing build never shrinks one.

## Measurement

(filled in below once the checkpoint and the edit run complete)

## Draft for spec 011 C12

In "Not seen, and left to `inputs` (D11)", after "what a non-Node child reads (a shell script's `cat`)": add ", such as a native builder (`tsc` 7, esbuild)". Then, after that list:

> A test that runs a native builder reports the builder's reads itself: it stats, from its own process, each file the builder lists (`tsc --listFiles`, esbuild's `metafile.inputs`), and the recorder keeps them as that test's observed inputs. In this repository the build helpers do it (`buildCli`, the bundle helpers; row 011-141), so a `src/` edit re-keys every test whose build compiled the file, and those tests run in the slow lane (004 D7).

Under Testing, beside the recorder's tests: "a test file that builds the CLI or a bundle observes every file its builder lists (`test/helpers/build-inputs.test.ts`, under the real recorder)".

## Open

- The other 20 build tests stay in the fast lane, the coordinator's decision of 2026-10-23 (the row is the 59 files whose keys missed what they build): `test/harness/codex/**` (8), `test/harness/opencode/**` (4), `test/harness/pi/**` (3) and `test/harness/plugin.test.ts`, which declare `src/**/*.ts` (row 001-399), and `test/keys/key-format.test.ts` with the validity `adapters`, `compare` and `reach` tests, whose static closure holds their bundle.
- The reverted 011-126 slice of the research (69a6c09b2) no longer reverses at 016013a6b. The edit used here is 92b38a0f6 reversed, the research's measured `scheduler.ts` edit, also an 011-126 slice.
