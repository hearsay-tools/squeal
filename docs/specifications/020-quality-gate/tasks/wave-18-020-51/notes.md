# Row 020-51: one keying path for the gate and `ci export`

Worker 5192531d, wave 18, shape slice (a refactor). Base: main at `c5cefb465` (0.1.466, after 020-52).

## 1. The keying steps before this row, side by side

Line numbers are at the base commit. "Gate" is the stores lookup of `squeal code --base` (`openKeyer` and `keyFiles` in `src/core/code/gate/stored.ts`, `daemonAdapters` in `src/cli/code-gate-stored.ts`). "Export" is `squeal ci export` (`exportWith` and `keyFiles` in `src/core/ci/export.ts`, `daemonVitest` in `src/cli/ci-export.ts`).

| # | Step | Gate | Export |
| --- | --- | --- | --- |
| 1 | Adapters | `daemonAdapters` (`code-gate-stored.ts:171`): Vitest from `daemonVitestOptions` plus `cache: false` when `runsVitest`, then one node:test adapter per `policy.nodeTest` entry. A second set, beside the run's own adapters, in a temp dir `squeal-gate-keys-` | `daemonVitest` (`ci-export.ts:161`): Vitest from `daemonVitestOptions`, no `cache: false`. Opened after `partsRefusal` passes |
| 2 | Store | A scratch store in the temp dir (`stored.ts:250`) | The job's empty store, which the CLI opens (`ci-export.ts:82`) |
| 3 | Environments | Every adapter's `environment()`, before the store opens (`stored.ts:249`) | The runner's `environment()`, after `openDaemonKeys` (`export.ts:144`) |
| 4 | Observed seed | The `OBSERVED_META_KEYS` rows of each environment's project, copied from the repository's store (`copyMeta`, `stored.ts:253`, `:282`) | None |
| 5 | `openDaemonKeys` | `stored.ts:261` | `export.ts:143` |
| 6 | `setEnvironments` | `stored.ts:269` | `export.ts:145` |
| – | Reuse rule at the job | None | `environmentRefusal` (`export.ts:146`) |
| 7 | Which adapter lists a file | Map `testFileId` → adapter over every adapter's `testFiles()`, at open (`stored.ts:270`) | Set of the runner's `testFiles()`, in `keyFiles` (`export.ts:229`) |
| 8 | Closures | Per file: the listing adapter's `closure(ref)`, an error gives none; `setClosure` (`stored.ts:297`) | The same (`export.ts:232`); and a file `leftOut` names (`node:inspector`, D19.6) is counted `inspected` and not set |
| 9 | `trackUntracked` | `stored.ts:306` | `export.ts:244` |
| 10 | Observed growth | None | `partsReport` of the files keyed, then `beginRun`, `observedGrowth`, `addObserved`, `endRun`, `trackUntracked`, `writeSeen` (`export.ts:245-257`) |
| 11 | Read | `keys.index.key(ref)`; `loads` is the runner's closure paths, sorted (`stored.ts:309`) | `keys.index.key(ref)`, `keys.index.closure(ref)`, `keyPartsOf` (`export.ts:166`, `:179`) |
| 12 | Close | The keyer closes its adapters, the scratch store and the temp dir, at `keep` (`stored.ts:242`) | `ciExport` closes the runner; the CLI closes the store and the temp dir |

Steps 5, 6, 8 and 9 were the same code twice. The two fixes the brief names show the cost: `6d436384a` (020-10b) gave the gate's second adapters the base's `coverage.children`, the key's marker (D12.5), and `6d3ad0269` (020-17c) fixed `gatePlace` for a gate Vitest that already observes, so its adapter version ends with `+observe.<recorder>` as a daemon's does. The second fix is also why the gate's own Vitest can now key (section 3, difference 6).

## 2. The module's shape

New module: `src/core/scheduler/daemon-keying.ts`. It sits beside `openDaemonKeys` (`scheduler/daemon-keys.ts`), whose doc comment already names both readers. It imports nothing of `ci/` or `code/gate/`, so both readers import it with no cycle. Under `src/core/ci/` the gate would import CI code for a daemon concept.

