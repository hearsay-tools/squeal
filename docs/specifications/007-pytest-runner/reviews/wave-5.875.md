# Third narrow re-review of 007-40 B1, wave 5.875

## Verdict

**FAIL 3ed0dae477ff908debdf31d7ef33c6a1349b2bc6** (`cand/0.1.195`). One proven blocker, medium severity: wave-5.75 B1 remains open for a pytest doctest whose file has a JavaScript or TypeScript suffix. No additional should-fix items or nits.

Scope: repair `8527f236`, its regression tests, and B1 in both dependency-warning callers. The prior reviews' conclusions about 007-44 and the rest of 007-40 stand. The explicit `.txt` reproductions in this round's brief are fixed; they do not establish the broader contract that this warning never accompanies a pytest failure.

## Verification

The tree was clean and `git rev-parse HEAD` was `3ed0dae477ff908debdf31d7ef33c6a1349b2bc6` during verification and the standalone probe. Node v24.21.0. Probe scripts and fixtures were outside the worktree and removed before committing this review.

```text
$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.195 lint
> biome check .
Checked 1290 files in 534ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.195 typecheck
> tsc --noEmit
exit 0
```

`npm ci` also printed the `node-domexception` deprecation and six-package install-script advisory. Build and build-drift verification were deliberately omitted under the task's explicit instruction; they are unverified, not findings.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  630 passed | 1 skipped (631)
      Tests  5231 passed | 10 skipped (5241)
   Start at  13:14:03
   Duration  964.28s (tests 98%, import 2%)
exit 0
```

No test failed in the independent full run, so no isolated rerun was needed. Sampled one-minute host load was about 16 to 101. Diagnostics included two fixture worktree-repair messages, one earlier-run process cleanup, and Vitest's experimental typecheck notices; none remained as an error in the verdict.

## Blockers

### B1. A pytest doctest with a Node suffix still becomes a Node failure after policy loss

**Proven. Severity: medium.** `src/core/delivery/attribution.ts:243` and `:264`; regression coverage at `test/delivery/dependencies-runner.test.ts:142`. This is the same historical runner-identity defect as wave-5.75 B1. The 007-40 contract is: the sentence appears only beside a failure of a Node runner and never beside a pytest failure. Spec 007 D3 explicitly supports doctests; D2 requires an admitted environment before running pytest.

`NODE_TEST_FILE` proves a filename suffix, not which runner produced a stored result. Pytest's `--doctest-glob` can collect a file ending in `.js` just as it collects `.txt`. After its project leaves the current policy, that stored pytest failure passes both halves of `!pytest.has(check.project) && NODE_TEST_FILE.test(check.testPath)`. With hashed files and no installed Node lockfile, both delta delivery and a fresh registration print:

> No dependencies are installed in this worktree; failures that cannot find a package are expected until an install.

The Python environment that produced the failure remains installed. No spec or status amendment accepts an exception for doctest filenames overlapping Node's suffixes. The new positive suffix filter narrows the residual but does not establish historical runner ownership.

**Discriminating probe.** A standalone Node/tsx script synced the repository's small fixture with `syncFixture(..., "3.13")`, preserving the helper's isolated environment and hardlink policy. `readEnvironment` returned `ready` under CPython 3.13.14. Its pytest project was:

```json
{"name":"py","args":["--doctest-glob=*.txt","--doctest-glob=*.js"],"env":{},"include":["docs/*"]}
```

Both `docs/example.js` and `docs/example.txt` held the same text:

```text
>>> 1 + 1
3
```

The candidate's actual `listTestFiles` returned both files. Its actual `runPytest` returned `end: completed`, `failure: null`, both files completed, and these checks, each with `outcome: fail` and `DocTestFailure` (`Expected: 3`, `Got: 2`):

```text
{ kind: "test", project: "py", testPath: "docs/example.js", fullName: "example.js" }
{ kind: "test", project: "py", testPath: "docs/example.txt", fullName: "example.txt" }
```

For each policy condition, a fresh real store had a hashed test file and `uv.lock`, no installed Node lockfile, and a valid policy declaring `py`. The probe registered a session on a pass, stored the actual pytest failure while the policy still declared `py`, then changed only the policy before pulling a delta and registering a second session. `createStateSink`, `createDelivery`, `formatDelta`, and `formatRegistration` were the candidate's public interfaces. Assertions checked that each delta actually contained the failing check and each registration actually rendered its name. A synthetic `src/a.test.ts` failure was the Node control.

Each cell is **delta warning / registration warning**:

| Policy at delivery | pytest `.txt` doctest | pytest `.js` doctest | Node `.ts` control |
| --- | --- | --- | --- |
| Valid, still declares `py` | false / false | false / false | true / true |
| Missing file | false / false | **true / true** | true / true |
| File replaced by a directory (`EISDIR`) | false / false | **true / true** | true / true |
| Valid `{}`, project removed | false / false | **true / true** | true / true |
| Malformed JSON (`{`) | false / false | false / false | false / false |

The `.txt` control reproduces the exact previous blocker and proves this repair fixes it in both callers. Changing only the doctest's filename to `.js` and selecting it with the supported glob reopens the same false assertion. This is direct evidence against the repaired boundary, not a wider review of pytest.

**One-worker repair:** use runner evidence tied to the stored check or its recorded project, surviving policy deletion and project removal; when that evidence is unknown, suppress the dependency assertion. Do not replace this regex with another suffix heuristic. Preserve the implicit Node/no-policy behavior where Node ownership is established. Extend the existing table with a real `.js` doctest result and assert both that each caller includes the failure and that it omits the warning after missing, directory, and no-longer-declaring policies. Retain the existing `.py`, `.txt`, malformed-policy, mixed-runner, installed-lockfile, and not-yet-hashed controls. Keep any necessary ownership record small and local to this classification boundary.

## Should-fix and nits

None beyond B1's required coverage.

## What fits

- The exact wave-5.75 `.txt` doctest cases now suppress the warning in both callers after policy loss, EISDIR, and project removal. The regression table covers these cases beside the previously fixed `.py` cases.
- A `.ts` Node failure still gets the warning with a clean policy and with no policy file in both independently probed callers. Malformed policies retain the previous conservative suppression for all runners.
- The repair is confined to the shared classifier and tests, with no changes to the callers' `readonly CheckId[]` contract or public payload types. Key format 10's pin has no net change from the prior candidate.
- 007-44 and the prior review's settled normal-policy, mixed-runner, installed, and unhashed behavior were not re-prosecuted.

## Inputs for the next decision

B1 remains open at `3ed0dae477ff908debdf31d7ef33c6a1349b2bc6`, despite the exact text-file reproduction being repaired. The coordinator takes the remaining proven contract break to the human; this review neither changes the contract nor authorizes another repair round. No changes to 007-44 are requested.
