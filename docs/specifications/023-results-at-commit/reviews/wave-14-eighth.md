# Wave 14, eighth review: PASS

Candidate: `cand/0.1.569`, `378988995e8e2a54104e149d4aea60f0658d0de2`.
Delta: `acaccc2b7..378988995`, product repair `bf52eb49a` and rebuilt bundles.
Contract: D5.2 (“A: every changed file”), D5.5, and `wave-14-seventh.md`. **Zero blockers.** Both seventh-review blockers close. The reversal of 023-08's removal rule produces the intended mixed test version and preserves the existing storage boundary. Its naming and install-mutation limits are stated below.

## Verification

The candidate SHA matched exactly. Checks ran on a clean product tree before adding this report:

```sh
pnpm run lint
pnpm run typecheck
timeout 600 pnpm exec vitest run \
  test/cli/proof-removals.test.ts test/cli/proof-inputs.test.ts \
  test/cli/proof-with.test.ts test/cli/proof-with-node-test.test.ts \
  test/cli/proof-copy.test.ts test/cli/proof-legacy.test.ts \
  test/code/gate/keep-older-fields.test.ts test/cli/proof-evidence.test.ts \
  test/cli/proof-conditions.test.ts test/cli/proof-report.test.ts \
  test/cli/proof-args.test.ts test/proof/imports.test.ts \
  test/proof/red-evidence.test.ts test/proof/verdict.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts --maxWorkers=2
```

Lint: **3,786 files checked**, exit 0. Typecheck: exit 0. Focused tests: **16 files, 144 tests passed**, exit 0, 331.78 s. Installed Squeal status returned exit 3: daemon stopped at revision 8, 488 of 1,998 test files not current (474 queued, 14 unknown), no validated verdict for the three changed proof paths. The brief and unavailable daemon validation required direct tests.

