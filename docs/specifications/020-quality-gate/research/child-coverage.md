# survey-020-10: coverage of child processes

Researcher, 2026-11-10. Brief: "survey-020-10" in `../tasks/wave-2.md`; spec D5, D8 to D10. Read-only on the product. Probes: `probes/child-coverage/` (throwaway). Versions: this repository at `1e8b506ed`, Node 24.22.1, Vitest 5.0.3, tsx 4.23.15, esbuild 0.28.2. Host: 24 vCPUs, one-minute load 21 to 33 during every run. Starting points: `../../015-coverage-complexity/research/child-processes.md` (R3, at `2e36f1ed2`, Node 24.21.0) and `issue-144.md`.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | How do the daemon and the gate collect children's `NODE_V8_COVERAGE` under `coverage.children: true`? | Today nothing collects it. Two small seams work: Vitest's provider points the variable at one directory per test file; the node:test recorder points it at `<dir>/children` instead of deleting it. The gate uses the same adapters, so it gets both. | experiment; source |
| 2 | Where does the D8 recorder delete the variable? | `recorder.cjs:62-65` (`hideCoverage`), called at `:79` or `:94`; `run/coverage.ts:46-55` then deletes every file except the own process's main thread. Vitest's provider never sets it. | source |
| 3 | Map with `ownRecord` | tsx and plain children map and join, in both runners. A bundle with a map reads `unread`. A cut file fails alone. | experiment |
| 4 | CPU cost; truncated files | Children: +26% CPU (median of 5 pairs). Mapping: about 19 ms per MB. A truncated file fails `JSON.parse` alone. Late and killed children are lost. | experiment; inferred |
| 5 | Tests that break when the variable is visible | Of 18 likely files here, 1 file (2 tests): `test/runners/vitest/own-provider.test.ts`. Not determined for the rest of the suite. | experiment |

## Findings

### Q1. Collection today and the two seams

**Today** (read in source code, `1e8b506ed`). Squeal's Vitest provider takes coverage through `node:inspector` in the worker (`src/core/code/coverage/provider.mjs:72-76`). It never sets `NODE_V8_COVERAGE`, so a child of a Vitest worker writes nothing, unless a project or an outer tool set the variable. The node:test run sets the variable per test file (`run/coverage.ts:25-28`). The recorder deletes it in the test file's process (Q2). The gate (`src/core/code/gate/collect.ts:160-198`) opens these same adapters with coverage on, and maps each payload with `mapHere` in `recordsOf`. So the gate and the daemon have the same boundary.

**Node's rule** (verified by experiment, Node 24.22.1). A process keeps the coverage directory it read at startup. Children and worker threads use the value in `process.env` when they start. A process started with `a` that sets the variable to `b` writes its own file to `a`, and its child and its worker thread write to `b`. A worker thread started in a process that had no variable at startup also writes, when the variable is set at `new Worker`.

**Vitest seam** (verified by experiment, `provider-children.mjs`, `run.out.txt`). `startCoverage`, and each `takeCoverage` after it, set the worker's variable to a new directory. Vitest calls `startCoverage` once per worker run and `takeCoverage` after each file (read in source code, Vitest 5.0.3 `dist/chunks/base.DhkQeZwd.js:70,82-90`, `index.ggMXe2IF.js:181-190`). With `--pool=forks`, each file had its own process and directory. With `--pool=threads`, both files ran in one pid, and each still had its own directory, because each thread has its own copy of `process.env`. All 7 tests passed in both pools.

