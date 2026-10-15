# Narrow re-review of 007-40 B1, wave 5.75

## Verdict

**FAIL adc26b1d1bdceeffa24b1eb1a21eed47c18d0d46** (`cand/0.1.195`). One proven blocker, medium severity: wave-5.5 B1 remains open for pytest checks in non-`.py` files. No additional should-fix items or nits.

Scope: `fa444c86..adc26b1d`, specifically repair `998f0dfc`, its regression tests, the matching bundle changes, and both dependency-warning callers. The re-pin has no net change from the earlier candidate. 007-44 and the rest of 007-40 retain the prior review's conclusions.

## Verification

The worktree was clean and `git rev-parse HEAD` was `adc26b1d1bdceeffa24b1eb1a21eed47c18d0d46` during verification and the probes. Node v24.21.0. Probe scripts and fixtures were outside the worktree and removed before committing this review.

```text
$ npm ci
added 196 packages, and audited 197 packages in 16s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1287 files in 1013ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
exit 0
```

`npm ci` also printed the `node-domexception` deprecation and the six-package install-script advisory. Build and build-drift verification were deliberately omitted under the brief's explicit instruction. They are unverified, not findings.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  625 passed | 1 skipped (626)
      Tests  5178 passed | 10 skipped (5188)
   Start at  12:52:29
   Duration  897.53s (tests 98%, import 2%, transform 1%)
exit 0
```

No test failed in the independent full run. Sampled one-minute host load during it was about 10 to 84. Fixture diagnostics included two worktree repair messages, an earlier-run process cleanup and the experimental-typecheck warning; no error remained in the verdict.

Squeal's separate baseline reported two failures in `test/e2e/pi.test.ts`, under **the shipped Pi package, installed with pi install**:

| Test | Baseline failure | Fails alone? |
| --- | --- | --- |
| `print: starts the copy's daemon, which passes a baseline, and a PASS -> FAIL reaches the next request` (`:74`) | `Pi did not finish in 30000ms`, at `test/helpers/pi.ts:224:13` | **No**, 1 passed, exit 0, 4.70 s |
| `rpc: the agent's own edit failing after its run settled wakes it with the PASS -> FAIL, once` (`:183`) | `timed out after 20000 ms waiting for the slow re-run to start`, at `test/e2e/support.ts:43:13` | **No**, 1 passed, exit 0, 19.15 s |

Both passed in the independent full run above. Squeal also reported both recoveries as `Flaky: FAIL -> PASS under the same inputs`; its RPC recovery was inherited from the parent's worktree at this same candidate SHA. Each isolated check below selected one test and skipped the other four, with the host lock and sampled load about 10 to 12:

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/e2e/pi.test.ts --maxWorkers=4 -t 'print: starts the copy.s daemon, which passes a baseline'
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
   Start at  13:07:45
   Duration  4.70s (tests 87%, transform 10%, import 2%)
exit 0

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run test/e2e/pi.test.ts --maxWorkers=4 -t 'rpc: the agent.s own edit failing after its run settled'
 Test Files  1 passed (1)
      Tests  1 passed | 4 skipped (5)
   Start at  13:07:50
   Duration  19.15s (tests 97%, transform 2%, import 1%)
