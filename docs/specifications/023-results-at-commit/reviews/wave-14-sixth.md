# Wave 14, sixth review: FAIL

Candidate: `cand/0.1.568`, `152ec5e265d4b470ead914b78f2db3976ec82d91`.
Delta: `1a182fc22..152ec5e26`, including `914271c0c` and rebuilt bundles.
Contract: D5.2 as amended at `faba5a1ab` (“A: stop guessing”), D5.5, and the fifth review. **Three proven blockers** remain in the new input-check boundary. The five fifth-review reproductions now pass their intended checks. Earlier B2 and N1 remain closed on the checks below.

## Verification

The candidate SHA matched exactly. Checks ran on a clean tree:

```sh
pnpm run lint
pnpm run typecheck
timeout 600 pnpm exec vitest run \
  test/cli/proof-inputs.test.ts test/cli/proof-with.test.ts \
  test/cli/proof-with-node-test.test.ts test/cli/proof-copy.test.ts \
  test/cli/proof-legacy.test.ts test/code/gate/keep-older-fields.test.ts \
  test/cli/proof-evidence.test.ts test/cli/proof-conditions.test.ts \
  test/cli/proof-report.test.ts test/cli/proof-args.test.ts \
  test/proof/imports.test.ts test/proof/red-evidence.test.ts \
  test/proof/verdict.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts --maxWorkers=2
```

Lint: 3,768 files checked, exit 0. Typecheck: exit 0. Focused tests: **15 files, 140 tests passed**, exit 0, 114.76 s.

