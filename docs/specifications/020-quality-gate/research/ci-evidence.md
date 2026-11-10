# CI evidence for the gate (survey-020-08)

Researcher 8b430302, 2026-11-10, at Squeal `bba538f1b` (0.1.425). Brief: `tasks/wave-2.md`, "survey-020-08". Probes: `probes/ci-evidence/` (README lists every command). Every timing names the host's one-minute load. The host has 24 vCPUs, and the load was 24 to 35 during the runs, above the 14 to 16 knee. Ratios are paired by round. Absolute seconds are high.

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can the `ci record` hook add Squeal's provider before Vitest starts its workers? | Yes, on Vitest 4.1.10 and 5.0.3. Inside the wrapped `Vitest.prototype.start`, before the original runs, set `configOverride.coverage` to Squeal's provider. `start` calls `initCoverageProvider()` itself, and every worker reads the override through `serializedConfig`. | verified by experiment; read in source code (Vitest 4.1.10 `cli-api.BK8pd4xc.js`, 5.0.3 `index.DpLw24bj.js`) |
| 2 | The records inside the hook, and their cost per test file | The records equal the gate collector's byte for byte on the fixture (2 of 2 on 4.1.10, 2 of 2 on 5.0.3). On 30 of this repository's files, 28 of 30 are equal, and both differences come from the tests. Cost: the provider adds +22% CPU over `ci record`. Mapping adds +2.5% CPU, or 37 ms a file on the main thread. Records add about 4 KB a file to a part, with sources stored once and gzip. | verified by experiment |
| 3 | Part format 4, and how `--base --parts` selects and checks records | Format 4 holds a coverage header with the provider and record versions (or why there is none), a deduplicated source table, and a record index per test file. `--base --parts` keeps D3.1's selection. It takes a file from the parts only when that file's shard evidence certifies every input of its closure here, the record versions are this Squeal's, and the record's blob for each changed path is the head blob. It runs every other file. The evidence check already exists (`ci export`'s `certifier`). | design; the evidence check verified by experiment |
| 4 | A project whose CI also runs `--coverage` | Squeal cannot share that run. When the provider replaced `@vitest/coverage-v8`, a run that failed its 95% line threshold (exit 1) exited 0 and wrote no report. So the hook must yield: when the resolved config has `coverage.enabled`, it adds nothing and the part says why. cezar's PR shards run `--coverage.enabled` today. | verified by experiment |

## Q1. Adding the provider before the workers start

**Where** (read in source code). Vitest 4.1.10 and 5.0.3 both run `start(filters)` → `initCoverageProvider()` → `getCoverageProvider(configOverride.coverage ? rootProject.serializedConfig.coverage : config.coverage)`. Workers get `project.serializedConfig`, which `_serializeOverriddenConfig` deep-merges with `configOverride`. The hook already wraps `start` before Vitest builds anything (row 018-26). So the hook sets, before the original `start` runs:

`configOverride.coverage = { enabled: true, provider: "custom", customProviderModule: <provider.mjs>, reporter: [], reportsDirectory: <private temp>, coverageFilesDirectory: <private temp>/.tmp, clean: false }`

It also adds the provider file to each Vite server's `server.fs.allow`, as `InstanceCoverage.allow` does (row 013-08). The `coverageFilesDirectory` must be set too. Without it, Vitest 5 computes the directory from the project's own `reportsDirectory` (`./coverage/.tmp` in the project).

**Result** (verified by experiment, `runs.out.txt`). With `ci record` and the probe hook on the fixture, Vitest 4.1.10 and 5.0.3 each gave `providerBefore: false` and `workersStarted: false` at the wrap, the provider `squeal`, 2 batches for 2 files, exit 0, and one part. Under `ci record` on 30 files (5.0.3), the part had 30 files and the provider had 30 batches.

**Effects on the run.**
- Vitest prints one more line, "Coverage enabled with squeal". Exit codes and the project's reporters did not change.
- `ci export` of a part recorded with the provider exports the same files at the same keys as without it (2 of 2, `squeal-results/1`). The part's `config.coverage` hash differs. D10 already tolerates that field.
- A probe error inside the wrap (my event directory was missing) failed the whole run, and no part was written. The product wrap catches every error today (`fail(error)`). The provider code must do the same.

## Q2. The records inside the hook, and their cost

**What the hook must hold** (verified by experiment, `probe-hook.cjs`; read in source code):

1. **Stamps.** Wrap each environment's `pluginContainer.load` and hash the bytes Vite reads, as `SourceStamps.attach` does. `buildRecord` confirms each source's blob from that sha1 and marks a changed source `unread`. The evidence hook sees the same read, so a change between the reads cancels that path's evidence too.
2. **Payloads.** The provider's `takeBatches()`, or `onAfterSuiteRun`, gives each test file's batch. Take each environment's transforms (`moduleGraph.idToModuleMap`) before the instance closes. A Vitest CLI run does not invalidate them before its end.
3. **Mapping.** Map with `buildRecord`. The mapper bundles to 13.5 KB of CommonJS with built-ins only (`map-entry.ts`). In the product, the hook can start the existing worker `dist/cli/coverage-map.mjs` with `workerMapper`'s protocol. Then mapping leaves the Vitest main thread, and nothing new is bundled.
4. **No record** for a batch of several files, a file that did not complete, a run with a test name filter (015 D8 keeps records only for a file run whole), a project with `isolate: false` (the provider takes none), and a file whose closure imports `node:inspector`. Experiment: a test that starts, takes and stops its own precise coverage passes with the provider on, but its record lost `src/math.ts`, which it ran (`runs.out.txt`). The daemon skips such files before the run (`skip.json`). The hook knows the closure only after the run, so it drops the record then and marks the file.
5. **Errors** go to the part as a reason. They never go into the run.

**Equality with the gate** (verified by experiment, `compare.out.txt`). On the fixture, the records equal the gate collector's (`collectEvidence`) byte for byte on 4.1.10 and on 5.0.3. On 015-126's 30 files (5.0.3), 28 of 30 are equal:
- `lazy.test.ts` runs other branches of `node-options.ts` and `recorders.ts`, because `ci record` and the probe set `NODE_OPTIONS`. This is a true difference in environment.
- `stat-cache.test.ts` differs in one function, `git.ts:75` (`child.stdin.on("error", …)`). It runs only when the child closes stdin first. Two hook runs differ in it too.

**Cost** (verified by experiment, `timing.out.tsv`). 5 rounds, rotating order, the same 30 files, `--maxWorkers=4`. One-minute load 24.4 to 34.8 on 24 vCPUs.

| Mode | CPU s, median | Wall s, median | CPU ratio, median (range) |
|---|---|---|---|
| plain `vitest run` | 31.7 | 9.4 | — |
| `ci record` | 35.9 | 11.7 | 1.12 over plain (1.04 to 1.18) |
| + provider, no mapping | 40.8 | 13.8 | 1.22 over `ci record` (1.13 to 1.25) |
| + provider + mapping in the hook | 41.9 | 15.1 | 1.03 over no mapping (1.01 to 1.24); 1.26 over `ci record`; 1.41 over plain |

Mapping in the hook took 1,100 ms for 30 files (median; 833 to 1,294), 37 ms a file. Per file, the median was 6.4 ms and the largest 131 ms. It ran serially on the main thread at run end, which added about 9% wall time. The provider's +22% here disagrees with the "+8% CPU per shard" that `quality-gate.md` carried from 015 for this slice. Short test files make fixed costs weigh more. What decides it is one measurement on a real shard (Open question 1).

**Size** (verified by experiment). Raw payloads were 6.7 MB for 30 files. Records deflated one by one came to 347 KB (11.6 KB a file), against a 148 KB part today. 900 of 3,172 source entries are distinct. With sources stored once, the raw JSON is 381 KB, or 118 KB with gzip (about 4 KB a file). At that size, cezar's 1,817 test files would add about 7 MB of artifacts per run.

## Q3. Part format 4, and `--base --parts`

**Format `squeal-ci-part/4`** (design). It is format 3 plus:
- `header.coverage`: `{ provider: "squeal", providerVersion, recordVersion }`, or `{ off: "project-coverage" | "no-provider" | "failed", note }`.
- `projects[].coverage`: `"on"` or `"isolate-false"`.
- `coverage`: `{ sources: CoverageSource[], records: { sources: number[], unread: RelativePath[] }[] }`. Sources are stored once, by content. No absolute path, as today.
- `testFiles[].record?: number` (an index into `coverage.records`), and `testFiles[].noRecord?: "inspector" | "filtered" | "not-whole"`.

`readPart` reads 3 and 4. Format 3 is a part with no records. `ci export` ignores everything new, so its output does not change.

**`squeal code --base <ref> --parts <dir>...`** (design; step c reuses code verified by experiment):

1. Selection does not change (D3.1). The gate opens its adapters at the head and takes `testFiles()`, `affected()` and `closure()`. Parts never choose the files.
2. Parts are read and filtered as wholes. A part that does not read is a setup error (exit 2). A part whose run did not complete lists no file already. A test file in two parts is taken from neither. When `header.coverage` versions differ from this Squeal's `COVERAGE_PROVIDER_VERSION` and `COVERAGE_RECORD_VERSION`, the part's records are ignored, with one note.
3. A selected file T is taken from the parts when all of these are true:
   - (a) T is in exactly one part.
   - (b) Every input of T's closure here, plus T's `observed` reads in the part, is certified by that part's evidence. This is `uncertified(paths, evidence, here)` from `core/ci/inputs.ts`, with `here` hashing the working tree. It is a check on content, not on commit, so it holds in a fresh checkout of the same SHA and in a dirty tree for files the edit does not reach. Experiment (`runs.out.txt`): `ci export`'s same check left out both test files after an edit of `src/math.ts`, and only `test/add.test.ts` after an edit of that file.
   - (c) T has a record. A changed path in its record has the head blob and is not `unread`. With (b) this is redundant, and cheap.
   - (d) Its evidence is then `completed: true`, `failed` from its `fail` checks and file-level errors, `skipped` from its `skip` checks (D11.3), `loads` from the closure here, and the record.
   A certified file whose outcome is `fail` and that has no record is taken too: its failure makes the verdict `incomplete` (D5) whatever a run would add.
4. Every other selected file runs under the budget, as today. With 020-07c that order is parts, then the store, then a run. The report marks each test file `from: "parts" | "store" | "run"`. This is one field in place of 020-07c's `fromStore`, so D7 grows once. `QUALITY_POLICY_VERSION` does not change, because D5's rules do not change.
5. node:test files always run or come from the store: `ci record` records Vitest only.

## Q4. A CI run that also runs `--coverage`

A Vitest instance takes one coverage provider (read in source code: `initCoverageProvider` keeps one `_coverageProvider`). Fixture on Vitest 4.1.10 with `@vitest/coverage-v8` 4.1.10, `vitest run --coverage --coverage.thresholds.lines=95` (verified by experiment, `runs.out.txt`):

| Hook | Exit | The project's coverage report | Records |
|---|---|---|---|
| none | 1 (lines 57.14% < 95%) | `coverage-summary.json` | 0 |
| replaces the provider | **0** | none | 2 |
| yields when `coverage.enabled` | 1 | `coverage-summary.json` | 0 |

Replacing breaks D8 ("returns its exit code"). It silently turns off a coverage gate. So the hook yields, the part's header says `off: "project-coverage"`, `ci record` prints one line, and the gate runs those files itself.

cezar (read with `git show origin/main:.github/workflows/ci.yml`, `5621be917`): PR runs add `--coverage.enabled` and upload Istanbul `coverage-final.json` (`vitest-coverage-<sha>`). Only merge-group shards run `ci record`, without coverage. So PR parts would hold no records unless cezar drops its own PR coverage for Squeal's. That fits #3096, where the gate replaces cezar's own coverage check, and it is a cezar change for the human. Two other options cost a second Vitest run per shard: a separate coverage job, or a second recorded step.

## Recommendation for Squeal

**For D10, 020-08** (proposed text):

1. `ci record` adds Squeal's provider through `configOverride.coverage` in the `start` wrap. It maps each completed whole file's payload in a worker thread (`coverage-map.mjs`) from what Vite read (stamps), and writes the records into a format 4 part. It adds nothing when the run's resolved config has `coverage.enabled`, or when Node lacks `process.getBuiltinModule`. The part names why. It never changes the exit code, and an error of its own is a reason in the part.
2. No record for `isolate: false`, a test name filter, a batch of several files, an unfinished file, or a closure that imports `node:inspector`. The last is checked after the run, and the export leaves that file out (an 018 decision).
3. `squeal code --base <ref> --parts <dir>...` takes a selected file from the parts only under Q3's rule 3, and runs every other file. Each test file in the report says where its evidence came from.
4. 018 changes, which 018's coordinator owns: D8's "No coverage provider is added" and the non-goal "Squeal's coverage provider in CI" are reversed. `ci record --help` says that the provider is added, and when it is not. D10's coverage tolerance stays. Projects without the provider, and daemons with coverage off, still need it.

**Compatibility with what cezar runs from 0.1.423** (read in source code; cezar's remote read with `git ls-remote`):
- cezar's `refs/squeal/*` held no ref on 2026-11-10 at about 13:00Z. Its first merge-group run on the 0.1.423 pin could not attach (row 018-26), and its pin still names `squeal--v0.1.423`. So no cezar part or export exists yet. Once the pin moves to 0.1.425 or later, the shards write `squeal-ci-part/3` and `squeal-results/1`.
- Exports: unchanged. Format, keys and `KEY_FORMAT_VERSION` stay. Verified: the provider in the shard gives the same keys. Every published export stays importable by every daemon. The 018 non-goal "imported files keep no coverage" stays. Records travel in parts only.
- Parts: format 4 readers accept 3, so a mixed artifact set exports. A gate given format 3 parts runs every selected file. One workflow run uses one pinned Squeal for record and export, so a 3/4 mix occurs only when artifacts are re-used across a pin move.
- Bundles: the hook needs `dist/coverage/provider.mjs` and `dist/cli/coverage-map.mjs`, which the tag clone already holds. The runtime asset (D9) must hold both. That is for row 020-11's README to state.

**Row split** (order: 020-08a, then 020-08b after 020-07c lands. 020-08c is a cezar proposal for the human):

| Row | Files | Tests |
|---|---|---|
| 020-08a records in parts (018's files: hand-off or 018's coordinator) | `ci-runtime/vitest-ci.cjs` plus a new `ci-runtime/coverage.cjs` (override, allow, stamps, batches, worker map, yield, drops); `vitest/ci-runs.ts`, `cli/ci.ts` (records into the part); `core/ci/parts.ts` (format 4, `readPart` 3 and 4); `cli/main.ts` help; `harness/build.ts` only if the worker path needs it | real Vitest 4.1 fixture (`test/fixtures/vitest/vitest-4.1`) and 5: records equal the gate collector's on one fixture; `--coverage` yields with exit 1 kept and the report written; `isolate: false`, `-t`, `node:inspector` give no record; a hook error gives a part reason and the exit code unchanged; `ci export` of format 3 and 4 parts gives the same bundle |
| 020-08b `--base --parts` | new `gate/parts.ts`; `gate/collect.ts` (the known-evidence seam shared with 020-07c's `stored.ts`); `gate/report.ts` (`from`); `cli/code-gate.ts` (flag) | a gate from parts equals a gate from runs on one fixture, apart from `from` and times; an edited input, another record version, a duplicate file and a format 3 part each make that file run; a `fail` check reads `test-failed` without a run; a `skip` check reads `skipped`; nothing is written to the parts directory |
| 020-08c cezar proof (proposal; needs the human) | cezar: PR shards under `ci record` without their own `--coverage.enabled`; a gate job after the shards running `squeal code --base origin/main --parts …` | one measurement: the shards' CPU and wall time against the same SHA's earlier run, and the share of selected files taken from parts |

## Open questions

1. Not determined: the provider's cost on a real CI shard. Here it was +22% CPU on 30 short files at load 24 to 35, against 015's +8%. A cezar shard measurement (020-08c) decides it.
2. Not determined: the cost of opening the gate's adapters in a CI job only for selection and closures, with no runs. It was not measured apart from runs.
3. For 018's coordinator: whether the export leaves out a file whose closure imports `node:inspector` when the shard ran with the provider. Such a file's outcome comes from a run with a coverage session that a local daemon does not open.
4. Not tested: a client environment (jsdom) under the hook. The `fs.allow` rule is the daemon's (row 013-08). cezar's install has no hoisted jsdom to link.

## Sources

- Squeal `bba538f1b`: spec 020 (D3, D5, D7, D10, D11) and `status.md`; spec 018 (D8 to D17) and `status.md` (018-23, 018-26); `tasks/wave-2.md`; `../../015-coverage-complexity/research/quality-gate.md` (Q2, open question 2) and `probes/quality-gate/{timing.sh,sample.txt}`; `research/daemon-parity.md` Q5; `src/runners/vitest/{ci-record,ci-runs,coverage,sources,stale,environment}.ts`, `ci-runtime/vitest-ci.cjs`; `src/core/ci/{parts,export,export-check,export-inputs,inputs}.ts`; `src/cli/ci.ts`; `src/core/code/coverage/{provider.mjs,record,mapper,parts,types}.ts`; `src/core/code/gate/{collect,types}.ts`; `src/core/keys/environment-descriptor.ts` (`importDifferences`); `src/harness/build.ts`.
- Vitest 5.0.3 (this lockfile): `dist/chunks/index.DpLw24bj.js` (`start`, `initCoverageProvider`, `_coverageOptions`, `serializeConfig`, `_serializeOverriddenConfig`). Vitest 4.1.10 and `@vitest/coverage-v8` 4.1.10 (`~/projects/cezar/node_modules`, read-only): `dist/chunks/cli-api.BK8pd4xc.js` (the same methods, `enableCoverage`).
- cezar `origin/main` `5621be917`: `.github/workflows/ci.yml` lines 712 to 849 (shards, PR coverage, `ci record`, the 0.1.423 pin); `git ls-remote origin 'refs/squeal/*'` (none).
- Probes: `probes/ci-evidence/README.md`, `runs.out.txt`, `compare.out.txt`, `timing.out.tsv`.