**node:test seam** (verified by experiment, `children.cjs`). In the test file's process, the variable pointed at `<Squeal's dir>/children`. The recorder's `hideCoverage` deletes only Squeal's exact value, so it left this one. The own file stayed in Squeal's directory beside `own-<pid>`, so `coveragePayloads` still finds it. The two children wrote into `children/`.

### Q2. Where the variable is deleted

Read in source code, `1e8b506ed`: `src/runners/node-test/runtime/recorder.cjs:56-65`. With `NODE_TEST_CONTEXT` and `SQUEAL_NODE_TEST_COVERAGE` set, the recorder deletes `SQUEAL_NODE_TEST_COVERAGE` at once. Then `hideCoverage` deletes `NODE_V8_COVERAGE` when it equals Squeal's directory. It runs as the main script resolves (`:94`), after preloads, because tsx keeps the source text only while it sees the variable. Where the main script is unknown, it runs at once (`:79`). After the run, `coveragePayloads` (`run/coverage.ts:41-56`) keeps one main-thread file of the pid named by `own-<pid>` and deletes all other files. `ProjectCoverage` (`node-test/coverage.ts:47-53`, `:100-102`) turns coverage off under `--test-isolation=none`, because no test process of its own could delete the variable. The Vitest side has no deletion, because it never sets the variable.

### Q3. Mapping with `ownRecord`

Verified by experiment (`analyze.out.json`). Each child file was mapped with `ownRecord(root, payload, "sha1")`. Each test file's records were joined with `joinCoverage` and scored with `crapScore`. The results are the same in both Vitest pools.

| Source | Reached by | Result |
|---|---|---|
| `src/work.ts` `work`, CC 3 | tsx child, `a.test.ts` | ran, 50%, CRAP 4.13. node:test (other argument): 75%, CRAP 3.14 |
| `src/plain.mjs` `plain`, CC 2 | plain child with `env: { PATH }` | `a`: 67%, CRAP 2.15; `b`: 100%, CRAP 2. Each test file has its own record |
| `src/lib.ts` `lib`, CC 2 | esbuild bundle, inline map | not run, CRAP 6. The record lists `dist/cli.mjs` as `unread` |
| `src/killed.mjs` | child ended by SIGKILL | no file written, CRAP 2 at 0% |
| `src/late.mjs` | detached child, exits 1.6 s after its file ended | file written after the run ended (`children-later.txt`). Read later, it maps: 100%, CRAP 1 |
| a cut copy of a child file | — | `SyntaxError: Unterminated string in JSON`, and no other record is lost |

- **Bundles** (read in source code, `own-map.ts:9-48`). `ownMap` accepts only a map with one source that is the script itself (tsx's shape). A bundle's map names other files, so the script is `unread`. A project whose tests spawn a bundled CLI gains nothing for the bundle's sources. R3 needed rebuilt maps for this repository's bundles for the same reason.
- **tsx's hooks thread** writes a second file (thread 1) with no own scripts. It is harmless.
- **The join already unions loaders** (read in source code, `crap/join.ts:128-155`, `gate/evaluate.ts:47-62`). "It ran when one record ran it". A record's source counts as measured even when the test file's closure does not load it. So a child-only script that a selected test runs gets a measure in the gate.

### Q4. Cost, and truncated files

- **Children's CPU** (verified by experiment, `timing.out.txt`). 5 alternated pairs of 15 × (tsx child + plain child). Off: 3.49 to 3.91 s. On: 4.03 to 5.00 s. On/off: 1.28, 1.12, 1.36, 1.26, 1.26, so the median is +26%. The one-minute load was 27.3 to 28.5. Each child wrote about 0.6 MB (17.9 MB per round of 30). These tiny children are mostly startup, so this is a high bound per process. R3 measured +13% to +16% CPU for whole test files of this repository at a load under 25 (read in R3).
- **Squeal's mapping** (verified by experiment). Parse plus `ownRecord`: median 9.7 ms and maximum 24.6 ms per file. In total, 11 files and 6.5 MB took 122 ms, about 19 ms per MB. At R3's 4.3 GB of child files for the full suite, that is about 80 s of CPU (inferred). R3's c8 path took 100 s.
- **Size limit** (verified by experiment). `buffer.constants.MAX_STRING_LENGTH` is 536,870,888. So a child file larger than about 512 MB cannot be read as one string. R3's largest test file had 759 MB of child files over many processes.
- **Truncated or unreadable files.** Today an in-process payload that does not parse gives the test file no record: the gate notes "its payload could not be mapped" (`collect.ts:240-260`), and the daemon's writer drops it as `map-error` (`writer.ts:244`). A child file must fail alone. Otherwise one cut child drops the test file's own evidence. A file read while its process still writes it looks the same as a cut file (inferred: Node writes it at exit).
- **Lost children** (verified by experiment). A SIGKILL child writes nothing. The detached child's file came 1.6 s after its test file's batch. A reader at the run's end misses it. R3 found the same for SIGTERM without a handler. Child coverage is a lower bound in every design.
- **Lower coverage cannot give a false pass.** CRAP does not rise as coverage rises (`crap/score.ts`). So a lost child can only make a score worse: a false violation or a lower coverage, never a false pass (inferred).

### Q5. Tests that see the variable

- **This repository** (verified by experiment, `visible.out.txt`). A static scan found 18 test files that compare a child's or a process's environment, or name the variable. They ran with the variable set in each worker, as the Vitest seam sets it. 17 passed. `test/runners/vitest/own-provider.test.ts` failed 2 of 4 tests: its fixture `self-coverage.test.ts` asserts that precise coverage "counts only what ran after it started". Its Vitest worker is a child of the test, so it starts with the variable. Alone and with the variable off, the file passed 4 of 4. `self-count.mjs` shows the cause: the same call count is 1 without the variable and 2 with it. `recorder.test.ts`, the one failure in R3, now passes (row 015-33 changed it).
- **Not determined for the other ~1,540 test files.** The host rule allows no full suite, and the load was 21 to 33. R3's run 1 at `2e36f1ed2` had 8 failed files, and R3 named only `recorder.test.ts` as caused by the variable.
- **Squeal's own default-off tests stay valid.** These assert that the variable is deleted: `test/runners/node-test/coverage.test.ts` (fixture `:76-104`, assertion `:261`, a project's own variable `:352`) and `coverage-entry.test.ts:32-42`. They test the default, `children: false`.
- **Which tests a user can expect to break** (inferred from the failure). Tests that spawn a process that reads its own V8 coverage, such as a nested Vitest or c8 run. Tests that compare a child's whole environment. Tests that read the variable.

## Recommendation: proposal for D10 (020-10)

1. **Key.** Add `coverage.children` (default `false`) in `squeal.config.json`. It needs `coverage.enabled`. The gate reads it at the base, like D6's other keys, so a branch cannot change how its own evidence is collected.
2. **Vitest.** When children are on, the provider's worker side sets `NODE_V8_COVERAGE` to `<coverageFilesDirectory>/children-<uuid>` in `startCoverage`, and to a new directory after each `takeCoverage`. The payload names that directory. The instance sends the flag as it sends `skip.json`. The provider leaves an existing variable in the worker (a project's own or an inherited one) and sends a note, as node:test leaves a project's own. It takes none where it takes no coverage today: `isolate: false` and inspector files.
3. **node:test.** With a flag in the run's env, the recorder points the variable at `<dir>/children` where it deletes it today, at the same moment. `coveragePayloads` returns the own file and every file under `children/`.
4. **Record.** `CoveredFile` gains `children: AbsolutePath[]`. The mapper builds the own record, then `ownRecord` for each child file. It merges them per path when the blobs are equal: an OR of `lines` and `covered`, and a union of `functions`. This gives the same result as `joinCoverage` over separate records (inferred). A path with different blobs reads `unread`. A child file that does not parse, or is over a size cap, is dropped alone and counted under a new `Drops` cause. Children are read at the file's end, and later files are deleted with the directory.
5. **Keys.** The coverage marker in both runners (`vitest/environment.ts:119`, `node-test/adapter-environment.ts:96`) gains `children: true`. Results from a run where tests could see the variable then never share a key with results where they could not. Q5 shows that the outcome can differ.
6. **Loaders.** In the daemon, with children on, a test file whose observed set (`observedOf`, 016 D4) holds a path is also a loader of that path. Without this, a child-only script reads "no loader". The gate keeps import-graph selection and `--test`.
7. **Words and report.** `MEASURED` (`src/cli/code-coverage.ts`) and the delivery words say that children are measured when the key is on, and that the result is a lower bound. D7 adds `coverage.children` to `base` and child counts per run. D5 gets no new gap, because a lost child cannot give a false pass.

**Tradeoff.** Children add CPU: +26% for each child process, plus about 19 ms per MB in Squeal. They also change what tests see. In return, the gate measures scripts that tests only spawn, such as cezar's 4 runner mocks with CC 9 to 20 (`quality-gate.md` Q4). Without children, those are false violations. Off by default, the cost falls only on projects that opt in.

## Row split

| Row | Files | Tests |
|---|---|---|
| **020-10a** collect and map (first) | `core/types/policy.ts`, `core/daemon/policy-code.ts` (key); `core/code/coverage/provider.mjs`; `runners/vitest/coverage.ts`, `environment.ts`; `runners/node-test/runtime/recorder.cjs`, `run/coverage.ts`, `run/run.ts`, `coverage.ts`, `adapter-environment.ts`; `core/code/coverage/types.ts`, `mapper.ts`, `map-worker.ts`, `record.ts` (merge), `drops.ts` | One directory per file in forks and in threads. A project's own variable is kept. The recorder's `children/` directory, the own file still found, a worker thread's file. A golden merge of the own record and a child record. A cut child is dropped alone; a file over the cap. The marker differs on and off. The default-off tests are unchanged. |
| **020-10b** gate and daemon use (after 020-07 and 020-09) | `core/code/gate/collect.ts`, `policy.ts`, `report.ts`, `types.ts` (additive); `core/code/crap/loaders.ts`; `cli/code-coverage.ts`, `core/delivery/code-coverage.ts`; README and `commands.md` | Gate end-to-end: a changed child-only script with `--test` passes with children on and fails or is incomplete with them off; a function the test imports and only a child calls. Daemon: a child-only function reads covered. The words with the key on and off. |

Order: 10a can start in wave 3. 10b waits for 020-07, which owns `loaders.ts` and the daemon's evaluator, and for 020-09, which edits `report.ts` and `types.ts`. Neither row touches `ci record` (018 and 020-08).

## Open questions

1. **The size cap** for each child file and each test file. Hard limit: 536,870,888 characters. A lower cap is the coordinator's choice.
2. **A known dropped child:** only a note (recommended, because undetectable losses are the same kind), or an `incomplete` gap under D5's "partial evidence never passes"?
3. **Bundled children** read `unread`. A multi-source `ownMap` is not part of these rows.
4. **The full-suite effect** on this repository. Not determined (Q5).
5. **The daemon's loaders from `observedOf`** were read, not tried. 10b's first test should prove it.

## Sources

- Probes: `probes/child-coverage/` (README, scripts, outputs). Raw files are in the scratch directory `.ai/cezar/t/0989b0c0/cc`, outside git.
- Repository at `1e8b506ed`: `src/runners/node-test/runtime/recorder.cjs`, `run/coverage.ts`, `coverage.ts`, `adapter-environment.ts`; `src/core/code/coverage/provider.mjs`, `own.ts`, `own-map.ts`, `mapper.ts`, `writer.ts`, `drops.ts`; `src/runners/vitest/coverage.ts`, `environment.ts`; `src/core/code/gate/collect.ts`, `evaluate.ts`; `src/core/code/crap/join.ts`, `loaders.ts`, `score.ts`; `src/core/scheduler/keying.ts` (`observedOf`); `test/runners/vitest/own-provider.test.ts`.
- Vitest 5.0.3 `node_modules/vitest/dist/chunks/base.DhkQeZwd.js`, `index.ggMXe2IF.js`, `coverage.S6Dao4g-.js`.
- `../../015-coverage-complexity/research/child-processes.md` (R3), `quality-gate.md` Q4 and Q5, `issue-144.md`.
