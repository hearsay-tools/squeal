# Wave 14 third review: stop when unsure

FAIL 58323ff031ee17af3cd59112cf514b5fd9065428

Two proven blockers remain within the prior B1 mechanism. Unresolved test-API aliases can supply false product-code evidence. Comment text can also supply that evidence without an import. Each produces `proven` for a test that passes on old source when its actual HEAD helper is copied. The original direct-import, local-barrel and data-only reproductions now stop correctly. The previous B2 (legacy red evidence) and N1 (older daemon) remain closed in the spot checks.

Scope: `6706be97b..58323ff03`, the source-classification repair and its version/bundle commits, bounded by `3dc149e14:docs/specifications/023-results-at-commit/reviews/wave-14-rereview.md` and the parent's third-look cases. Reviewed against the human-approved D5.2 amendment at main `cab138d08`, "A: stop when unsure", including: "Squeal never reads `proven` over a changed import it did not settle; file names alone never settle one." The amendment is not in this candidate's spec file. No product code changed during review.

## Verification

`git rev-parse HEAD` returned `58323ff031ee17af3cd59112cf514b5fd9065428`, candidate `cand/0.1.568`. The tree stayed clean during the checks. Dependencies were already installed. No repository install, full suite, build or version raise ran.

| Command or evidence | Actual result |
| --- | --- |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3770 files in 1875ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0. |
| `timeout 600 pnpm run check:private` | Exit 0: `6920 added lines in 82 files ... ok`. The local private denylist is empty; that rule was skipped. |
| Focused command below | Exit 0: **12 files, 133 tests passed**, 83.91 s. |
| Independent reproduction command below | Exit 1: **5 passed, 3 failed**, 52.43 s. The failures are the package-alias, tsconfig-alias and comment reproductions below: expected exit 3, actual exit 0. Their explicit `--with` controls all returned exit 1, `not red`. |
| Independent combined-flags command below | Exit 0: **1 test passed**, 16.23 s. Two projects, coded errors, reuse, JSON and conditions/storage. |
| Installed `squeal checks` | Default tests check; 1,998 files, 1,510 pass and 488 not current at revision 8. Launcher selected installed 0.1.566. These are not exact-candidate results. |
| Installed `squeal status --wait 60000 test/cli/proof-with.test.ts test/proof/imports.test.ts` | Exit 3: daemon stopped; selected files included one queued file. Worktree: 488 not current, 474 queued and 14 unknown. No daemon validation claimed. The task requires direct tests. |
| Exact-candidate CI | [CI 44505131751](https://github.com/hearsay-tools/squeal/actions/runs/44505131751) in progress when checked. [Private material 44505131742](https://github.com/hearsay-tools/squeal/actions/runs/44505131742) passed. Full-suite result is unverified, not a blocker. |

```sh
timeout 600 pnpm exec vitest run \
  test/cli/proof-with.test.ts test/cli/proof-legacy.test.ts \
  test/code/gate/keep-older-fields.test.ts test/cli/proof-evidence.test.ts \
  test/cli/proof-conditions.test.ts test/cli/proof-report.test.ts \
  test/cli/proof-args.test.ts test/proof/imports.test.ts \
  test/proof/red-evidence.test.ts test/proof/verdict.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts --maxWorkers=2

timeout 600 pnpm exec vitest run --root /tmp/wave14-third-probes \
  --config /tmp/wave14-third-probes/vitest.config.mjs \
  /tmp/wave14-third-probes/review.test.ts --maxWorkers=1

timeout 600 pnpm exec vitest run --root /tmp/wave14-third-probes \
  --config /tmp/wave14-third-probes/spot.config.mjs \
  /tmp/wave14-third-probes/spot.test.ts --maxWorkers=1
```

The temporary harness imported the candidate's fixture helpers, `proofCommand` and core classifier. Proof calls used real Git, the real source CLI child and the real Vitest adapter. Its install seam linked the already-installed Vitest, as the repository's integration fixtures do; it did not independently verify a frozen package-manager install. Every proof call checked that no temporary checkout or extra worktree remained. The 5,000-file limit check used an in-memory `Tree`. Harnesses and observations were outside the repository and removed before committing. All reviewer-started jobs exited.

## 1. Proven blocker: unresolved aliases turn a test importer into product evidence

Locations: `src/core/proof/import-graph.ts:85`, `src/core/proof/import-graph.ts:140`, `src/core/proof/imports.ts:90`.

The graph skips non-relative JavaScript specifiers and returns `none`. The classifier treats that answer as evidence that a candidate importer is not test code. The worker notes disclose that a test API behind an alias is not followed, but that limit is unsafe when the same file supplies product-code evidence for another changed import.

Reproduction: use an ordinary Git fixture with coverage enabled (`squeal.config.json` is `{}`), Vitest include `test/*.test.ts`, and these unchanged files:

```ts
// test/a.test.ts
import { runRows } from "../support/rows";
runRows();
// support/api.ts
export { it, expect } from "vitest";
// support/rows.ts
import { it, expect } from "#api";
import { min } from "./data";
import { value } from "../src/value";
export function runRows() {
  it("row", () => expect(value).toBeGreaterThanOrEqual(min));
}
// src/main.ts: a real product importer for the source-fix control
import { value } from "./value";
export const main = value;
```

The unchanged `package.json` is:

```json
{"name":"fixture","type":"module","imports":{"#api":"./support/api.ts"}}
```

At base A, `src/value.ts` exports `value = 1` and `support/data.ts` exports `min = 3`. Commit HEAD with only those values changed to 2 and 1 respectively. HEAD's test passes on either source version if its test data is kept at HEAD.

| Command | Observed |
| --- | --- |
| `squeal proof test/a.test.ts --base A --json` | **Exit 0, `proven`, two runs**. Red fails `expected 1 to be greater than or equal to 3`; green passes. |
| Same call with `--with support/data.ts` | **Exit 1, `not red`**. HEAD's threshold 1 passes on old source. |

The successful JSON has `unsettled: []`, `stopped: false`, and a source entry `{ "path": "support/data.ts", "why": "imported by support/rows.ts" }`. Both rerun fields are `null`. `support/rows.ts` registers tests and calls assertions, so it cannot establish that data is product code. The proof instead ran the old test-data value on red.

A second real proof reproduces the same result with tsconfig paths. Replace `#api` with `~/api`; remove the package imports field; add:

```json
{"compilerOptions":{"paths":{"~/*":["./support/*"]}}}
```

Use this unchanged `vitest.config.mjs`:

```js
export default {
  resolve: { tsconfigPaths: true },
  test: { include: ["test/*.test.ts"] }
};
```

Again, default exit **0**, `proven`, two runs; `--with support/data.ts` exit **1**, `not red`. This is not a failure to discover the changed data in the runner's closure: the JSON names it and incorrectly settles it.

One-worker repair: retain uncertainty when a target or proposed importer has imports the classifier cannot resolve. Such an importer must not establish product-code status. Either use the runner's resolved import graph or return an unknown answer for unsupported aliases and stop with the two exact reruns. Full alias support is not needed to refuse safely. Add both alias/control pairs, and preserve the real product-import control.

## 2. Proven blocker: a commented-out import establishes product-code status

Locations: `src/core/proof/import-graph.ts:43`, `src/core/proof/imports.ts:129`, `src/cli/proof-imports.ts:118`.

This is a separate false-positive path in the same new classifier. `git grep` finds candidate importers, but the follow-up regular expression also accepts comment text as an import. No project file needs to import the data at all.

Reproduction: keep the base/HEAD values and `src/main.ts` from blocker 1. Replace the thin test with this unchanged direct test:

```ts
import { it, expect } from "vitest";
import { value } from "../src/value";
import { min } from "../support/data";
it("row", () => expect(value).toBeGreaterThanOrEqual(min));
```

Add this unchanged product file; it is not loaded by the test:

```ts
// src/example.ts
// import { min } from "../support/data";
export const label = "example";
```

No alias or API barrel is needed. Run the same commands:

| Command | Observed |
| --- | --- |
| `squeal proof test/a.test.ts --base A --json` | **Exit 0, `proven`, two runs**. Red uses base's threshold 3. |
| Same call with `--with support/data.ts` | **Exit 1, `not red`**. HEAD's threshold 1 passes on old source. |

The successful JSON attributes product-code status to `imported by src/example.ts`, with no unsettled paths or reruns. That file has no import declaration. This violates the amended rule's requirement that Squeal show an actual non-test importer. An unrelated example comment changes the safety decision from stop to a false proof.

One-worker repair: use syntax-aware import extraction for positive importer evidence, or refuse to settle a candidate whose import cannot be established. A text search can select candidates; it cannot establish an import. Add this proof/control pair and parser cases for comments and string literals. Do not remove the conservative stop to make the existing tests pass.

## What now fits

Independent checks on this exact candidate closed the old literal reproductions:

| Case | Actual result |
| --- | --- |
| Original changed `support/rows.ts` directly imports Vitest | Exit 3, zero runs, exact `--with support/rows.ts` rerun. Control exit 1, `not red`. |
| Changed rows take Vitest through unchanged `support/api.ts` | Exit 3, zero runs, exact same rerun; evidence names the barrel. Control exit 1, `not red`. |
| Changed data-only helper, directly imported by named test | Exit 3, zero runs, exact `--with support/data.ts` and `--source support/data.ts` reruns. `--with` control exit 1, `not red`. |
| Source fix imported by real `src/main.ts` | Exit 0, `proven`, no flag. Product-code evidence names `src/main.ts`. |
| Source file only the named test imports | Exit 3; `--source src/value.ts` gives exit 0, `proven`. |
| Same path in `--with` and `--source` | Exit 2 with the conflict named. |
| More than 5,000 local files reachable from a candidate importer | `reachesTestApi` returns `unknown`; neither that file nor its imported changed target is settled. This is a core check, not a 5,000-file CLI run. |

The 133 focused tests cover text reruns, quoting, JSON, unchanged-test stops, per-file aggregation, stage-based red evidence, legacy refresh, previous-field refusal/retry, conditions and key-format boundaries. No name-list repair is needed for the passed direct/barrel/data cases.

The new diff does not change the earlier B2 evidence classifier, its gate refresh boundary, or N1's sender retry. Their focused tests pass: a legacy hook assertion is rerun and remains exit 3; a legacy body assertion and deliberate body error refresh once and then reuse; the older-parser socket refuses the new fields and accepts the stripped retry. The exact previous-parser probe from the second review remains the stronger historical evidence; this third look uses the current focused socket tests and confirms no sender change.

An independent combined call used `--with support/rows.ts --red-error 'wait sentinel'` with projects `alpha` and `beta`. Each red failure carried `code: E_WAIT` and its own project name. Both read labelled `proven`; first call ran four file/project sides, second call ran zero and reused each project's own text. JSON retains the `with` paths, empty `source` paths and `redErrors`. Under an environment condition both projects read `not comparable`, exit 3; the shared result count stays **8 before and 8 after**, and neither conditioned result is stored.

## Inputs for the next repair

Keep the human's "stop when unsure" rule. Both blockers concern false evidence used to settle a changed import, not a need to weaken that rule. Give positive importer evidence one owner, with distinct answers for test, product and unknown; unsupported resolution and non-code text must never become product evidence. Preserve the original three stop/control pairs, the real source-import proof, `--source`, the walk limit, B2's explicit stage rule and N1's refusal-only retry. A re-review must reproduce the alias and comment pairs above on the rebuilt candidate.
