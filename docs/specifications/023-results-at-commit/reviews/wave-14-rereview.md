# Wave 14 re-review: imported test code and legacy evidence

FAIL 6706be97b67af875b7e7e032563a3714aa77967d

One proven blocker remains in B1. Its direct test-API import reproduction is fixed, but local API barrels still allow the same false proof. The disclosed data-only limit also permits a false `proven`; the runtime note does not qualify that verdict. B2 and N1 are closed in the tested cases.

Scope: the repairs after `823e5d34a` through the force-pushed `cand/0.1.567` at `6706be97b`, including the verdict split and rebuilt bundles. This is bounded by B1, B2 and N1 in `cc4da8f26:docs/specifications/023-results-at-commit/reviews/wave-14.md`, plus the changed gate/child boundary and the combined path the parent requested. No product code changed.

## Verification

`git rev-parse HEAD` returned `6706be97b67af875b7e7e032563a3714aa77967d`. The candidate tree stayed clean throughout the checks. Independent harnesses and their logs lived under `/tmp`, outside the worktree. No install, full suite, build or version raise ran.

| Command or evidence | Actual result |
| --- | --- |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3762 files in 1301ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0. |
| `timeout 600 pnpm run check:private` | Exit 0: `5047 added lines in 80 files ... ok`. Local private denylist empty; that rule was skipped. |
| Focused command below | Exit 0: **11 files, 108 tests passed**, 75.06 s. Includes key-format and runner boundaries. |
| External reproduction harness | Exit 0: **8 tests passed**, 55.52 s. Direct API, local API barrel, data-only helper, three legacy-error cases, exact previous-parser socket, combined flags/projects/conditions. |
| External gate-scope harness | Corrected run: exit 0, **1 test passed**, 6.33 s. The first run also passed, but supplied an invalid boolean instead of `RunArgs` to the status helper; only the corrected run supports the `status --at --run` claim below. |
| Session-pinned `squeal checks` | Default tests check; 1,998 test files listed, 1,510 pass and 488 not current at revision 8. Launcher selected installed 0.1.566 and reported the older Codex plugin. These are not exact-candidate test results. |
| Session-pinned `squeal status --wait 60000 test/cli/proof-with.test.ts test/cli/proof-legacy.test.ts test/code/gate/keep-older-fields.test.ts test/cli/proof-evidence.test.ts test/cli/proof-conditions.test.ts` | Exit 3: daemon stopped; no current verdict. Three known files queued; the two new files were absent from its old listing. Worktree had 488 of 1,998 files not current, 474 queued and 14 unknown. Direct tests above supply the targeted evidence. |
| Exact-candidate CI | [CI 44501027884](https://github.com/hearsay-tools/squeal/actions/runs/44501027884) still in progress when checked. [Private material 44501027742](https://github.com/hearsay-tools/squeal/actions/runs/44501027742) passed. Full-suite result is unverified, not a finding. |

Focused command:

```sh
timeout 600 pnpm exec vitest run \
  test/cli/proof-with.test.ts test/cli/proof-legacy.test.ts \
  test/code/gate/keep-older-fields.test.ts test/cli/proof-evidence.test.ts \
  test/cli/proof-conditions.test.ts test/cli/proof-report.test.ts \
  test/proof/imports.test.ts test/proof/red-evidence.test.ts \
  test/proof/verdict.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts --maxWorkers=2
```

The independent commands used the same installed Vitest with temporary configs:

```sh
WAVE14_REPO="$PWD" timeout 600 pnpm exec vitest run \
  --root /tmp/wave14-rereview-probes \
  --config /tmp/wave14-rereview-probes/vitest.config.mjs \
  /tmp/wave14-rereview-probes/review.test.ts --maxWorkers=1
WAVE14_REPO="$PWD" timeout 600 pnpm exec vitest run \
  --root /tmp/wave14-rereview-probes \
  --config /tmp/wave14-rereview-probes/scope.config.mjs \
  /tmp/wave14-rereview-probes/scope.test.ts --maxWorkers=1
```

Those fixtures use real Git, the source CLI child and the real Vitest adapter. Their install seam links the repository's installed Vitest, as the existing integration fixtures do; it does not independently test a frozen package-manager install. Each proof fixture checked that no temporary checkout or extra worktree remained. All reviewer-started jobs exited; temporary harnesses, observations and socket were removed before committing.

## B1. Proven blocker remains: a local test-API barrel bypasses the stop

Location: `src/core/proof/imports.ts:93`, `src/core/proof/imports.ts:125`, and the definitive report wording at `src/cli/proof-report.ts:220`.

The original direct-import reproduction now returns **3**, `not comparable`, **zero runs**, with `support/rows.ts` identified as importing `vitest` at HEAD. Its exact `--with support/rows.ts` rerun returns **1**, `not red`. That part of B1 is closed.

A nearby variant still violates the same D5.2 goal. Use the original fixture with source under `src/`, test include `test/*.test.ts`, coverage enabled, and these files at base A:

```ts
// src/value.ts
export const value = 1;
// support/api.ts, unchanged in both commits
export { it, expect } from "vitest";
// test/a.test.ts, unchanged in both commits
import { runRows } from "../support/rows";
runRows();
// support/rows.ts
import { it, expect } from "./api";
import { value } from "../src/value";
export function runRows() {
  it("row", () => expect(value).toBe(3));
}
```

At HEAD change `value` to 2 and the helper's assertion to `expect(value).toBeGreaterThanOrEqual(1)`. HEAD's test passes on both source versions.

| Command | Observed |
| --- | --- |
| `squeal proof test/a.test.ts --base A --json` | **Exit 0, `proven`, two runs**. Red fails `expected 1 to be 3`; green passes. `changedImports.testCode` is empty; `support/rows.ts` is listed as source; no stop or `withRerun`. |
| Same call again in text mode | **Exit 0, `proven`, zero runs**. Reuses the same mismatched test versions. |
| Same call with `--with support/rows.ts` | **Exit 1, `not red`**. Red passes with HEAD's actual helper. |

`testApiOf` checks each changed file's own text for a listed package specifier. The only file that names `vitest` is the unchanged barrel, so it never supplies evidence for the changed row helper. This helper registers tests and calls assertions. It is not the disclosed data-only case. Adding one more package name does not resolve this local-import case.

### The disclosed data-only limit also produces a false proof

A second independent control confirms the limit, rather than assuming it is harmless. Keep this test unchanged:

```ts
import { it, expect } from "vitest";
import { value } from "../src/value";
import { min } from "../support/data";
it("row", () => expect(value).toBeGreaterThanOrEqual(min));
```

Base A has `value = 1` and `support/data.ts` exporting `min = 3`. HEAD has `value = 2` and `min = 1`.

Without `--with`, proof returns **0, `proven`**, using base's threshold 3 on red. With `--with support/data.ts`, it returns **1, `not red`**, because HEAD's threshold 1 passes on old source. The default text still says:

```text
test/a.test.ts: proven
  the test is unchanged since <base>; source changes the proof compares:
  src/value.ts, support/data.ts (if one is test code, rerun with --with <path>)
```

The actual line is one line, wrapped above for readability. It names the path, but neither qualifies `proven` nor says that red used an older test-data value. The side header still claims the test at HEAD. That is not an honest proof of HEAD's test. A conditional instruction to rerun cannot repair the successful verdict the agent already received.

The parent's rule is implemented for direct listed API imports. The parent explicitly described it as a coordinator decision, not yet an amendment. The approved D5.2 and the original B1 no-false-proof goal remain the review contract. Even accepting the disclosed data-only limit would leave the barrel reproduction above outside that stated limit.

One-worker repair scope: make the changed-import rule conservative for indirect test-API use, including local re-exports, and do not certify ambiguous test-data changes as a proof of HEAD's test. Use an explicit source/test boundary approved by the human, or refuse ambiguity with the exact `--with` rerun. Do not fix this by growing a name list. If the coordinator wants to retain false-proof cases as a product limit, bring that policy and its runtime verdict/header wording to the human before acceptance. Add both reproduction/control pairs above while preserving the direct-import and ordinary source-change controls.

## B2. Closed: legacy failures refresh without inferring their stage

Independent fresh/legacy/reuse observations:

| Failure | Fresh | After removing the new fields | Next identical call |
| --- | --- | --- | --- |
| `beforeEach(() => expect(value).toBe(2))` | Exit 3, `red for another reason`, kind `hook` | Exit 3, kind `hook`, red **from run**, stored | Exit 3, red **from store**, zero runs |
| Body `expect(value).toBe(2)` | Exit 0, `proven` | Exit 0, assertion evidence; red **from run**, green **from store**, one run | Exit 0, zero runs |
| Body `Error("wait sentinel")` | Exit 0, labelled thrown | Exit 0, labelled thrown; red **from run**, one run | Exit 0, zero runs |

The legacy fixture removed only `stage` and `assertionEvidence`, then recomputed the failure-text content id and updated the result references. This avoids corrupting the content-addressed failure-text store. Keys, commits and outcomes stayed unchanged.

`recordedKind` now returns `unstaged` before assertion acceptance when the stage is absent. `--red-error` cannot override `unstaged`. `reusable` sends such a stored failure to a real run. The gate receives `rerunFailures` only for an unconditioned proof side that can store, so it refreshes the old failure instead of returning it again. The refreshed hook cannot prove the side. The `redVerdict` split preserves the tested outcomes.

### Gate and child scope

The extra gate/child edits are within B2's needed boundary. A two-file fixture first stored failures for `a.test.ts` and `b.test.ts`:

- A normal `runGateFiles` call for A returned `from: store` and changed no result rows.
- An explicit `rerunFailures: true` call for A returned `from: run` and replaced A's run id. B's complete result rows stayed unchanged.
- A call for A with `store: false, rerunFailures: true` ran A but changed no result rows.
- Ordinary `status --at HEAD --run --all-missing` over A returned exit 0 and changed no result rows. Stored failures remained stored observations.

Source tracing agrees: `status-at-run.ts` does not set the new option; the child and `runGateFiles` only forward/enable it when it is exactly `true`. No new normal CLI flag exposes it. The pre-existing regular gate's explicit regression-rerun path stays separate. No unintended rerun or overwrite was found in this changed boundary.

## N1. Closed: current sender interoperates with the exact previous parser

The independent socket probe loaded `keep-protocol.ts` from `85bf54763`, not a simplified field-list imitation. It sent a fully valid result record through the current `writeThroughDaemon`, with both new fields and an unrelated `code: E1`.

Observed: first request rejected for `stage`; second request accepted, writer returned **`kept`**. The second request had a new id, omitted both new fields, and retained the code and all other record fields. Exactly two requests reached the socket. Existing focused tests also pass the assertion-only field case and refusal of an unrelated extra field without retry.

This remains a protocol-level test, not a previous daemon lifecycle test. The writer waits for an explicit refusal before downgrading; it does not retry an ambiguous write as a fresh one. The downgrade cannot become automatic red evidence because B2 refuses missing stage information. A newer proof refreshes such a legacy failure instead of trusting it. No key-format or schema change was introduced.

## Preserved behavior and next inputs

The combined `--with support/rows.ts --red-error 'wait sentinel'` fixture still gives each project (`alpha`, `beta`) its own coded error text and labelled `proven` verdict. First call: four file/project side runs. Second call: zero runs, each project's own stored evidence. JSON retains the side `with` paths and top-level `redErrors`.

Under an environment condition, the same two differing project failures remain conservatively unattributed: both files `not comparable`, exit 3. The shared result-row count stays **8 before and 8 after**. Conditions still bypass storage. Existing focused tests cover rerun formatting, legacy rejection, evidence classification and normal helper/source controls. No new problem was found in these previously passing paths.

Keep B2's explicit stage requirement, one selected refresh and normal gate defaults. Keep N1's refusal-only retry and refusal to infer stage after downgrade. B1 remains the only blocker. Resolve the source/test boundary and the treatment of ambiguous changed test inputs before another implementation repair. Exact-candidate full-suite CI and daemon validation are still unverified; neither is a blocker in this review.
