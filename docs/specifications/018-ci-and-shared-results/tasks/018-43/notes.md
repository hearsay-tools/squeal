# 018-43 notes: CI evidence for spawn arguments, symlink removals and repeated test names

Worker 37809bc6, 2026-11-12. Spec 018 D8, D9; `research/left-out-files.md` causes A and B and the duplicate names. Commits `51d32109f` (items 1 and 2), `b41252e89` (item 3).

## What changed

1. **Spawn arguments (cause A).** `ci-runtime/children.cjs` `takeArguments`: at each async spawn (`ChildProcess.prototype.spawn`, so `spawn`, `fork`, `exec`, `execFile`), `spawnSync` and `execFileSync`, before the child starts, the hook calls `evidence.argument` for the command and each argument that is no option and holds `/`, `\` or `.`, resolved from the spawn's `cwd`. `execSync` takes none. This is the rule and the call set of the daemon's `recordArguments` (`src/runners/observe/spawn.cjs`), copied, not shared: `dist/ci/` and `dist/observe/` are copied apart (`src/harness/build.ts`), and a change under `src/runners/observe/` is recorder runtime for the key-format alarm (018-16 notes). The test `ci-evidence-arguments.test.ts` holds the two rules equal: the evidence's paths equal what the daemon's recorder observes in the same run.
   `evidence.argument(p)` (`evidence.cjs`) reads `p` only when it is a kept path and a file now. It tells a file by `realpath` of `p` and of `p/` (`ENOTDIR`), which no recorder observes: a `stat` or an `open` of a directory argument would add a read the daemon's recorder does not make, and so a key change. Limit: a FIFO, socket or device inside the root given as an argument passes this test (the daemon's `isFile()` does not), and its read is then observed. Not seen in squawk.
2. **Symlink removal (cause B).** `write(p, { entry: true })` follows the symbolic links above `p`, not `p`'s own (`reached(abs, false)`). `evidence-hooks.cjs` passes `entry` for `rm`, `rmdir`, `unlink` (both APIs) and both paths of `rename`. Writes through a link (`writeFile`, `truncate`, `utimes`, `link`, `copyFile`'s target, an open to write) still mark the target. Test: `ci-evidence-writes.test.ts`, "removing or renaming a link".
3. **Test locations (duplicate names).** `vitest-ci.cjs` `locateTests` sets `configOverride.includeTaskLocation = true` in the `start` wrap, before the coverage provider. Each project's `serializedConfig` merges `configOverride` (Vitest 4.1 and 5, `_serializeOverriddenConfig`), so every worker collects locations. Without `configOverride` it sets nothing, and the part is as before. `ci-runs.ts` already named a repeat by its line (`checkNames`).

## The D9 rule as implemented (for the coordinator's amendment)

`ci export` (`src/core/ci/export.ts`, `namedAsDaemon`): **a test file with two or more checks of one full name is kept when every one of its checks has its location, and left out otherwise** (counted as `ambiguous`, "with two checks of one name"). The part still lists `sharedNames`; the names in `checks` are `checkNames`'s, the second test of a name as `name (line N)` and a third on the same line as `name (line N, 2)`, which is what the daemon stores. A part of an earlier Squeal at key format 21 has no locations, so its files with repeated names stay out.

## D10 and `includeTaskLocation`

D10's import comparison does not see the option: it compares the export's environment, which the export job computes as the daemon does (the daemon's instance sets `includeTaskLocation: true`), with the local one. The shard-against-job comparison (`runDifferences`, `export-check.ts`) leaves `includeTaskLocation` out (`SQUEAL_FIELDS`). With this change a part's descriptor has the job's value, so it is equal; the tolerance stays for parts an earlier Squeal recorded at this key format. `ci-record.test.ts` now asserts it is equal.

## squawk (run 43188846583, `cc3cead4`, Vitest 4.1.10)

The coordinator chose, on 2026-11-12: single-file records now, a modelled export for causes A and B now, and the measured counts from squawk's first merge-queue run after the release. No shard was re-recorded on this host.

### Single-file records (measured)

`probes/rec.sh`: one file under `ci record` (shard 1/1), then `ci export` of that part, in a clone at `cc3cead4`, `CI=true`, `HOME` and `TMPDIR` in scratch. "base" is this branch's base `b3a5b0a25`, "new" is `b41252e89`, both run from source (`probes/squeal-ci.mts`).

| File | Cause | base | new |
|---|---|---|---|
| `server:packages/cezar/src/core/harness-autosave-settlement-churn.test.ts` | A | left out: no evidence for `omp-ci-wait.mjs`, `pi-ci-wait.mjs`, `pi-default-tools.mjs` and 2 more | exported, 13 results |
| `server:packages/cezar/src/core/cursor-print-runner.test.ts` | B | left out: no evidence for `mock-cursor-print.mjs` | exported, 27 results |
| `contract:packages/contract/src/tool-display.test.ts` | 5 repeated names | left out: two checks of one name | exported, 47 results; 46 of 46 checks located; names such as `… (line 96)` |
| `server:packages/cezar/src/core/pi-ui-mapper.test.ts` | 1 repeated name | left out: two checks of one name | exported, 26 results |
| `server:packages/cezar/src/lint/lint-ast-grep-1.test.ts` | A (`sgconfig.yml`) and D | left out, 3389 inputs | left out, 3388 inputs: `sgconfig.yml` has evidence now; the rest is cause D (`.ai/ast-grep/**`, read only by `sg`) |

Duplicate names are shown on these two files only, not counted over the run.

### Modelled export (causes A and B; MODELLED, not recorded)

`probes/model.mjs` writes the run's eight downloaded parts again with the evidence the fixed hook takes added, nothing else changed: in each shard, each of the research's four argument files (`pi-retry-degraded-service.mjs`, `pi-project-skills.mjs`, `pi-default-tools.mjs`, `sgconfig.yml`) that a test file of that shard observed and the shard's evidence lacks, and in shard 5 `mock-cursor-print.mjs`, each at its blob at `cc3cead4` (the research found every reading process saw that content). Shard 3 gained nothing; the others one to four paths. The observed sets, and so the keys, are CI's. Both exports ran with this branch's `ci export` (`b41252e89`, from source) in the clone at `cc3cead4`.

| Parts | Exported files | Results | Left out: inputs | Left out: repeated names |
|---|---|---|---|---|
| CI's export (0.1.443) | 1484 | 24272 | 150 | 31 |
| downloaded parts, this branch's export | 1484 | 24272 | 150 | 31 |
| modelled parts, this branch's export | **1568** | 25234 | 66 | 31 |

The 66 are causes C to F (56 + 10), which this row does not take. No key changed: each of the 24272 results of CI's `squeal-results.json.gz` has the same key in both replays, and the environment hashes are equal (`probes/keys.mts`). The 31 files with repeated names stay out here because the downloaded parts have no locations; with this change they are named (single files above), but whether each then passes its evidence check was not counted. The measured counts come from squawk's first merge-queue run after the release.

## Probes

`probes/`: `rec.sh` (single-file record and export), `squeal-ci.mts` (this worktree's `ciCommand` from source), `model.mjs` (the modelled parts), `names.mts` (exported names with a line), `keys.mts` (keys of bundles compared). Throwaway; the clone, parts and outputs were in `$TMPDIR` (`t/37809bc6`) and are not kept.

## For the next worker

- The argument rule lives twice, in `observe/spawn.cjs` and `ci-runtime/children.cjs`. A change to one needs the other; `ci-evidence-arguments.test.ts` fails when they differ on its cases.
- Squeal does not re-run tests on a change under `src/runners/vitest/ci-runtime/` (no closure holds it, 018-16); run the hook's tests directly.