Installed Squeal status returned exit 3: daemon stopped, revision 8, 488 of 1,998 test files not current (474 queued, 14 unknown), no validated verdict for the changed proof paths. This and the brief required direct checks. Exact-candidate [CI 44528675339](https://github.com/hearsay-tools/squeal/actions/runs/44528675339) was still in progress at the last observation; [Private material 44528675464](https://github.com/hearsay-tools/squeal/actions/runs/44528675464) passed. No full suite, build, repository dependency install or version change was run.

Independent external probes used temporary Git repositories, the real proof command, child CLI and runner adapters. They ran with `timeout 600 pnpm exec vitest run`, explicit paths and one worker. Checkout installation linked the existing Vitest; this verifies proof behavior, not a frozen package-manager install. Successful controls passed checkout-removal checks; probe teardown removed the fixtures. The report is the only committed file.

## Common reproduction setup

The following fixtures have package type `module`, `squeal.config.json` containing `{}` unless stated otherwise, and `vitest.config.mjs` with `test.include: ["test/*.test.ts"]`. The named test is unchanged between the base commit A and HEAD. The visible product input changes from `export const value = 1` to `export const value = 2` in `src/value.ts`.

Each test imports `it` and `expect` from `vitest`, imports `value` from `../src/value`, obtains the threshold as stated below, and asserts `expect(value).toBeGreaterThanOrEqual(min)`. Every HEAD threshold is 1, so the HEAD test passes over A's value too when its test input is copied. This is the same false-proof shape as the earlier data-only reproduction.

## 1. Proven blocker: directory-listing inputs are compared as file paths

Locations: `src/core/proof/inputs.ts:49` and `src/core/proof/inputs.ts:51`; shared observations are supplied by `src/cli/proof-inputs.ts:55`.

The observed input is a listing token such as `support/`. The Git diff holds the added path `support/marker.txt`. Exact `changed.has(path)` never connects them. The key system already knows that an entry-name change changes a listing input; this new proof check loses that meaning.

Use this unchanged test body:

```ts
import { readdirSync } from "node:fs";
// ...the imports in the common setup
it("row", () => {
  const min = readdirSync("support").includes("marker.txt") ? 1 : 3;
  expect(value).toBeGreaterThanOrEqual(min);
});
```

A contains `support/keep.txt`. HEAD adds `support/marker.txt` as well as changing the source value. Run:

```sh
squeal proof test/a.test.ts --base A --source src/value.ts --json
```

Actual: **exit 0, `proven`, two runs**, both sides stored. Repeat the same call: **exit 0, `proven`, zero runs**, both sides read from the store. The changed marker is absent from `changedImports` and both reruns are null.

Control: add `--with support/marker.txt`. Actual: **exit 1, `not red`**, red passes. Copying the HEAD directory entry removes the old threshold failure over A's source.

An independent read of the shared store confirms that the recorder did its job:

```json
{"key":"observed.","value":"{\"test/a.test.ts\":[\"support/\"]}"}
```

This is not an invisible native read or a network dependency. The input is recorded and keyed. Spec 011 C3 (“Test closure”) defines listed directories as entry-name hashes; `keys/observed.ts` provides listing tokens and `ancestorListings`, and the scheduler uses listing-aware changes. D5.2 requires the caller to settle the changed input before a proof can read proven.

Repair: compare the input's actual dependency meaning with the diff. Expand added/deleted paths to affected listing inputs, including root and recursive listings, while retaining the concrete changed path for the rerun. Do not apply a plain path intersection to listing tokens. Add this cold/warm/control triple.

## 2. Proven blocker: key inputs outside module imports bypass the check

Locations: `src/core/proof/inputs.ts:23` and `src/core/proof/inputs.ts:49`; `src/cli/proof-inputs.ts:45` omits runner environment files.

The new check recognizes conventional config filenames, but not files a config imports. The runner's existing environment keys include those dependencies. This is a new loss in the proof check, not the recorder's documented reach limit.

At both A and HEAD, keep `vitest.config.mjs` unchanged:

```js
import env from "./runner-settings.mjs";
export default { test: { include: ["test/*.test.ts"], env } };
```

At A, `runner-settings.mjs` exports `{ MIN: "3" }`. At HEAD it exports `{ MIN: "1" }`; also change the visible source value as above. The unchanged test obtains its threshold with `const min = Number(process.env.MIN)`.

The source-only call from blocker 1 gives **exit 0, `proven`, two runs**, both stored. Repeating it gives **exit 0, `proven`, zero runs**. Only `src/value.ts` appears as settled, with no unmet input or reruns. Add `--with runner-settings.mjs`: **exit 1, `not red`**.

The HEAD test's configured threshold already passes over A's source. Red instead uses A's test configuration and supplies a failure that does not establish the requested proof. Renaming a dependency to a conventional config filename would change whether the new check notices it.

`src/runners/vitest/environment.ts:57` already returns the config and its `configFileDependencies`, setup/global-setup closures and missing candidates as environment files. Its resolved config also includes `test.env`. Those values distinguish the actual executions' keys, but the new check reads only test closure paths, shared observed paths and the filename expression.

A second form omits policy-declared inputs. Use `inputs: ["support/min.txt"]` in Squeal config at both versions, and have the unchanged test obtain its threshold inside a Python child:

```ts
import { execFileSync } from "node:child_process";
const code = 'from pathlib import Path; print(Path("support/min.txt").read_text())';
// In the test body:
const min = Number(execFileSync("python3", ["-c", code], { encoding: "utf8" }));
```

Change the declared file from 3 to 1 along with source from 1 to 2. The source-only call still exits **0, `proven`, two runs**. An independent regression assertion expecting exit 3 failed on exactly this result. Adding `--with support/min.txt` gives **exit 1, `not red`**. A separate fresh-key comparison, changing only the data while keeping source equal, produces different keys. This file was explicitly declared to Squeal and affects its key; the proof cannot dismiss it as invisible to the key system.

`src/core/code/gate/stored.ts:338` exposes the runner closure as `loads`, while `src/core/scheduler/keying.ts:521` assembles the final key closure with declared inputs. The new proof adds observed rows to the former but never adds declared inputs. Treating `at.loads` as the entire keyed closure is incorrect.

Repair: feed each runner's real environment/config files and the final assembled key closure into the check for each side. Preserve the same completeness boundary as keys rather than introducing a second list of config names. Add the imported-config/control pair, a transitive dependency, and the declared-native-input case.

## 3. Proven blocker: an existing store is mistaken for a complete record of an unstored run

Locations: `src/cli/proof-inputs.ts:42` and `src/cli/proof-case.ts:47`. `unrecordedWhy` accounts for conditions and repeat, but not other runs that do not merge their reads. When the main store merely exists, the new check treats empty observation rows as complete.

Use the common fixture with the threshold read in the test process:

```ts
import { readFileSync } from "node:fs";
// ...the imports in the common setup
it("row", () => {
  const min = Number(readFileSync("support/min.txt", "utf8"));
  expect(value).toBeGreaterThanOrEqual(min);
});
```

A has `support/min.txt` containing `3`; HEAD changes it to `1` along with the visible source value. Both A and HEAD have `coverage.enabled: false` in Squeal policy. The main store exists from an earlier ordinary proof; it has no observation for this named test.

A complete natural history, without editing stored results:

1. With coverage enabled, add an unrelated passing `test/seed.test.ts` and run `squeal proof test/seed.test.ts --base HEAD --case source`. It returns `not red` and stores that pass.
2. Commit only `coverage.enabled: false`. This is A.
3. Commit the source and threshold changes. This is HEAD.
4. Run the source-only call from blocker 1 for `test/a.test.ts`.

Actual: **exit 0, `proven`, two runs**, neither stored. Both sides say `the gate keeps a result only with coverage on`. The changed data file is not reported. Add `--with support/min.txt`: **exit 1, `not red`**. The same result also reproduces with a normally initialized empty main store and no seed result; the main store's observed rows remain empty.

An otherwise identical fixture with no store correctly returns exit 3 after red: `changed input support/min.txt was not named; no store holds the runs' reads`. Thus the result depends on unrelated store history. A database's existence does not establish that this execution's reads were merged.

This is a supported in-process `readFileSync`, the very fifth-review input now checked with coverage on. It is not a recorder reach limit. No new stored result is corrupt in this case, because neither run is stored; the proof verdict is false.

Repair: carry per-side input-recording provenance through the run result. When a run did not record/merge its reads, take the conservative unnamed-path route or use the run's own observations directly. Apply this to coverage-off and other non-forced reasons that prevent a merge, not just conditions/repeat or a missing database. Add the natural-history/control reproduction and preserve the passing empty-store refusal.

## Closed cases and storage checks

The five fifth-review reproductions pass in `test/cli/proof-inputs.test.ts`: `test/rows.ts` stops before running; `--with` then proves its test-only change. `--source test/value.ts` overrides copying, chooses source case and proves with the actual old value on red. Computed import, in-process file read and direct `vitest.config.mjs` environment changes now give exit 3 with the omitted path and exact reruns; their `--with` controls read `not red`. Runtime-only discoveries can require red to run before refusal, as the new design states.

The seven prior static Vitest cases still stop with exit 3 and zero runs: direct helper, API barrel, data-only import, commented importer, package `#api`, tsconfig alias and declared local package re-exporting Vitest. Their mixed `--with`/`--source` controls read `not red`. The commented node:test `require` case passes its focused real-adapter test. An independent `process.getBuiltinModule("node:test")` case also stops before running and reads `not red` with the correct flags. Product source proof, mixed flags, conflict exit 2, transitive added helpers, absent-source refusal, unused warnings and report/JSON checks pass.

B2/N1 spot checks pass: errors without stage refresh before they can count as red; legacy hook assertions stay exit 3; deliberate body errors and assertions retain evidence. Import/setup failures cannot be accepted by `--red-error`. The old-field daemon socket refuses the new fields and accepts the stripped retry. Key-format and runner-boundary checks pass. No key format or schema change was introduced.

Independent combined-flags checks use `--with support/rows.ts --source src/value.ts --red-error 'wait sentinel'` across `alpha` and `beta`. Both prove with their own `E_WAIT` text and thrown label. First call: four runs, stored separately. Second call: zero runs, each project's own evidence. Under an environment condition the differing failures remain not comparable, exit 3; nothing conditioned is stored and shared result rows stay **8 before and 8 after**. The new late check does not damage this established behavior.

For blockers 1 and 2, stored rows describe the executions that actually ran; the zero-run repeats show that the missing settlement persists on store reuse. No wrong-key write was established. The failure is presenting those differing test inputs as a proof without asking the caller to settle them. Blocker 3 writes neither side.

## Recorder limits inherited from keys

Spec 011's “Non-goals, as amended” leaves network and general environment variables outside the closure. C12 (“Observed runtime inputs”) also names non-Node child reads, native file access, the runner's own process, outside-worktree paths and other excluded paths as not seen, with declared `inputs` as the way to cover project files that cannot be observed. Node children are not universally invisible: the recorder propagates to supported Node children and threads.

A corrected independent fixture reads `support/min.txt` inside a Python child using `execFileSync("python3", ["-c", code])`. The source-only call reads proven; the native read is absent from the keys too. Adding only `--with` after that call reuses the same stored evidence, because no key input names the hidden file. This is the existing key limitation, not a new recording loss introduced by this delta. Network responses have the same documented exclusion; no network probe was run. These limits must bound what a proof claims. Once the native-read file is declared in `inputs`, it is part of the key boundary; losing it in proof is blocker 2 above. The inherited limits do not excuse recorded listings, runner environment inputs, declared files, or the coverage-off completeness failure.

A fresh Python `import_module` fixture returns exit 3, zero runs, “no runner lists it” for both default and explicit-control calls. The CLI's unchanged `daemonAdapters` only creates Vitest and node:test adapters. This is a pre-existing limitation, not evidence of a working pytest proof and not a new blocker here.

## Inputs for the next repair

Keep the now-closed name/copy and direct-runtime cases. Align the new check with the existing key model: listing semantics, runner environment inputs, and actual per-run observation provenance. An existing shared store is not a completeness signal. Preserve conservative forced-run behavior, exact reruns, project-specific evidence and conditioned-store isolation. No importer classifier needs to return.
