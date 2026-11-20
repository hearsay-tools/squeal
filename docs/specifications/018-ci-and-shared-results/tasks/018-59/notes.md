# Row 018-59 notes: one owner for path-keyed maps, and an end-to-end guard

Repair of reviews 0.1.582 B1 and 0.1.582-r2 B2. Baseline: the candidate with both fixes (`b4dd90a32`, `1a1d6b4b2`).

## The owner

- `src/core/ci/own-map.ts`: `ownMap(entries)` builds a map keyed by a path or a name, each entry an own property (`Object.fromEntries`); `ownValue(map, key)` reads an own entry only, `undefined` otherwise.
- `src/runners/ci-runtime/own-map.cjs`: the hooks' copy. `children.cjs` and `evidence.cjs` load it beside them; `vitest-ci.cjs` through `shared.cjs`. The bundle copies it into `dist/ci/` with the other runtime files (`CI_RUNTIME` in `src/harness/build.ts`), so no build change.
- `test/ci/own-map.test.ts`: the two copies behave alike on `__proto__`, `constructor`, `toString`, `hasOwnProperty`, `valueOf` and `a/__proto__`, through JSON too. It also scans the CI code (below) and fails on: `Object.fromEntries(` or `Object.create(null)` outside the helpers; an assignment to a computed key, except argument slots (`args[at]`, `call[at]`), a replaced method (`target[name]`) and this process's own variables (`process.env[NAME]`); a variable that holds an empty object literal (one exemption: `inspector.cjs`'s `holder`, a stack-trace holder). At the parent of each fix it names the defect: `endpoints.ts` `stable[path] = hash` and `= {}`, `evidence.cjs` `pending[rel] = value` and `let pending = {}`.

The scanned code: `src/core/ci/**`, `src/runners/ci-runtime/**`, `src/runners/*/ci-runtime/**`, `src/runners/*/ci-*.ts`, `src/cli/ci*.ts`.

## Map inventory

Maps keyed by a path or a name in that code, as found at the baseline, and what changed.

Filled by assignment, so a key named `__proto__` was lost (now `ownMap`):

| Where | Map | Keyed by | Effect of the loss |
|---|---|---|---|
| `src/core/ci/endpoints.ts` `endpointsAfter` | part `stable` | path | B1: wrong pass. Fixed by `b4dd90a32`. |
| `src/runners/ci-runtime/evidence.cjs` `outputOf` | NDJSON `e` (pending evidence) | path | B2: wrong pass. Fixed by `1a1d6b4b2`. Now a `Map` until each flush, then `ownMap`. |
| `src/runners/ci-runtime/children.cjs` `carried` | a child's or Worker's env | variable name | A variable named `__proto__` was dropped from the child's env. No key or rule effect. |
| `src/runners/ci-runtime/children.cjs` async `spawn` wrapper | env read from `envPairs` | variable name | As above. |
| `src/runners/vitest/ci-runtime/vitest-ci.cjs` `onTestRunEnd` | the allow-listed variables the run saw | variable name | An allow-listed variable named `__proto__` was lost from the run's recorded env. |
| `src/runners/vitest/ci-record.ts` `startRecording` | the command's env | variable name | None: the key is the constant `SQUEAL_CI_RECORD`. Folded into the literal, so the code holds no computed assignment. |
| `src/core/ci/export-bundle.ts` `observedOf` | a file's observed entries | observed-map name | None: the names are the fixed `OBSERVED_MAPS`. Its read by test file path read inherited members for a file named `constructor` or `__proto__`: now `ownValue`. |

Already own entries through `Object.fromEntries` (now `ownMap`, same output):
- `src/core/ci/inputs.ts` `readRecorded`: the part's `evidence`.
- `src/core/ci/parts.ts` `snapshotFields`: snapshot option names.
- `src/core/ci/export-check.ts` `runDifferences`: config field names (2).
- `src/core/ci/export-node-test-here.ts` `allowlisted`: variable names.
- `src/runners/node-test/ci-files.ts` `sorted` (`nodeBuildOf`): Node build keys.
- `src/runners/node-test/ci-runs.ts` `nodeTestOf`: the part's node:test `env`.