Exact-candidate [CI 44538797201](https://github.com/hearsay-tools/squeal/actions/runs/44538797201) remained in progress at the last observation. [Private material 44538797375](https://github.com/hearsay-tools/squeal/actions/runs/44538797375) passed. Full-suite CI is unverified here. No full suite, build, repository dependency install or version change was run for this review.

Independent probes ran outside the worktree with `timeout 600 pnpm exec vitest run`, an explicit temporary test path and config, one worker, and repository teardown. They used real Git fixtures, the real proof command, child CLI and runner adapters. Their installer linked the prepared Vitest; these probes do not independently verify a frozen package-manager install. Six scenarios covered the original failures, both removal directions, fresh keys, a product dependency, installer restoration and combined projects. The initial key assertions also selected successful file-completion rows; they were corrected to select `checks.kind = 'test'`. The two corrected key scenarios passed on rerun; the other four scenarios passed. This was a probe correction, not a product failure. All jobs exited and temporary probes were removed. This report is the only committed file.

## 1. Seventh-review B1 closed: deleted test-side inputs stay deleted

The independent reproduction keeps the seventh review's unchanged test, whose threshold is `existsSync("support/marker.txt") ? 3 : 1`. A has marker plus source value 1; HEAD deletes marker and changes source to 2.

| Call | Actual result |
| --- | --- |
| `--source src/value.ts` | Exit 3, zero runs, marker listed as unsettled. |
| Add `--with support/marker.txt` | Exit 1, `not red`, one red pass, stored. |
| Repeat the mixed-flags call | Exit 1, `not red`, zero runs, red from store. |
| Add `--without support/marker.txt` | Exit 1, `not red`, one red pass, not stored because conditioned. |
| Use `--source` for both source and marker | Exit 0, `proven`, two runs; red retains base's marker and fails `1 >= 3`. |

The repair changes `testSideRemovals` in `src/core/proof/sides.ts`, passes those paths through `sideOf`, and includes them in `sideKeys`' hidden expected-tree paths. The HEAD test input is now absent on red when the caller declares it test code. Declaring it product code keeps the base file instead. Both paths remain keyed after the actual mixed tree is prepared.

A separate fresh Git commit represents exactly the expected red tree: source value 1, HEAD test, marker absent. Its fresh gate key differs from A's retained-marker key. The shared store holds only a test pass at the mixed key and only a test failure at the retained-marker key. The successful file-completion records are separate check identities. No wrong-key write or reuse was found.

The reverse direction also works. A's test expects 3 when `test/marker.txt` is absent; HEAD adds that file and fixes the test to expect source value 2. In a test-case proof with the marker on the test side, red removes HEAD's added marker to reproduce A's test version, fails the assertion, and proves. Its stored test failure is at the fresh key of A's actual tree. Naming that marker with `--source` leaves HEAD's code-version file present, red passes and the result is `not red`.

The focused deletion/listing test also verifies `test/fixtures/b.json`: `--with` gives red one fixture and `not red`; `--source` retains base's two fixtures and proves. The whole-diff stop still precedes both choices.

## 2. Seventh-review B2 closed: the stop precedes case selection

The independent docs-only fixture has an unchanged passing test, unchanged source value 2, and only `docs/note.md` changed. With no flags or case, the command now returns **exit 3, zero runs, case null**, lists the file and supplies both exact reruns. Adding `--case source` gives the same stop and preserves the case in the reruns. Deleting the docs file instead gives the same results. Neither call writes a test result.

The focused test covers two unchanged named tests stopping together. An empty diff still returns usage exit 2 and asks for a case. Files that can proceed still choose their case normally; the repair does not assign one merely to render a stopped file.

## Removal boundaries checked

**A product dependency can have a test-side name.** The reversal uses the same `isTestSide` classification as copying, with `--source` taking priority. For unchanged named tests, the whole-diff rule makes the caller decide every changed path. For a changed named test, the older folder/name rule remains, as documented in 023-21's notes. Removal does not discover a path's intended role from its consumers.

An independent fixture makes base product code read `test/fixtures/product.txt` at module load. HEAD deletes the file, changes the product to return 2 and adds the named test. Without an override, the folder rule removes the file on red: **exit 3, `red for another reason`**, with a load failure, not `proven`. With `--source test/fixtures/product.txt`, red retains base's file, reports the real `expected 1 to be 2` assertion, and proves. Repeating that call uses the correct stored evidence with zero runs; it does not reuse the earlier missing-input error. Thus the new removal can affect something old product code needs, but `--source` prevents it. This remains an explicit classification boundary, not a new claim that folder names identify every product dependency.

**An installer can restore a removed path.** An independent installer recreates the marker only in the value-1 red checkout. The whole-checkout check names `support/marker.txt`; red says `stored: false`, `install changed the checkout: support/marker.txt`. Repeating runs red again and stores neither red result. Under an environment condition, the same restoration returns **exit 3, zero runs**, `the condition is not known to hold`; store rows stay **2 before and 2 after**.

An ordinary unconditioned proof still shows the altered install's observed verdict, labelled not stored. That is the previously accepted D4/023-08 behavior for install changes; this repair does not make such a verdict a byte-exact proof of the committed side. Removal is a test-version operation, not a new user condition. Its absence now participates in the same expected-tree check as writes. No new storage exception was found.

## Earlier classes remain closed

The focused checks cover direct helpers, test-API barrels, data-only imports, commented imports, package and tsconfig aliases, declared local API packages, commented node:test `require`, test-folder helpers and `--source` overriding the copy rule. They also cover computed imports, file reads, runner settings, imported config dependencies, directory listings, declared native-child inputs and coverage-off/store history. Unchanged named tests stop before any run; mixed test-input/product-input controls retain their expected `not red` results. Test-only helper fixes still prove when named as test code. Read marks remain help only.

Legacy failures without stage refresh before they can count as red. Hook assertions remain rejected by the default evidence rule. Assertions and deliberate body errors retain their labels; import/setup failures do not become accepted evidence through `--red-error`. The explicit hook-error acceptance control remains intact. N1's old-parser socket fixture still refuses the new error fields and accepts the stripped retry. Key-format, report, argument and runner-boundary checks pass.

The independent combined fixture adds a removed marker to the established `--with support/rows.ts --source src/value.ts --red-error 'wait sentinel'` proof across `alpha` and `beta`. If the marker is not named, both stop with zero runs and no stored results. With the marker also under `--with`, each project proves with its own coded `E_WAIT` text and `thrown` label: four runs, then zero on reuse. The helper throws a `TypeError` if the old marker remains, so the successful proof also checks removal in both projects. Under a condition, their differing failures remain not comparable, exit 3; nothing conditioned is stored, and shared rows stay **8 before and 8 after**. Conflicting `--with`/`--source` still returns exit 2 without changing those rows.

Outside-Git state keeps the D4/key limits recorded in the seventh review. The repair changes neither frozen-install keying nor the recorder's reach. No network or directly named Python proof was run here.

## Inputs for integration

Both seventh-review blockers are closed. Preserve the expected-absence check, `--source` priority, stop-before-case ordering, legacy refresh and project-specific evidence. Keep the documented limits for folder/name classification of changed named tests and for unstored install mutations. Exact-candidate full-suite CI remains a release requirement; this review does not replace it.