- `openDaemonKeying(input)`: reads every adapter's environments; with `observedFrom`, copies the observed rows of those projects into `input.store`; then `openDaemonKeys` and `setEnvironments`. Input: `openDaemonKeys`' options, `adapters` (open; the caller closes them), optional `observedFrom` (a `Store`).
- `DaemonKeying`: `keys`, `hasher`, `environments`, and two steps:
  - `keyFiles(files, { leftOut? })`: steps 7 to 9. Reads which adapter lists each file once, at the first call. Asks the listing adapter for the closure of `{ project, path }` alone; skips a file no adapter lists or whose closure fails; counts a file `leftOut` names; `setClosure` for the rest; then `trackUntracked`. Returns the runner's closures by `testFileId` and the `leftOut` count. Generic over the reader's file type (`F extends TestFileRef`), so the export passes its `PartFile`s and its `leftOut` reads them.
  - `grow(report)`: step 10 after `partsReport`: `beginRun`, `observedGrowth`, `addObserved`, `endRun`, `trackUntracked`, `writeSeen`.

Why two steps and not one call: the export builds the report to grow from (`partsReport`) of the files `keyFiles` keyed, and it reads its keys only after the growth. The gate reads them after `keyFiles`. Each reader reads `keys.index` itself, at its own step.

Callers now:

| Reader | Calls |
| --- | --- |
| Gate, `gate/stored.ts` `openKeyer` | its own scratch store; `openDaemonKeying({ ..., adapters, observedFrom: main })`; `keyed(files)` is `keying.keyFiles(files)`, then `keys.index.key(ref)` and the sorted closure paths |
| Gate, `cli/code-gate-stored.ts` `collectWithStores` | hands the keys the adapters `collectEvidence` opens (`told`, `StoredOptions.runners`) |
| Export, `ci/export.ts` `exportWith` | `openDaemonKeying({ ...input, adapters: [runner] })`; `environmentRefusal(environments)`; `keying.keyFiles(passed, { leftOut })`; `partsReport`; `keying.grow(report)` |

## 3. Deliberate differences