Reads by a name a map may not hold (now `ownValue`):
- `src/core/ci/inputs.ts` `whyUncertified` (was `Object.hasOwn` then an index: same result).
- `src/core/ci/reuse-endpoints.ts` `endpointHash`, the B1 consumer (was `Object.hasOwn` then an index: same result).
- `src/core/ci/export-node-test-here.ts`: the job's value of an allow-listed variable. An unset `toString` read the inherited function.
- `src/core/ci/export-node-test-refusals.ts`: a part's `env` value of a variable (2 reads). A part without the name read the inherited member.
- `src/core/ci/export-bundle.ts`: above.

Left as they are:
- `src/runners/node-test/ci-runtime/node-test-reporter.mjs` header `env`: `Object.fromEntries`, the builder `ownMap` wraps. The reporter imports only Node built-ins and the daemon's reporter (review of 0.1.579 B3), so it does not load the copy; the scan names this one exemption.
- Spreads into new objects (`{ ...env }`, `{ ...options.env, ...addition.env }` in `src/cli/ci.ts`, `src/cli/ci-export.ts`, `src/runners/*/ci-record.ts`): a spread defines own properties, so no key is lost.
- `children.cjs` `withOwn`: copies a caller's options with its prototype and property descriptors; not a map.
- `Map` and `Set` keyed by path (`reuse.ts`, `export-node-test.ts`, `evidence.cjs` `last`, `gone`): no prototype.
- `JSON.parse` of parts, NDJSON and settings: it defines own properties, `__proto__` included.
- `reuse-endpoints.ts` `Object.hasOwn(part.evidence, path)`: a check only.
- `coverage.cjs` `project?.vite.environments[batch.environment]`: Vite's object, not ours.
- `parts.ts` `part.coverage?.records[file.record]`: an array index.

## The guard

`test/ci/export-object-names.test.ts`. Per runner (Vitest, node:test) and case, a committed repository holds the root files `__proto__`, `constructor`, `toString` and `hasOwnProperty`. Each is the one declared input (`squeal.config.json` `inputs`) of its own test file, which expects it to hold `GOOD`. `ci record` runs the runner through a shell wrapper; the checkout is restored to the commit (`git checkout -- .`); `ci export` runs there. The export is right when it holds exactly the test files that pass at the commit's content.

| Case | Read | At the commit | Expected export |
|---|---|---|---|
| read by Node | `readFileSync` | `GOOD` | all four (D9) |
| read by a shell only | `cat` | `GOOD` | all four (D33) |
| changed before the step | `cat` | `BAD`, `GOOD` in the recording checkout from before `ci record` to its end | none (B1) |
| changed and restored by a shell during the step | `readFileSync` | `BAD`; the wrapper writes `GOOD`, runs, `git checkout` restores | none (B2) |

Red proof: the test file, unchanged, in a detached worktree at each parent, run with `node_modules/.bin/vitest` (`timeout 600`):
- at `02d9377f0` (parent of `b4dd90a32`): 4 failed, 4 passed. The export holds `test/proto.test.ts` (Vitest) and `test/proto.test.mjs` (node:test) for both changed cases.
- at `a6f3efba8` (parent of `1a1d6b4b2`): 2 failed, 6 passed. The export holds `test/proto.test.ts` and `test/proto.test.mjs` for the changed-and-restored case.

The `constructor`, `toString` and `hasOwnProperty` files gave the right outcome at both parents: assignment makes an own entry for them. They pin the reads.

The test runs a real `node --test`, so `test/version-sensitive.txt` lists it.

## `test/ci/resolution-import.test.ts` (row 023-14)

The candidate failed all four of its tests; they pass at `ee79bb127`, before wave 20. D33 now certifies the b1 and b2 chain manifests, which only Vite's native resolver reads, so the export keeps those chain tests; b2add's manifest is absent at the commit, so D33.3 leaves it out. The test expected all three left out. Amended with the coordinator's agreement (`3f8060e0f`): the export summary counts 2 files certified by the rule; at a commit that changes one chain's manifest, no import takes that chain's pass and the other exported chain is taken. b2add's safety check is trivially null, as all three were before.
