# Wave 14, fifth review: FAIL

Candidate: `cand/0.1.568`, `1a182fc22597582521ed1db4b7ae5e6ec8ee0ab2`.
Delta reviewed: `e4e141014..1a182fc22`, including `30bbd894e` and rebuilt bundles.
Contract: D5.2 as amended on main at `faba5a1ab` (the human, “A: stop guessing”), plus D5.5 and the prior four reviews. **Two proven blockers**, both remaining forms of the original B1. Earlier B2 and N1 remain closed on these checks.

## Verification

The candidate SHA matched exactly and the tree was clean during checks. Commands and results:

```sh
pnpm run lint
pnpm run typecheck
timeout 600 pnpm exec vitest run \
  test/cli/proof-with.test.ts test/cli/proof-with-node-test.test.ts \
  test/cli/proof-legacy.test.ts test/code/gate/keep-older-fields.test.ts \
  test/cli/proof-evidence.test.ts test/cli/proof-conditions.test.ts \
  test/cli/proof-report.test.ts test/cli/proof-args.test.ts \
  test/proof/imports.test.ts test/proof/red-evidence.test.ts \
  test/proof/verdict.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts --maxWorkers=2
```

Lint: 3,763 files checked, exit 0. Typecheck: exit 0. Focused tests: **13 files, 125 tests passed**, exit 0, 130.99 s.

The installed Squeal status command returned exit 3: daemon stopped, revision 8, 488 of 1,998 files not current (474 queued, 14 unknown). It gave no validated verdict for the changed proof paths. Direct tests were required by the brief and this missing daemon evidence.