| # | Difference | How it stays | Evidence |
| --- | --- | --- | --- |
| 1 | Observed rows. The gate starts from the observed rows the repository's daemons stored; the export from none, and grows them from its shards' reports. | Option `observedFrom` of `openDaemonKeying`; step `grow`, which only the export calls | Gate: `code-gate-stored.test.ts` "keys every test file as the daemon keyed it" (`test/reads.test.ts` reads a file outside its import graph). Export: `export.test.ts` (each file's closure holds its `data/*.txt`, keys equal the daemon's) |
| 2 | `node:inspector`. The export leaves out a file whose closure imports it beside a provider (D19.6), counted `inspector`. The gate has no such rule. | Option `leftOut` of `keyFiles` | `export-keys.test.ts` "leaves out a file whose closure imports node:inspector beside the project's provider" |
| 3 | Adapters. The gate keys with every adapter a daemon builds (Vitest and node:test); the export with Vitest only (018: only Vitest is supported in CI). | `adapters` is a list | `code-gate-keep-node-test.test.ts` (both node:test entries read from the stores); export tests |
| 4 | Input lists for certification (020-52's notes, section 3, difference 4). The gate certifies the runner's closure here plus `inputsOfReadsHere` (`parts.ts`); the export its keyed closure, grown by the shards' observed reads (`export-inputs.ts`). | Kept as each reader's. They are not equal by proof: the gate's `--parts` path keys nothing, and its reads come from git here, the export's from the shards. Neither file is this row's. | Unchanged tests of 020-52 |
| 5 | What the reader takes of a keyed file. The gate's `loads` are the runner's closure paths, sorted (D3); the export's closure is the keyed one (`keys.index.closure`), with what was observed (D2 bundle). | Each reader reads `keys.index` and the returned closures itself | `stored.test.ts`, `code-gate-stored.test.ts`; `export.test.ts` |
| 6 | Whose adapters. In a gate run, the keys now use the adapters the run opened; outside a run (`StoredFiles.keys`, which only tests call) they open `daemonAdapters` and close them. The export opens `daemonVitest`. | `StoredOptions.runners`; `storedFiles(..., runners)` | `code-gate-stored-adapters.test.ts` (new) |
| 7 | Store. The gate keys over a scratch store under `$TMPDIR`; the export over the job's empty store. | Both callers own their store; the module takes it | Existing tests |
| 8 | `cache: false`. The gate's `daemonAdapters` sets it; the export's `daemonVitest` does not. It does not enter a key: before this row the gate's adapters with `cache: false` gave the daemon's keys (`code-gate-stored.test.ts`). | Kept: the export runs no test, and `ci-export.ts`'s adapter is not keying logic | – |

Why the gate's own adapters key as a daemon's (difference 6). The keys open only when the stores are read (`storedFiles` is not `null`), at the first lookup, after `openRunners` opened every runner. Then:

- Coverage: the gate's runners always collect (`enabled: () => true`); `daemonAdapters` had `coverageOn(policy)`, which is true, since `storedFiles` is `null` otherwise. Both use `coverageProvider()`; the collector stops before any runner opens without one.
- `coverage.children`: both the base's (`options.children`), the key's marker (D12.5, fix `6d436384a`).
- Observing: the gate's Vitest observes when `keeping && policy.observe.runtimeInputs`; `keeping` is `options.ran !== undefined`, which `collectWithStores` sets exactly when the stores are read. `daemonVitestOptions` has `policy.observe.runtimeInputs`. Same adapter version, `+observe.<recorder>` (fix `6d3ad0269`).
- The rest: `cache: false` in both; the worktree's `vitest.exclude`, `excludeProjects`, `nodeTest` entries, `inputs` and `runner.tierSize` in both (`loadPolicy(root)` in the collector, `readPolicy(root)`, which is `loadPolicy(root).policy`, in `storedFiles`). The gate-only options (`note`, `fileStarted`, `teardown`, node:test `closures` and `slots`) are callbacks that no environment or closure holds. `timed`'s proxy passes every call but `run` through.

The CLI tests that read and keep at a daemon's keys are the proof that the keys did not move: `code-gate-stored.test.ts`, `code-gate-keep.test.ts`, `code-gate-keep-node-test.test.ts`, `code-gate-keep-grown*.test.ts`, `code-gate-keep-busy.test.ts`, `code-gate-keep-stop.test.ts`, and the new test, which reads the key of the kept file through `daemonAdapters`.

## 4. What changed inside, with no change in output

- Export: the runner's environments are read before `openDaemonKeys`, not after. Neither reads the other.
- Gate: the scratch store opens before the environments are read, not after; which adapter lists a file is read at the first `keyFiles`, not at open. Both still come before and after `setEnvironments` as before.
- Gate: an adapter is asked for the closure of a fresh `{ project, path }`, not the collector's ref object. The export always did so.
- Gate: `keyed` walks the given files and finds each closure by `testFileId`; before, it walked a map keyed by ref object. Same entries, same order.
- Gate run: one Vitest instance and one node:test adapter per entry, not two sets. It starts faster and holds less memory. The keys add no note of their own: the run's adapters already tell theirs through the gate's `note`.

## 5. Type changes

All additive.

- New: `src/core/scheduler/daemon-keying.ts` exports `DaemonKeyingInput`, `KeyFilesOptions<F>`, `KeyedFiles`, `DaemonKeying`, `openDaemonKeying`.
- `StoredOptions.runners?: () => readonly RunnerAdapter[]` (`gate/stored.ts`).
- `storedFiles(root, env, note, children?, runners?)` (`cli/code-gate-stored.ts`): a new optional last parameter.
- Not exported, changed: `ci/export.ts`'s private `keyFiles` takes a `DaemonKeying`; its closures are a `ReadonlyMap` (`keyPartsOf` takes one). `gate/stored.ts` no longer has the private `keyFiles` over `WorktreeKeys` or `copyMeta`.

## 6. Done-when mapped to tests

| Done-when | Evidence |
| --- | --- |
| Every existing gate-stored, export and `ci` test passes with no assertion changed | `git diff c5cefb465 -- test/` adds only `test/cli/code-gate-stored-adapters.test.ts`. Squeal at revision 11 (commit `67b24db18`): 346 affected test files selected, 342 pass, 4 known failures, which are the expected bundle drift (section 7). The selection holds every `test/ci/*`, `test/cli/ci-*`, `test/cli/code-gate*` and `test/code/gate/*` file that reads a changed file, among them `stored.test.ts`, `collect-stored.test.ts`, `code-gate-stored.test.ts`, `code-gate-keep*.test.ts`, `export*.test.ts`, `ci-export*.test.ts`. |
| Key-format and validity cases unchanged | No file under `test/keys/` or `src/core/keys/` changed; `KEY_FORMAT_VERSION` unchanged (`git diff c5cefb465 -- src/core/keys test/keys` is empty). None of these tests reads a changed file, so Squeal did not select them; read on request at revision 11: `test/keys/key-format.test.ts`, `test/keys/check-key.test.ts`, `test/keys/validity/{compare,approved,adapters}.test.ts` pass (Squeal ran the two it had no result for). |
| The same fixture gives byte-identical export output before and after | One-off comparison, section 7: the base's `export.ts` and `stored.ts` (copied beside the new ones for the run, then deleted) and the new code, on one recorded fixture in one process. Export bundle `encodeBundle` sha256 `e3c5728b2afe0d60eacd1b81924e515a6ef4adea64bc46a0ff3df9f4ce49048b`, 2563 bytes, both; counts and uncertified lists equal (5 files, 14 results, 1 failed). The gate's keys of 7 refs over a daemon's store equal, the unlisted one `null` in both. The script is `compare-before-after.test.ts.txt` in this folder. |
| A test shows the gate run opens one Vitest adapter | `test/cli/code-gate-stored-adapters.test.ts`: a run that keys and keeps a file opens one Vitest; the kept file is at the key `daemonAdapters` gives; the next run reads it from the stores and opens one Vitest. Red with the old wiring (the keys not given the run's adapters): `AssertionError: expected 2 to be 1`. |

## 7. Checks run and not run

Run, with their real results:

- `pnpm run lint` (`biome check .`): `Checked 3341 files in 955ms. No fixes applied.` (after `biome check --write` formatted one line of the new test; commit `6302427fb`).
- `pnpm run typecheck` (`tsrs --fast --noEmit`): no errors.
- `squeal status --wait 60000` over `src/core/scheduler/daemon-keying.ts`, `src/core/ci/export.ts`, `src/core/code/gate/stored.ts`, `src/cli/code-gate-stored.ts` and `test/cli/code-gate-stored-adapters.test.ts`, revision 11 (commit `67b24db18`): `Named test files at revision 11: 4 known failures: 4 tests; 346 test files, each with a current result`. So 342 pass and 4 fail, the four below. 450 worktree test files stay unknown (not in this selection).
- Known failures, all four expected and not fixed here: the bundle-drift tests `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts` (`cli/squeal.mjs differs from the build`). The wave forbids `pnpm run build` in a worker tree, and this row does not own `plugins/*/dist`; the coordinator rebuilds the bundles at integration.
- `squeal status --wait 60000` over the five key-format and validity test files above, revision 11: `no known failures; 5 test files, each with a current result`.
- Direct runs, outside Squeal, each for a reason:
  - The before/after comparison (`compare-before-after.test.ts.txt`): `node_modules/.bin/vitest run --root <scratch> --config <scratch>/vitest.config.mjs`, with the base's `export.ts` and `stored.ts` copied beside the new ones as `export-before.ts` and `stored-before.ts` for the run and deleted after it. `1 passed`; output in section 6. It is not a suite test: it needs the base's code.
  - The red check of the new test: `src/cli/code-gate-stored.ts` set back to `storedFiles(root, env, note, children)` for one run, then restored before the commit. `node_modules/.bin/vitest run test/cli/code-gate-stored-adapters.test.ts`: `AssertionError: expected 2 to be 1`, `Tests 1 failed (1)`. With the change, Squeal: pass (revision 9, 6.3 s; after the format fix, revision 15).

Not run: `pnpm run build` (wave rule); a full suite or `squeal run --all` (worker rule; CI runs the full suite); `test/e2e/**` (outside Squeal, and no row file is an e2e path).

## 8. For the next worker

- `daemonAdapters` now serves only `StoredFiles.keys`, which only tests call (`code-gate-keep-kit.ts` `keysNow`, `code-gate-stored.test.ts`). It stays so those tests key as a daemon outside a gate run. A later row could make those tests read keys from a gate run instead and drop it.
- `ci-export.ts`'s `daemonVitest` and the Vitest part of `daemonAdapters` differ only in `cache: false`. Not merged here: the brief keeps behaviour, and the export has no other caller of `daemonAdapters`' node:test half.