exit 0
```

These are recorded timeout observations, not additional findings against this repair. Passing alone does not prove the cause of either timeout.

## Blockers

### B1. A stored pytest doctest still becomes a Node failure after policy loss

**Proven. Severity: medium.** `src/core/delivery/attribution.ts:258-261`. This is the residual of wave-5.5 B1, not a new finding. 007-40's contract is: the sentence appears only beside a failure of a Node runner and **never beside a pytest failure**.

The repair checks `loadPolicy(...).problems` and then counts every failure outside the current pytest project names whose file does not end in `.py`. Deleting the policy or removing its pytest project loses the runner identity of stored results. A text doctest is a supported, reachable pytest result and passes that filename filter. With hashed files and no installed Node lockfile, both the next delta and a fresh registration then say:

> No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.

This warning is false for the admitted Python environment that produced the failure. A file used only to suppress an assertion is conservative for `.py` checks, but the positive assertion for all remaining files still comes from a complement and an extension. A clean policy names today's projects; it does not prove who ran an older result. A missing policy file cannot establish that history. Thus the instruction not to guess runner ownership solely from an extension is not fully satisfied.

**Discriminating probe.** A standalone Node/tsx probe used the candidate's real store, `createStateSink`, `createDelivery`, `formatDelta`, and `formatRegistration`. Each fixture had hashed files, no installed Node lockfile, and a policy naming `py`. It registered on a pass, stored the failure while the policy was valid, then changed only the policy before pulling a delta and registering a new session. It asserted that both outputs actually contained the failing check. The Node control was `src/a.test.ts`; the Python control was `tests/test_a.py`.

For reachability, an isolated uv-synced fixture admitted Python 3.13 with pytest 9.1.1. The project used `include: ["docs/*.txt"]` and `args: ["--doctest-glob=*.txt"]`; `docs/example.txt` contained:

```text
>>> 1 + 1
3
```

The candidate's `listTestFiles` returned `["docs/example.txt"]`. Its real `runPytest` returned:

```text
end: completed
failure: null
completedFiles: [{ project: "py", path: "docs/example.txt" }]
check: { kind: "test", project: "py", testPath: "docs/example.txt", fullName: "example.txt" }
outcome: fail
error: DocTestFailure, Expected: 3, Got: 2
```

That actual check and failure were replayed through the store and both public delivery callers. Results below are `delta warning / registration warning`:

| Policy at delivery | Load problems | pytest `.py` | pytest `.txt` doctest | Node `.ts` control |
| --- | ---: | --- | --- | --- |
| Valid, still declares `py` | 0 | false / false | false / false | true / true |
| Malformed JSON (`{`) | 1 | false / false | false / false | false / false |
| Missing | 0 | false / false | **true / true** | true / true |
| Unreadable as a file (`EISDIR`) | 0 | false / false | **true / true** | true / true |
| Permission denied (`EACCES`, mode `000`) | 1 | false / false | false / false | false / false |
| Valid `{}`, project removed | 0 | false / false | **true / true** | true / true |
| No worktree row exposed, hashes retained | n/a | false / false | false / false | false / false |

The missing-row control hid only `worktrees.get` through a store view, keeping the state and hashes intact; it exercised both callers without relying on pruning to erase the result. EACCES was tested as the ordinary `agent` user. `EISDIR` remains a problem-free fallback because the existing `isMissing` helper includes it. Changing that loader is outside scope; the repair cannot treat the absence of problems as proof that ownership was read.

**Residual decision: unacceptable under the current contract.** The doctest result is not hypothetical or an unsupported file type. Its environment was admitted, and the false sentence is the same defect B1 required the repair to suppress. No approved amendment permits this exception. Green `.py` regression tests do not close it.

**One-worker repair:** establish ownership from evidence tied to the stored failing check, or suppress the dependency assertion when that ownership is unknown. Do not infer historical ownership from absence in today's pytest list plus a non-`.py` suffix. Keep the implicit Node/no-policy control where Node ownership is known, and add the real text-doctest case for deleted and no-longer-declaring policies through both callers. Preserve the installed-lockfile, mixed-runner and not-yet-hashed controls. If an exception is desired instead, it requires an explicit contract decision; this review does not accept one.

## Should-fix and nits

None beyond B1's required coverage.

## What fits

- The repair closes the original `.py` reproductions under valid, malformed, missing, EISDIR, EACCES and no-longer-declaring policies in both callers.
- A reported policy problem and an absent worktree row suppress the sentence for every probed check, including Node. This follows the repair's stated conservative fallback.
- Node failures retain the sentence with a valid policy or no policy and no installed Node lockfile. The repair's bundle diffs carry the same `nodeFailing` changes; no caller contract or public payload type changed.
- A readable valid policy that still declares the pytest project suppresses the warning for text doctests too. The failure is specifically historical runner identity after that declaration is lost.
- The new regression tests cover the intended `.py` fallback cases. They leave the non-`.py` pytest case untested, so their green result is consistent with this blocker.

## Inputs for the next decision

B1 is not closed at `adc26b1d`. This is the second failing review round of the slice; process step 6 sends the decision to the human through the coordinator. No changes to 007-44 are requested. Any further repair must distinguish a stored pytest result from an implicit Node result without relying on the current policy's complement, and prove both callers with the doctest case above.