Exact-candidate [CI run 44524711549](https://github.com/hearsay-tools/squeal/actions/runs/44524711549) was still in progress at the last observation. [Private-material run 44524711533](https://github.com/hearsay-tools/squeal/actions/runs/44524711533) passed on the exact candidate. No full suite, build, dependency install in the repository, or version change was run for this review.

Independent experiments used temporary Git fixtures and the real proof command, child CLI, Vitest and node:test adapters. Their external harness ran with `timeout 600 pnpm exec vitest run`, explicit test paths and one worker. Checkout installation linked the existing Vitest; the declared local-package case also linked its package. These checks exercise the proof and runners, not a frozen package-manager install. Fixture checks confirmed checkout removal. No probe files are part of this commit.

## 1. Proven blocker: test-side name inference still bypasses the required decision

Locations: `src/core/proof/imports.ts:82`, `src/core/proof/sides.ts:77`, `src/core/proof/sides.ts:116`, and `src/cli/proof.ts:190`.

Amended D5.2 says: “When no named test file changed between the sides, every changed file the test imports (directly or through other files) stops the proof unless the call names it” with one of the two flags. It expressly withdraws inference from names. The new filter still calls `isTestSide`, which accepts folder and filename patterns without either flag. Default-case selection and copying also retain that inference.

Reproduction: create a Git fixture with `squeal.config.json` containing `{}`, package type `module`, and Vitest including `test/*.test.ts`. Commit A contains:

```ts
// test/a.test.ts — unchanged in HEAD
import { runRows } from "./rows";
runRows();

// test/rows.ts
import { it, expect } from "vitest";
export const runRows = () => it("row", () => expect(1).toBe(3));
```

At HEAD change only the helper's expected value from `3` to `1`. Run:

```sh
squeal proof test/a.test.ts --base A --json
```

Actual: **exit 0, `proven`, two runs**, red and green stored. Case is `test`; `changedImports`, `withRerun` and `sourceRerun` are null. No named test changed and the call never settled `test/rows.ts`. Required: exit 3, zero runs, list that helper and both exact reruns. This is a proven stop-contract violation; it does not rely on deciding whether this particular helper edit is useful test work.

With `--case source`, the same fixture returns `not red`, exit 1: the HEAD helper is copied over the old code automatically. An explicit `--with test/rows.ts` gives the same reading. The name has already made the decision that the amended contract reserves for the caller.

A product-code control shows that `--source` cannot correct the automatic copy either. In a second fixture use this unchanged test:

```ts
import { it, expect } from "vitest";
import { value } from "./value";
it("value", () => expect(value).toBe(2));
```

Change `test/value.ts` from `export const value = 1` at A to `export const value = 2` at HEAD. The no-flag call again exits 0, case `test`, `proven`. The explicit call:

```sh
squeal proof test/a.test.ts --base A --case source --source test/value.ts --json
```

returns **exit 1, `not red`**, and `sourceUnused: ["test/value.ts"]`. The HEAD source is still copied into red because its folder looks like test code. The requested source comparison should retain A's value on red and prove the fix.

Repair: for an unchanged named test, require an explicit decision for every changed imported path, including paths under test/fixture folders and test-like names. Carry `--source` through case selection and side construction so it cannot be overridden by automatic test-side copies. Preserve the established copy behavior where the named test itself changed, subject to the amended contract. Add both CLI reproductions, including the source override.

## 2. Proven blocker: the pre-run import list omits inputs that can supply the red failure

Locations: `src/cli/proof.ts:169` through the call to `importsOf`, `src/core/proof/imports.ts:81`, and `src/cli/proof.ts:199`. The stop consults only the green checkout's initial `at.loads`. A computed import, a read file and runner configuration can affect both executions without appearing in that list. The proof does not stop or reconsider the decision after those inputs are used. These are false proofs of the same shape as the original data-only B1.

Use the same Vitest fixture setup. Commit A contains:

```ts
// src/value.ts
export const value = 1;

// support/data.ts
export const min = 3;

// test/a.test.ts — unchanged in HEAD
import { it, expect } from "vitest";
import { value } from "../src/value";
it("row", async () => {
  const name = "data";
  const { min } = await import("../support/" + name + ".ts");
  expect(value).toBeGreaterThanOrEqual(min);
});
```

At HEAD change `value` to `2` and `min` to `1`. The HEAD test passes even over A's source when HEAD's test data is used. Results:

| Call | Actual result |
| --- | --- |
| `squeal proof test/a.test.ts --base A --json` | Exit 3, zero runs, but only `src/value.ts` is unsettled; data is absent from both reruns. |
| Add only `--source src/value.ts` | **Exit 0, `proven`, two runs**, both results stored. JSON lists only `src/value.ts` as settled; data never needed a decision. |
| Add `--with support/data.ts` as well | **Exit 1, `not red`**; HEAD's threshold passes over A's source. |

The only change between the latter two calls is the explicit test-side data copy. The first “proof” gets red from A's old threshold rather than showing that the HEAD test catches A's source bug. This is a real computed import of a changed project file, directly within amended D5.2.

Two additional experiments give the same result and control:

- **File read:** replace the dynamic import with `Number(readFileSync("support/min.txt", "utf8"))`, import `readFileSync` from `node:fs`, and change the tracked text file from `3` to `1`. With only `--source src/value.ts`: exit 0, `proven`, two stored runs. Add `--with support/min.txt`: exit 1, `not red`.
- **Runner configuration:** let the unchanged test compare `value` with `Number(process.env.MIN)`. Set `test.env.MIN` in tracked `vitest.config.mjs` to `"3"` at A and `"1"` at HEAD; also change source from 1 to 2. With only `--source src/value.ts`: exit 0, `proven`, two stored runs. Add `--with vitest.config.mjs`: exit 1, `not red`. The runner config that changes test meaning is never in the stop list.

A content key can correctly distinguish the two executions and still not show that their test inputs match the chosen sides. Key validity alone does not settle these files. Repair the proof's input-completeness boundary: include relevant runner/config inputs and known runtime loads/reads, and refuse a comparison whose changed inputs cannot be accounted for. A computed load must preserve uncertainty rather than certify that an incomplete static list is complete. Do not merely add another classification rule. Add the three command/control pairs and check that their stopped reports contain the omitted path or explain the unresolved input, with no `proven` and no unrequested execution.

## What fits, and remaining limits

The earlier static reproductions are closed on this candidate. The seven real-Vitest cases in `proof-with.test.ts` cover the direct helper, local API barrel, data-only input, commented importer, package `#api`, tsconfig alias and declared local test-API package. Each now stops with exit 3 and zero runs; each correctly settled mixed `--with`/`--source` control reads `not red`, exit 1. The former importer classifier is gone, so a comment or opaque API package no longer certifies product code.

The commented node:test `require` case passes the real-adapter focused test. An independent `process.getBuiltinModule("node:test")` fixture also stops on both changed inputs, zero runs, and reads `not red` when data is `--with` and source is `--source`. Exact text/JSON reruns, source-only product proof, mixed flags, transitive added helpers, store reuse, unused-path warnings, absent-source refusal and same-path conflict exit 2 pass their focused checks.

**Python limit, unverified beyond refusal:** a real fixture using an aliased `import_module("pytest")`, changed data and changed source returned exit 3, zero runs, “no runner lists it” on both default and explicit-control calls. The configured Python 3.13 environment had pytest installed, but this proof's `daemonAdapters` creates Vitest and node:test adapters only. The old Python classifier was removed, but this does not establish a working pytest proof or its `not red` control. This pre-existing runner limit is not another blocker against this delta.

The prior parser-boundary change is also removed: proof no longer imports the runner parsers or maintains an importer-classification graph. The runner-boundary and key-format checks pass. No new schema or key-format change is present.

B2/N1 spot checks pass. Legacy errors without stage refresh before they can count as red; legacy hook assertions remain exit 3. Fresh body assertions and deliberate body errors retain their evidence and reuse. TypeError, ReferenceError, coded system errors, import/setup errors and timeout/hook failures remain excluded by default; `--red-error` does not accept import/setup failures. The older-field daemon socket test refuses the new fields and accepts the stripped retry.

An independent two-project fixture combines `--with support/rows.ts --source src/value.ts --red-error 'wait sentinel'`. Both `alpha` and `beta` prove with their own coded `E_WAIT` body error text and the thrown label. First call: four side runs. Second call: zero runs, project-specific stored evidence. Under an environment condition the call remains exit 3, not comparable; conditioned results are not stored, and shared result rows stay **8 before and 8 after**. JSON retains all three flags.

## Inputs for the next repair

Keep the explicit-file rule and the now-closed earlier cases. Fix the two boundaries above: a name must not settle a changed import, and an incomplete import list must not settle the whole comparison. Honor `--source` during copying. Preserve B2/N1, per-project evidence and conditioned-store behavior. No further change to the removed importer classifier is needed.
