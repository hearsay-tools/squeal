# Wave 14 fourth review: importer evidence from parsers

FAIL e4e141014e61b92a152731bea924bd59c9d08ecc

Two proven blockers remain in the prior B1 mechanism. A declared package can hide a test API, and valid Node API loads can disappear from the proof's import graph. Real CLI reproductions return `proven`; their `--with` controls return `not red`. The third review's alias and commented-import cases now stop correctly. The earlier B2 (legacy red evidence), N1 (older daemon) and combined-flags checks remain closed in the tested cases.

Scope: `58323ff03..e4e141014`, repair `bb542d265` plus rebuilt bundles, on force-pushed `cand/0.1.568`. This review follows `671158795:docs/specifications/023-results-at-commit/reviews/wave-14-third.md` and the parent's requested package, dynamic-load, Python and parser-boundary checks. The contract is amended D5.2 at main `cab138d08`, "A: stop when unsure": product-code status requires evidence, and "Squeal never reads `proven` over a changed import it did not settle." No product code changed during review.

## Verification

`git rev-parse HEAD` returned `e4e141014e61b92a152731bea924bd59c9d08ecc`. The candidate tree stayed clean throughout verification. Dependencies were already installed. No repository install, full suite, build or version raise ran.

| Command or evidence | Actual result |
| --- | --- |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3765 files in 1898ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0. |
| `timeout 600 pnpm run check:private` | Exit 0: `7481 added lines in 82 files ... ok`. Local private denylist empty; that rule was skipped. |
| Focused command below | Exit 0: **12 files, 142 tests passed**, 92.48 s. |
| Independent review/edge command below | Exit 1: **10 passed, 3 failed**, 43.53 s. Failures: declared test-API package gives false proof; core classifier accepts a commented `require` API load and an aliased Python loader as product evidence. |
| Independent spot/Node command below | Exit 1: **1 passed, 1 failed**, 20.56 s. Combined flags/projects/storage pass; real node:test proof through the commented `require` fails the required stop assertion. |
| Independent builtin command below | Exit 1: **1 failed**, 11.76 s. Real node:test proof through `process.getBuiltinModule` fails the required stop assertion. |
| Declared-package recheck below | Exit 1: **1 failed, 7 skipped**, 12.99 s. Same false-proof/control pair after adding explicit Vitest dev/peer declarations to the fixture manifests. This is the package fixture documented below. |
| Installed `squeal checks` | Default tests check; 1,998 files, 1,510 pass and 488 not current at revision 8. Launcher selected installed 0.1.566; these are not exact-candidate results. |
| Installed `squeal status --wait 60000 test/cli/proof-with.test.ts test/proof/imports.test.ts` | Exit 3: daemon stopped, one selected file queued; 488 worktree files not current, 474 queued and 14 unknown. No current daemon validation claimed. The task requires direct tests. |
| Exact-candidate CI | [CI 44510187380](https://github.com/hearsay-tools/squeal/actions/runs/44510187380) in progress when checked. [Private material 44510187447](https://github.com/hearsay-tools/squeal/actions/runs/44510187447) passed. Full-suite result is unverified, not a blocker. |

```sh
timeout 600 pnpm exec vitest run \
  test/cli/proof-with.test.ts test/cli/proof-legacy.test.ts \
  test/code/gate/keep-older-fields.test.ts test/cli/proof-evidence.test.ts \
  test/cli/proof-conditions.test.ts test/cli/proof-report.test.ts \
  test/cli/proof-args.test.ts test/proof/imports.test.ts \
  test/proof/red-evidence.test.ts test/proof/verdict.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts --maxWorkers=2

timeout 600 pnpm exec vitest run --root /tmp/wave14-fourth-probes \
  --config /tmp/wave14-fourth-probes/vitest.config.mjs \
  /tmp/wave14-fourth-probes/review.test.ts \
  /tmp/wave14-fourth-probes/edge.test.ts --maxWorkers=1

timeout 600 pnpm exec vitest run --root /tmp/wave14-fourth-probes \
  --config /tmp/wave14-fourth-probes/spot.config.mjs \
  /tmp/wave14-fourth-probes/spot.test.ts \
  /tmp/wave14-fourth-probes/node.test.ts --maxWorkers=1

timeout 600 pnpm exec vitest run --root /tmp/wave14-fourth-probes \
  --config /tmp/wave14-fourth-probes/builtin.config.mjs \
  /tmp/wave14-fourth-probes/builtin.test.ts --maxWorkers=1

timeout 600 pnpm exec vitest run --root /tmp/wave14-fourth-probes \
  --config /tmp/wave14-fourth-probes/vitest.config.mjs \
  /tmp/wave14-fourth-probes/review.test.ts -t 'declared package' --maxWorkers=1
```

The external harness used the candidate's fixture helpers, source CLI child and real Vitest or node:test adapter. Its install seam linked the already-installed Vitest. For the package case it also linked `node_modules/review-api` to the checkout's committed `packages/api`; it did not independently test a frozen package-manager install. Every proof checked that no temporary checkout or extra worktree remained. Python and walk-limit checks used in-memory `Tree` values. The Python probe is not a pytest CLI proof. Temporary probes and observations were removed before committing; all reviewer-started jobs exited.

## 1. Proven blocker: a declared package is trusted without checking its test API

Locations: `src/core/proof/import-graph.ts:115`, `src/core/proof/import-graph.ts:149`, `src/core/proof/imports.ts:98`.

Declaring a dependency accounts for its name, not whether its exports are test APIs. The graph does not follow it or retain uncertainty. An importer that registers tests through a declared wrapper is then accepted as non-test code. This recreates the false product-code evidence from the third review's alias case.

Reproduction: ordinary Git fixture, `squeal.config.json` `{}`, Vitest include `test/*.test.ts`. Keep these files unchanged between base A and HEAD:

```ts
// test/a.test.ts
import { runRows } from "../support/rows";
runRows();
// support/rows.ts
import { it, expect } from "review-api";
import { min } from "./data";
import { value } from "../src/value";
export function runRows() {
  it("row", () => expect(value).toBeGreaterThanOrEqual(min));
}
// packages/api/index.js
export { it, expect } from "vitest";
// src/main.ts: real product importer for value
import { value } from "./value";
export const main = value;
```

Root `package.json`:

```json
{"name":"fixture","type":"module","dependencies":{"review-api":"file:./packages/api"},"devDependencies":{"vitest":"5.0.3"}}
```

`packages/api/package.json`:

```json
{"name":"review-api","type":"module","exports":"./index.js","peerDependencies":{"vitest":"5.0.3"}}
```

At base A, `src/value.ts` exports `value = 1` and `support/data.ts` exports `min = 3`. Commit HEAD with only those values changed to 2 and 1. HEAD's test passes over old source when its actual HEAD data is copied.

| Command | Observed |
| --- | --- |
| `squeal proof test/a.test.ts --base A --json` | **Exit 0, `proven`, two runs**, both results stored. Red fails `expected 1 to be greater than or equal to 3`; green passes. |
| Same call with `--with support/data.ts` | **Exit 1, `not red`**. Red passes using HEAD's threshold 1 over old source. |

The default JSON has `unsettled: []`, `stopped: false`, and source evidence `{ "path": "support/data.ts", "why": "imported by support/rows.ts" }`. Both rerun fields are `null`. The named test is unchanged, and the only importer of the changed data is test code. The declared wrapper does not make that file product code.

One-worker repair: follow package exports using the runner's resolved graph, or leave any unexamined package uncertain. A manifest declaration must not establish the absence of test APIs. Keep the exact `--with`/`--source` reruns for uncertainty. Add this package/control pair without weakening the existing alias stops. Do not repair this by adding one wrapper package name to the API list.

## 2. Proven blocker: the parser wrapper loses valid Node test-API loads

Locations: `src/core/proof/import-graph.ts:90`, especially the regular expression at line 94 and the dropped `require` records at line 98; `src/core/proof/imports.ts:98`.

Two independent node:test proofs expose the incomplete parser contract. Use a fixture with this `squeal.config.json`:

```json
{"nodeTest":[{"name":"node","include":["test/*.test.cjs"]}]}
```

Keep these CommonJS files unchanged:

```js
// test/a.test.cjs
const { runRows } = require("../support/rows.cjs");
runRows();
// support/rows.cjs
const { test } = require /* valid comment */ ("node:test");
const assert = require("node:assert/strict");
const { value } = require("../src/value.cjs");
const { min } = require("./data.cjs");
exports.runRows = () => test("row", () => assert.ok(value >= min));
// src/main.cjs
const { value } = require("./value.cjs");
exports.main = value;
```

At A, `src/value.cjs` has `exports.value = 1` and `support/data.cjs` has `exports.min = 3`. At HEAD change only those values to 2 and 1.

| Command | Observed |
| --- | --- |
| `squeal proof test/a.test.cjs --base A --json` | **Exit 0, `proven`, two runs**, both results stored. Red fails with `AssertionError [ERR_ASSERTION]`; green passes. |
| Same call with `--with support/data.cjs` | **Exit 1, `not red`**. HEAD's threshold passes over old source. |

The JSON again says data is product code because it is `imported by support/rows.cjs`, with no unsettled paths or reruns. The file imports `node:test`, but the literal and computed `require` scans both miss valid comments between `require` and `(`. The wrapper therefore sees no test API and no uncertainty.

A second fixture changes only the API-load line to:

```js
const { test } = process.getBuiltinModule("node:test");
```

It gives the same **exit 0, `proven`** and **exit 1, `not red`** control. This case is a new loss in the wrapper itself: `parseModule` already records the builtin load as a specifier with `kind: "require"`; `jsSpecifiers` drops all such records and rebuilds only literal `require(...)` calls. It discards the test API that the runner parser knew about.

One-worker repair: preserve genuine builtin loads and make unparsed CommonJS calls uncertain. Use a parser result that records code imports and unresolved loads with their origin; filtering a mixed list and rebuilding it with a narrow regular expression is not sufficient evidence of absence. Add both CLI/control pairs, plus syntax cases with intervening comments and computed arguments. Keep the successful rejection of imports that appear only inside comments or strings.

## Parser boundary and Python note

Reusing pure parser functions is reasonable. The imported modules do not create runner adapters or start test processes. Python parsing is initialized when a Python source is inspected. No runner lifecycle or storage regression was found. The runner-boundary and key-format tests pass; the boundary guard protects runner-to-runner imports and `core/code`, not all imports from `core/proof`.

The semantic boundary is not yet sound for positive product-code evidence. The runner graph parser has a closure-building contract, including conservative extra `require` matches and separate incomplete-load signals. Proof needs both actual importer evidence and a reliable account of everything that could reach a test API. Blocker 2 shows that the wrapper loses a known import and mistakes missed syntax for evidence of absence. A shared language-parser module with that explicit contract would be a cleaner owner than relying on runner-specific scans. File placement alone is not another blocker.

**Nonblocking note: proven classifier gap, plausible end-to-end consequence.** An in-memory Python `Tree` with `support/data.py` containing `MIN = 1` and this importer:

```python
from importlib import import_module as load
from .data import MIN
api = load("pytest")
@api.mark.parametrize("x", [1])
def row(x):
    assert x >= MIN
```

makes `settle("support/data.py", ...)` return `{ settled: { path: "support/data.py", why: "imported by support/rows.py" } }`. The reused Python parser recognizes a loader by its call name, so `load` is neither an import of pytest nor a computed import. The new proof graph accepts the stdlib `importlib` import and concludes no test API is reachable. This is a real false classification at the changed boundary. A full pytest proof was not run, so that consequence is not an additional blocker. Include aliased dynamic loaders in the conservative evidence contract. Python packages that are not local are also accepted without reading their contents; that merits the same caution as blocker 1.

Core controls pass for literal `import("vitest")`, computed `import(p)`, string-built `require("vite" + "st")`, Python `importlib.import_module("pytest")`, literal `__import__("pytest")` and computed `importlib.import_module(p)`: each is test-API evidence or unknown, never evidence of no test API. A reach of more than 5,000 local files remains unknown and leaves both the importer and its changed target unsettled.

## What now fits

Independent exact-candidate observations, in addition to the 142 focused tests:

| Earlier case | Actual result |
| --- | --- |
| Direct Vitest helper, then local API barrel | Each stops, exit 3, zero runs, exact `--with support/rows.ts` rerun. Each control exits 1, `not red`. |
| Data-only helper | Stops, exit 3, zero runs, exact `--with support/data.ts` and `--source support/data.ts` reruns. Control exits 1, `not red`. |
| Package `#api` and tsconfig `~/api` aliases from the third review | Each stops, exit 3, zero runs, unresolved specifier and importer named, both exact reruns. Each `--with` control exits 1, `not red`. |
| Commented-out import from the third review | Does not establish an importer. Data stops, exit 3, zero runs, both exact reruns. Control exits 1, `not red`. |
| Real `src/main.ts` imports the changed source | Exit 0, `proven`, no flag. |
| Only the named test imports the source | Exit 3; `--source src/value.ts` proves, exit 0. |
| Same path under `--with` and `--source` | Exit 2, conflict named. |

Focused tests also retain transitive added-helper stops and copies, second-call store reuse, unused-path warnings, absent-source refusal, pytest/conftest classification, rerun text/quoting and JSON fields. The literal cases from the prior third review are closed.

The earlier B2 legacy-evidence and N1 sender code did not change. Their focused tests pass: legacy hook assertions refresh and remain exit 3; legacy body assertions and deliberate body errors refresh once and then reuse; the older-field socket refuses the new fields and accepts the stripped retry. No new key format or schema change was introduced.

An independent call combined `--with support/rows.ts --red-error 'wait sentinel'` for `alpha` and `beta`, each with its own coded `E_WAIT` error. Both projects read labelled `proven` with their own text. First call: four file/project side runs. Second call: zero runs, each project's own stored evidence. JSON retains the side `with` paths and `redErrors`. Under an environment condition both projects remain `not comparable`, exit 3; conditioned results are not stored and the shared result count stays **8 before and 8 after**.

## Inputs for the next repair

Keep "stop when unsure" and the fixed alias/comment cases. An unexamined package, lost parser record or unsupported load syntax must not certify an importer as non-test code. Give the source of import evidence a completeness contract and preserve uncertainty through the classifier. Fix the two proven CLI paths above, include the Python alias as a core contract case, and preserve all earlier controls. The previous B2 and N1 need no further repair on this evidence.
