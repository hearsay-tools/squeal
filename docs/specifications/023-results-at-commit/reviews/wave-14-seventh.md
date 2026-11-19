# Wave 14, seventh review: FAIL

Candidate: `cand/0.1.569`, `acaccc2b7bb25419125f80a50de12bcd2c222627`.
Contract: D5.2 as amended on main `e33f7201b` (“A: every changed file”), D5.5, and the sixth review. **Two proven blockers:** a deleted `--with` file yields a false proof, and case selection suppresses the required stop on unrelated-only changes. The six earlier reviews' reproduced input-detection failures are closed by the whole-diff rule. No unnamed tracked input reached `proven` in these checks.

## Verification

The candidate SHA matched exactly. These checks ran on a clean product tree before this report was added:

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

Lint: **3,785 files checked**, exit 0. Typecheck: exit 0. Focused tests: **15 files, 138 tests passed**, exit 0, 119.79 s. Installed Squeal status returned exit 3: daemon stopped at revision 8, 488 of 1,998 test files not current (474 queued, 14 unknown), no validated verdict for the changed proof paths. The brief and unavailable daemon validation required direct tests.

Exact-candidate [CI 44534306059](https://github.com/hearsay-tools/squeal/actions/runs/44534306059) was in progress at the last observation. [Private material 44534304388](https://github.com/hearsay-tools/squeal/actions/runs/44534304388) passed. No full suite, build, repository dependency install or version change was run.

Independent probes ran outside the worktree through `timeout 600 pnpm exec vitest run`, with an explicit temporary config and test path, one worker, and the repository's teardown. They used temporary Git repositories, the real proof command, child CLI and runner adapters. Their install linked the existing Vitest, as the repository's integration fixtures do; this does not independently verify a frozen package-manager install. The first probe job had four passing controls and one failing assertion on blocker 2. The deletion probe failed its expected-`not red` assertion on blocker 1, after recording its reuse and removal control. The independent Python-import control passed. Fixtures and checkouts were removed; all jobs exited. The report is the only committed file.

## 1. Proven blocker: a deleted `--with` file remains on the red side

Locations: `src/core/proof/sides.ts:114`, called at `src/cli/proof.ts:264`; the copy preparation and expected-tree construction at `src/core/commit/at-keys-side.ts:89` and `:103` cannot represent this deletion.

D5.2 says `--with` names test code “copied from the test version.” The new whole-diff rule includes deletions and prints a `--with` rerun for them. Naming a deletion clears the stop, but does not remove the old file from the code checkout. The test thus still has different test data on the two sides after the caller settled it as test data.

Create a Git repository with package type `module`, `squeal.config.json` containing `{}`, and `vitest.config.mjs` containing:

```js
export default { test: { include: ["test/*.test.ts"] } };
```

Commit A has `src/value.ts` exporting `const value = 1` and `support/marker.txt` containing `marker`. At both A and HEAD, keep `test/a.test.ts` exactly:

```ts
import { it, expect } from "vitest";
import { existsSync } from "node:fs";
import { value } from "../src/value";
it("value", () => {
  const min = existsSync("support/marker.txt") ? 3 : 1;
  expect(value).toBeGreaterThanOrEqual(min);
});
```

HEAD changes the value to 2 and deletes `support/marker.txt`. Run:

```sh
squeal proof test/a.test.ts --base A --source src/value.ts --json
```

Correct initial stop: **exit 3, zero runs**, `support/marker.txt` listed as unsettled. Now follow the test-code choice:

```sh
squeal proof test/a.test.ts --base A \
  --source src/value.ts --with support/marker.txt --json
```

Actual: **exit 0, `proven`, two runs, both sides stored**. Red fails `expected 1 to be greater than or equal to 3`. Both reruns are null and no unsettled path remains. Repeat the call: **exit 0, `proven`, zero runs**, red and green read from the store.

Expected: the HEAD test version has no marker. With that same test input on red, `1 >= 1` passes, so the result is **`not red`**. Control: add `--without support/marker.txt` to the mixed-flags call. Actual: **exit 1, `not red`, one run**, red passes and is not stored because it has a condition. This confirms that the retained base file supplies the false red evidence.

`testSideCopies` iterates only entries present in the test version. A path deleted there never enters the copy plan. The existing expected-tree check then expects the base marker to remain and permits storage. No wrong-key write was established: stored results describe the execution that ran. The requested mixed side is wrong, and its false proof survives reuse.

Repair: represent test-side removals as well as writes. Remove a `--with` path that the test version lacks but the code version holds, and require that absence in the expected-tree check before storage. Refuse the side if that state cannot be represented. Cover the deletion/control/reuse triple and a rename whose old path affects a listing or existence check. Preserve `--source` paths at their code version.

## 2. Proven blocker: case selection hides the unrelated-file stop

Locations: `src/cli/proof.ts:188`, `src/cli/proof-case.ts:27` and `:32`.

D5.2 requires every unsettled changed file to stop the unchanged test with exit 3, the file list and exact `--with`/`--source` reruns. This now includes unrelated files. The implementation computes that stop, then asks stopped files to choose a proof case. If no changed path is in their closure or flags, case selection returns usage before the stop can be rendered.

Use the same runner configuration as blocker 1. At both A and HEAD, `src/value.ts` exports 2 and this test is unchanged:

```ts
import { it, expect } from "vitest";
import { value } from "../src/value";
it("value", () => expect(value).toBe(2));
```

Only `docs/note.md` changes from `old` at A to `new` at HEAD. Run:

```sh
squeal proof test/a.test.ts --base A --json
```

Actual: **exit 2**, no JSON report, no unsettled path and no flag reruns. Stderr says:

```text
squeal proof: <A>..HEAD changes nothing test/a.test.ts loads; give --case source or --case test
```

Control: add `--case source`. Actual: **exit 3, zero runs**, `docs/note.md` listed, both exact reruns present. Alternatively, name `--with docs/note.md` without an explicit case: **exit 1, `not red`**, one red pass. The call has enough information to explain the stop before choosing a case. This is a report/exit-contract failure; it produces no false proof.

Repair: render an all-stopped result before requiring a case for those files. Choose a case only for files that can proceed, while retaining usage errors where no stop applies. Add unrelated-only, deletion-only and several-stopped-test fixtures without `--case` or flags. Require exit 3, zero runs, file lists and exact reruns.

## Closed cases and preserved behavior

The seven static Vitest cases pass with exit 3 and zero runs, followed by mixed-flags controls that read `not red`: direct helper, local test-API barrel, data-only import, commented importer, package `#api`, tsconfig alias and a declared local package re-exporting Vitest. The focused real node:test test covers `require /* comment */ ("node:test")`. An independent `process.getBuiltinModule("node:test")` fixture also stops before running and reads `not red` with data under `--with` and product code under `--source`.

Fifth-review cases pass: changed `test/rows.ts` stops, and its test-only control proves; `--source test/value.ts` overrides the copy rule and proves a product fix. Computed import, `readFileSync` data and direct runner configuration stop before any run, with exact reruns; their `--with` controls read `not red`.

All three sixth-review blockers close in the focused checks. Added directory entries, imported config dependencies, declared Python-child inputs and coverage-off runs after an existing stored seed now stop with exit 3 and zero runs. Their `--with` controls read `not red`. An independent undeclared Python-child file read also stops despite an empty read mark, then reads `not red` with the file named. An independent Python `import_module("support.data")` reached from a Vitest test has the same stop/control result. A directly named Python test remains outside this CLI's runner support; the earlier “no runner lists it” result is not a working pytest proof.

The read mark is help only. Focused text/JSON checks mark the imported product input while leaving unrelated docs unmarked; both still need a flag. An independent fixture combining a rename, deletion, executable-mode change and source fix lists all five paths, including both rename paths, stops with zero runs and stores no result. Naming every path with `--source` proves the genuine product fix in two runs; the repeat reuses both sides with zero runs. This verifies diff coverage and product-side deletion, not the broken test-side deletion in blocker 1.

B2 remains closed: legacy failures without `stage` are refreshed before they can count as red. Hook assertions remain exit 3 on the default evidence rule. Body assertions and deliberate body errors retain their labels. Import/setup failures cannot be accepted by `--red-error`; the existing explicit hook-error acceptance control remains intact. N1's socket fixture verifies refusal by the old field parser followed by acceptance of the stripped retry. Key-format and runner-boundary checks pass.

Independent combined-flags checks use `--with support/rows.ts --source src/value.ts --red-error 'wait sentinel'` across `alpha` and `beta`. Omitting the helper stops both with zero runs and zero stored results. With all flags, each project proves with its own coded `E_WAIT` text and `thrown` evidence: four runs, then zero on reuse. Under an environment condition, differing failures read `not comparable`, exit 3; no conditioned evidence is stored, and shared result rows stay **8 before and 8 after**. A conflicting `--with`/`--source` path returns exit 2 and leaves those rows unchanged.

The proof, copy, evidence and store paths exercised after rebasing onto 0.1.567 retain their prior behavior apart from the intentional whole-diff rule. The bounded source comparison shows that the previous late-input check was removed and the recorded-input reader now supplies marks only. It does not establish every unrelated scheduler change on main; no broad re-review was attempted.

## Limits inherited from D4 and keys

No changed Git path was omitted from the stop in these probes. `changedPaths` uses `git diff --name-only --no-renames -z base HEAD --`, so the safety set no longer depends on import resolution, runner configuration, observations, coverage or native-child recording. Blocker 1 is failure to implement a named test-side version, not a missing diff entry.

Files outside Git remain bounded by the existing model. D5.1 installs each side in its clean code-version checkout. D4's whole-checkout check compares tracked paths, modes and links with the expected tree; it does not snapshot the outside world. Keyed closure paths that Git lacks are subject to D4.9's `not comparable (needs path)` refusal. Installed packages use the existing frozen-install and environment-fingerprint rules. The probe install only links prepared Vitest, so no new claim about package installation is made here.

Spec 011's non-goals and C12 exclude network responses, general environment variables, outside-worktree inputs and unsupported native reads from automatic observation. Untracked generated inputs and external state are not added to the Git diff by the new rule. These are inherited key/checkout limits, not a new loss introduced by deleting the late-input check. A tracked file read invisibly by a native child is now covered by its Git change, as independently checked above. No network probe was run. The rule's completeness claim applies to committed files; it cannot establish equality of external state.

## Inputs for the repair

Keep the whole-diff rule and help-only marks. Repair test-side absence and the all-stopped case-selection order. Keep the passing old-input controls, project-specific evidence, legacy refresh, older-daemon fallback, exact reruns and conditioned-store isolation. Do not bring importer classification or late observation-based settlement back.
