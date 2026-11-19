# Wave 14 review: changed imports and red evidence

FAIL 823e5d34a44802f003c6fd41b1512d27acf7914a

Two proven blockers: an ordinary helper name bypasses the changed-import stop, and a legacy stored hook assertion bypasses the new hook exclusion. One proven, nonblocking compatibility defect: the previous daemon refuses the new error fields. No product code changed.

Scope: `cand/0.1.567`, `85bf5476313842ebcaffdd3bceb6c2710541e86b..823e5d34a44802f003c6fd41b1512d27acf7914a`, rows 023-21 and 023-22. The last commit contains the version and rebuilt bundles. Inputs: D5, its amendments for #247 and #244, `status.md`, both wave briefs, both worker notes, and the wave 8 and 9 reviews. Earlier reviews supply the honesty and project-evidence bar; this is a new-wave review.

## Verification

Commands ran at the candidate SHA. The tree was clean at entry and after removing the probes. Probe runs added only temporary review harnesses; candidate sources and existing tests stayed unchanged. Under the review skill's clean-tree rule, the checks taken while those harnesses existed are supplemental evidence, not a clean-tree gate result.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `823e5d34a44802f003c6fd41b1512d27acf7914a`, as requested. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3758 files in 1260ms. No fixes applied.` Clean candidate. |
| `timeout 600 pnpm run typecheck` | Exit 0. Clean candidate. |
| `timeout 600 pnpm run check:private` | Exit 0: `3646 added lines in 71 files ... ok`. The local private denylist was empty, so that rule was skipped. Clean candidate after probe removal. |
| Focused Vitest command below | Exit 0: **12 files, 134 tests passed**, 62.11 s. Includes key-format and runner boundaries. |
| `timeout 600 pnpm exec vitest run test/code/gate/keep-daemon-wire.test.ts test/code/gate/keep-daemon.test.ts test/cli/proof-conditions.test.ts --maxWorkers=2` | Exit 0: **3 files, 27 tests passed**, 35.02 s. |
| `timeout 600 pnpm exec vitest run test/cli/wave14-review-probe.test.ts --maxWorkers=1` | Temporary observation harness: **11 tests passed**, 56.45 s. Observations below use real Git fixtures, the source proof CLI child and Vitest 5.0.3. |
| Combined-flags harness | First run: 3 passed, 1 harness expectation failed. Corrected run: 3 passed, 1 harness expectation failed. Final targeted global-setup control: 1 passed, 3 skipped. Details below distinguish the mistaken expectations from product defects. |
| `timeout 600 pnpm exec tsx /tmp/wave14-compat.mts` | Exit 0. Current parser accepts the request. Previous parser refuses each new field; the current writer reports that refusal over a real Unix socket. |
| Session-pinned `squeal checks` | Default tests check; 1,998 files listed at entry. Squeal does not cover typecheck or build. |
| Session-pinned `squeal status --wait 60000 src/core/proof/imports.ts src/core/proof/verdict.ts src/runners/vitest/results.ts src/runners/node-test/run/errors.ts src/runners/pytest/run/report.ts src/core/daemon/keep-protocol.ts src/cli/proof.ts` | Exit 3 after 60.7 s. Selected 898 files: 245 current passes, 620 pending, 33 unknown. Revision 6 listing was pending. Whole worktree: known failures 0; 725 files not current. **No affected-check pass claimed.** A later message said the one file selected by removal of the probes had run without a new failure; it did not settle all 898 files. |
| Exact-candidate CI | [CI 44494714644](https://github.com/hearsay-tools/squeal/actions/runs/44494714644) still in progress when checked. [Private material 44494714617](https://github.com/hearsay-tools/squeal/actions/runs/44494714617) passed. Full-suite result remains unverified. |

The focused command was:

```sh
timeout 600 pnpm exec vitest run \
  test/cli/proof-args.test.ts test/cli/proof-with.test.ts \
  test/cli/proof-evidence.test.ts test/cli/proof-report.test.ts \
  test/cli/proof.test.ts test/proof/imports.test.ts \
  test/proof/red-evidence.test.ts test/proof/verdict.test.ts \
  test/runners/red-evidence-records.test.ts \
  test/runners/pytest/run/report.test.ts test/keys/key-format.test.ts \
  test/runners/boundaries.test.ts test/daemon/keep-protocol.test.ts \
  --maxWorkers=2
```

The last path does not exist; Vitest ignored that filter and selected the 12 existing files. The separate keep-daemon commands above cover the actual protocol boundary. No install, build, version raise or full suite ran. All reviewer-started jobs exited. Probe fixtures checked that their temporary checkouts and extra Git worktrees were removed. The temporary harnesses and socket were removed before this file was committed.

## B1. Proven blocker: a helper with an ordinary name can still give a false `proven`

Location: `src/core/proof/imports.ts:43`, `src/core/proof/imports.ts:55`; caller `prove` in `src/cli/proof.ts`.

Contract: amended D5.2 says an unchanged named test with changed imported helpers stops with exit 3 and an exact `--with` rerun. `tasks/wave-14.md` says to list changed imports outside the project's source roots and to "never guess silently". The implementation instead treats every unrecognized name as source. The worker notes disclose this choice, but no amendment approves that narrower rule.

Reproduction, in a repository with source under `src/`, test include `test/*.test.ts`, and coverage enabled (`squeal.config.json` is `{}`):

1. At base A, commit these files:

   ```ts
   // src/value.ts
   export const value = 1;
   // test/a.test.ts
   import { runRows } from "../support/rows";
   runRows();
   // support/rows.ts
   import { it, expect } from "vitest";
   import { value } from "../src/value";
   export function runRows() {
     it("row", () => expect(value).toBe(3));
   }
   ```

2. At HEAD, change `value` to 2 and the helper's assertion to `expect(value).toBeGreaterThanOrEqual(1)`. Leave `test/a.test.ts` unchanged. The HEAD test now passes on both source versions.
3. Run `squeal proof test/a.test.ts --base A --json`.
4. Control: run the same command with `--with support/rows.ts`.

Observed without `--with`: **exit 0, `proven`, two runs**. Red contains the old helper's `expected 1 to be 3`; green passes with the new helper. JSON has no helper candidate, no stop and no `withRerun`; it lists `support/rows.ts` as a source change. Red and green are stored at their actual run keys. The problem is the proof's test-version claim, not incorrect bytes at those keys.

Observed control: **exit 1, `not red`**. Copying HEAD's helper makes red pass, as expected. The first command certified a proof that the intended HEAD test cannot supply. A source-change note cannot make that `proven` honest. A name such as `support/rows.ts` is valid in any project; `*.testkit.*` cannot be a universal helper contract.

One-worker fix: replace the name-only eligibility decision with a conservative, explicit rule for changed imports of unchanged tests. Preserve source-at-base behavior, but require a real source-boundary contract or refuse ambiguous imports and name their exact `--with` rerun. Do not merely extend the suffix list. Cover ordinary helper names outside `src/`, transitive and newly added helpers, the false-proof/control pair above, and normal unchanged source tests.

## B2. Proven blocker: legacy hook assertions become eligible red evidence

Location: `src/core/proof/verdict.ts:107`, especially assertion acceptance at line 108; reuse at `src/cli/proof-side.ts:143`. The changed producer is `src/runners/vitest/results.ts:108`.

Contract: amended D5.5 and `tasks/wave-14b.md` require hook failures to stay `red for another reason` unless explicitly accepted. This review also requires reading records stored before this row correctly. Optional new fields do not supply facts that an old record lacks.

Reproduction:

1. Base A exports `value = 1`; HEAD exports `value = 2` and adds this test:

   ```ts
   import { beforeEach, expect, it } from "vitest";
   import { value } from "../src/value";
   beforeEach(() => expect(value).toBe(2));
   it("body", () => {});
   ```

2. Run `squeal proof test/a.test.ts --base A --json`. Fresh records correctly give **exit 3**, `red for another reason`, failure kind `hook`, text `expected 1 to be 2`.
3. In the fixture's `failure_texts.errors` JSON, remove only `stage` and `assertionEvidence` from each error. Leave commits, keys, outcomes and other error fields unchanged. This reproduces the previous record shape: the old Vitest producer records the assertion's name and diff, but no hook stage.
4. Repeat the identical proof without `--red-error`.

Observed: **exit 0, `proven`, evidence `assertion`**. Red comes **from the store**; green passes. The failure still occurred before the test body started. `recordedKind` cannot see `stage: hook`, then accepts `AssertionError` or its diff. `withSide` sees a usable stored failure and does not refresh it. Store schema, key format and adapter versions are unchanged in this range, so these old records remain reachable.

This is the compatibility gap in the new evidence rule, not a request to repair unrelated old proof behavior. A newly recorded hook is rejected while the same old hook is certified by this candidate.

One-worker fix: before a stored failure can prove a side, establish the phase facts the new rule needs. Refresh the selected legacy failure when that evidence is missing, or refuse it with an actionable explanation. Do not infer body execution from the assertion name, diff or stack text. Preserve ordinary stored passes and safe reuse; keep the key format unchanged. Add the fresh-versus-legacy hook fixture above, plus an old plain `Error` and an old body assertion control.

## N1. Proven should-fix: the previous daemon refuses new failure records

Location: new fields allowed at `src/core/daemon/keep-protocol.ts:207`; sent unchanged by `src/core/code/gate/keep-sent.ts:111`. Runner producers now attach them to failing tests.

Protocol reproduction:

1. Extract `src/core/daemon/keep-protocol.ts` at `85bf54763` into a temporary module. Its runtime imports are all type-only; no old bundle build is needed.
2. Make an otherwise valid `keep` results request with one failing test, a matching 64-character key, matching worktree id and valid gate provenance. Its error is `{ name: "Error", message: "wait failed", stack: null, location: null, diff: null, stage: "body" }`.
3. Send it through the current `writeThroughDaemon` to a Unix socket that uses that exact previous parser. Also call both parsers directly. Repeat with `assertionEvidence: true` instead of `stage`.

Observed:

```text
current parser: accepted
previous parser: "write.records[0]" "errors[0]" has the unknown field "stage"
previous parser, both new fields absent: accepted
previous parser, assertionEvidence only:
  "write.records[0]" "errors[0]" has the unknown field "assertionEvidence"
current writer:
  the daemon refused the write: "write.records[0]" "errors[0]" has the unknown field "stage"
```

This is a real writer/socket test with the old parser, not a full previous daemon lifecycle test. It proves the incompatible request and refused results write. It does not prove a crash or false storage claim. `KeepRefused` reaches the keeper's existing not-kept handling, so the narrow observed defect is loss of failure-result storage while an older daemon serves the worktree. That makes this a nonblocking compatibility finding, not a third false-proof blocker.

One-worker fix: add a safe cross-version path before sending these fields, or arrange a supported daemon handover before the write. Test current and previous receivers. Do not silently discard evidence and then certify the degraded record; B2 shows why that is unsafe.

## What fits

- Fresh real Vitest failures from a `TypeError`, `ReferenceError`, missing dynamic import, `ENOENT`, and a 40 ms runner timeout all returned **exit 3**, `red for another reason`. Plain errors in `beforeAll`, `beforeEach` and `afterAll` also returned 3. Explicit matching `--red-error` accepted those hooks and labelled the evidence `thrown`.
- A top-level throw stayed kind `import` despite a matching `--red-error`. A real `setupFiles` throw also stayed kind `import`, exit 3, with the correct error text. Explicit acceptance did not turn either into red evidence. Global setup failed before useful side evidence was available and returned `not comparable (budget)`, exit 3; its precise failure attribution remains unverified.
- Existing focused tests cover the deliberate wait error, matcher evidence, named engine errors, Node system codes, pytest phase records and node:test failure types. A no-stage plain `Error` stays ineligible. The legacy assertion case is B2. This review did not run a real node:test or pytest end-to-end proof.
- Combined `--with support/rows.ts --red-error 'wait sentinel'`: two projects (`alpha`, `beta`) each failed red on its own coded `ECONNREFUSED` error. Explicit acceptance gave two labelled `proven` verdicts. Each JSON record and reason kept its own `wait sentinel alpha` or `wait sentinel beta` text. Both sides reported `with`; top-level `redErrors` was retained. The second call ran zero tests and reused each project's own stored evidence.
- The same combined call under an environment condition refused to attribute different unstored project failures: both files read `not comparable`, exit 3. Result-row count stayed **8 before and 8 after**. The first harness incorrectly expected two proven verdicts here; the existing conservative refusal is correct. The corrected condition test passed.
- Both rerun builders retained `--with`, `--red-error`, `--repeat` and shell quoting for paths with spaces and an error text containing quotes and `$`. The budget rerun raised the timeout; the helper rerun added the new helper. The existing rerun builders omit `--json`; that behavior predates this range and is not a new finding.
- The initial setup probes let the automatic case select `test`, so an added test was correctly absent at base. Correcting them to `--case source` exercised setup-file rejection. The later global-setup harness incorrectly demanded `red for another reason` from a side with no usable evidence; its targeted corrected control passed. Neither harness mistake is a finding against the wave.
- The source-key, store-schema and adapter-version files have no changes in this range. `KEY_FORMAT_VERSION` remains 21; the focused key-format test passed. New stored fields are JSON additions, not a schema migration. This does not establish semantic compatibility for B2 or wire compatibility for N1.
- Known helper names stop with an exact rerun; named `--with` files get no verdict of their own; reuse and the absent-source refusal pass the existing integration tests. Expected-tree and condition storage checks remain in place. No false per-project evidence was found in the new combined path.

## Inputs for the next wave

Dispatch B1 to the changed-import rule owner and B2 to the proof reuse/evidence owner. Resolve N1 at the keep sender/receiver boundary. Keep one owner for each rule. Preserve `TestFileRef` identity throughout imports, outcomes and failure evidence, and preserve actual run keys after overlays. A stopped or ambiguous file must not be certified from a different test version. A legacy error must not gain an execution stage by inference.

Keep the one proof deadline across checkouts, installs, runs and repeats. Keep source absent at base as `not comparable`. Conditions and repeated runs must continue to bypass storage. Retest the two false-proof reproductions, their controls, combined flags, per-project reuse and the previous receiver. Exact-candidate full-suite CI and the broad affected-check selection remain verification limits, not blockers.
