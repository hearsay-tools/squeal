# Review of 007-40 and 007-44, wave 5.5

## Verdict

**FAIL fa444c86a05504c1eceecc60c62ab5bc278403d4** (`cand/0.1.195`). One proven blocker, medium severity. No other should-fix items or nits.

Scope: `0d2fa0c6` (delivery attribution), `bf27a21d` (no-environment note), their callers and tests, and the integrated candidate's verification. The rest of spec 007 is outside this review.

## Verification

The tree was clean and `git rev-parse HEAD` was `fa444c86a05504c1eceecc60c62ab5bc278403d4` for these checks. Node v24.21.0. The standalone probes lived outside the worktree and changed no candidate files.

```text
$ npm ci
added 196 packages, and audited 197 packages in 9s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1285 files in 607ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
exit 0
```

`npm ci` also printed the `node-domexception` deprecation and the six-package install-script advisory. It completed successfully. Build and build-drift verification were deliberately omitted under the review brief's explicit instruction, so they are unverified, not findings.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  625 passed | 1 skipped (626)
      Tests  5173 passed | 10 skipped (5183)
   Start at  12:31:34
   Duration  879.97s (tests 98%, import 2%)
exit 0
```

No tests failed in the independent full run. Sampled one-minute host load during it was about 16 to 45. Its fixture diagnostics included the experimental-typecheck warning, two worktree repair messages, and a stale-process cleanup message; no error remained in the final verdict.

Squeal's separate baseline reported one failure before that verdict: `test/integration/pi-events.test.ts:157`, **the Pi events with real Pi > print: an edit over an undelivered regression is blocked once and can be re-issued**. It expected a `write` tool result's `isError` to be `true` but received `false`. Squeal then reported its recovery as `Flaky: FAIL -> PASS under the same inputs`. The independent full run passed it, and it **also passed alone**:

```text
$ npx vitest run test/integration/pi-events.test.ts --maxWorkers=4 -t 'print: an edit over an undelivered regression is blocked once and can be re-issued'
 Test Files  1 passed (1)
      Tests  1 passed | 7 skipped (8)
   Start at  12:47:33
   Duration  4.46s (tests 70%, transform 25%, import 5%)
exit 0
```

This is a recorded transient observation, not a finding against the scoped changes.

## Blockers

### B1. Unknown runner identity is treated as a Node failure

**Proven. Severity: medium.** `src/core/delivery/attribution.ts:249-251`, especially the complement test at line 251. Contract: 007-40 says the sentence appears only beside a Node runner's failure and never beside a pytest failure.

A pytest worktree has an admitted environment and a stored failure. Its `squeal.config.json` is then malformed, temporarily absent during replacement, unreadable, or no longer declares that project. A new session can register against the stored state even with the daemon stopped. `readPolicy` defaults the missing/invalid policy's `pytest` list to `[]`; the complement test declares the pytest check to be Node. With hashed files and no installed Node lockfile, `dependenciesInstalled` returns `false`, and registration prints:

> No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.

The same happens to a pytest transition delivered while the policy is unavailable. The environment that produced the failure has not lost its Python dependencies. This recreates defect 6 in the fallback cases explicitly named by the review brief. No exception protects the delivery: policy loading deliberately does not throw.

A standalone Node/tsx probe against the candidate's real store and public `createDelivery`, `formatDelta` and `formatRegistration` interfaces seeded a current own pytest result and a hashed Python test file, with no installed Node lockfile. It changed only the fixture's policy between runs:

```text
policy                       pytest delta warning  pytest registration warning
valid                        false                 false
malformed JSON ("{")         true                  true
missing                      true                  true
unreadable (EISDIR)           true                  true
```

The malformed case reported a policy parse problem; missing and EISDIR fell back without a problem. The existing loader's problem reporting is outside this change. The finding is the new classifier's assertion that failure to identify pytest proves Node ownership.

To turn the delta probe into a regression, use the existing setup in `test/delivery/dependencies-runner.test.ts:89`, register on `result(py, "pass")`, write `"{"` to its root's `squeal.config.json`, then apply `result(py, "fail")`. Its existing assertions that the dependency flag is absent and the rendered sentence is absent now fail. For registration, store the failure first, corrupt the policy, then register a fresh session. Add the missing/unreadable variants, with a Node control.

**One-worker repair:** determine runner ownership from evidence that survives a failed policy read, or leave it unknown and suppress this assertion when ownership cannot be established. Checking `loadPolicy(...).problems` alone is insufficient because a missing file has no problems. Cover both callers and preserve the Node-only, mixed, installed and not-yet-hashed controls. Do not guess runner ownership solely from a filename extension.

## Should-fix and nits

None beyond B1's required regression coverage.

## What fits

- With a readable, valid policy, pytest-only failures carry no dependency flag in delivery or registration. A Node failure without an installed lockfile still carries the warning, including in a mixed Node/pytest delivery. A mixed worktree whose only delivered failure is pytest suppresses it. The standalone probe exercised all three combinations through both public delivery paths; the candidate's new tests exercise the normal cases too.
- `annotate` passes the failing entries' check IDs, and registration passes the known failures' check IDs. No argument-order or transaction mismatch was found. Existing tests retain the installed-lockfile and empty-hash cases. Only failures trigger the new policy read; quiet delivery polling and recovery-only entries do not trigger it.
- `HarnessDelivery.status` still delegates to its status builder. `snapshot.ts` and `format-status.ts` did not emit this warning before this candidate and do not emit it now. This is unchanged, not a newly lost Node warning path.
- When the worktree row is absent, the classifier likewise has an empty pytest set. With no hashes, the flag stays absent. An injected missing-row case with retained hashes returned `false` for a pytest check; that is the same unknown-identity fallback as B1, not a second blocker. The ordinary fresh-registration case has no hashes and asserts nothing.
- Local warm measurements of 1,000 calls with one pytest policy entry and one hashed file gave `withDependencies` p95 0.086 ms for pytest and 0.113 ms for Node, versus 0.018 ms for the old dependency-hash read alone. This provides no evidence of meaningful delivery overhead on this fixture; it is not a scale guarantee. The read is once per failing annotation/registration, not per check.
- 007-44's four exact-text cases cover `uv.lock`, `poetry.lock`, requirements files and no install description. The selected install command and location still come from the same discovery result. The note explicitly says no tests run and no results are inherited without an environment, then explains matching-code/environment reuse after installation. It uses the agreed wording "the results other worktrees recorded", with no promise that every inherited failure immediately stands; 001 D6's confirmation rule remains unchanged. Editable-outside and sync-note text are unchanged.

## Inputs for the repair and next review

Repair B1 in the existing attribution boundary and its regression tests; preserve the public payload type and the two callers' `readonly CheckId[]` contract. Test failure delivery and registration after policy loss, without requiring a daemon to reread the file first. The no-environment note needs no further change. Re-review the repair and rerun the candidate gate; this candidate's verdict remains FAIL regardless of an otherwise green suite.
