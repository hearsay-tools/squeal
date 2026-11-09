# Wave 5 re-review: import repair R1 and recorder test S1

## Verification

Candidate: `cand/0.1.420`, `fe5ac46d212128bb222b1c0eafd35ba135319710`.
Range: `43fb35087cec16251b9adf146c8dbc7a018f58cd..fe5ac46d212128bb222b1c0eafd35ba135319710`.
Bounded by `reviews/wave-5.md`: re-check B1, B2 and S1, then inspect the repair delta. Inputs include amended D10/D11, the R1 brief in `tasks/wave-5.md`, and `tasks/018-18/notes.md`.

Checks and probes ran at the exact candidate with a clean tracked tree. The probe lived outside the checkout and was removed. No product file changed.

| Command | Actual result |
| --- | --- |
| `git fetch origin cand/0.1.420` | Exit 0 |
| `git checkout --detach fe5ac46d212128bb222b1c0eafd35ba135319710` | Exit 0 |
| `git rev-parse HEAD` | `fe5ac46d212128bb222b1c0eafd35ba135319710` |
| `git status --porcelain=v1` | Empty, before and after verification |
| `pnpm install --frozen-lockfile` | Not repeated: dependencies were installed by Cezar before the original review; this delta changes no manifest or lockfile. |
| `pnpm run lint` | Exit 0. `Checked 2901 files in 1204ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`, no diagnostics |
| `git diff --check 43fb35087..HEAD` | Exit 0, no output |
| Local build, local full suite, Squeal full-suite request | Not run, as instructed |

Affected results:

```text
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/core/store/transfer-rekey.ts src/core/keys/environment-descriptor.ts test/cli/ci-usage.test.ts
Revision: 2 · fe5ac46d + 0, dirty not known
Pending (556): 200 running, 356 queued
Current (188): 188 pass
Named test files have no verdict: the deadline passed after 60.5 s
Worktree: known failures 0; not current: 558 of 1533 test files (200 running, 357 queued, 1 unknown)
```

Exit 3. The daemon's heartbeat lapsed during the wait and later recovered. Git independently confirmed a clean tree. Pending affected checks are **unverified**, not findings. Targeted Vitest is explicitly requested by the re-review brief; the required S1 runs were:

```sh
pnpm exec vitest run --maxWorkers=1 test/cli/ci-usage.test.ts
```

```text
Test Files  1 passed (1)
Tests       9 passed (9)
Duration    7.64s
```

```sh
pnpm exec vitest run --maxWorkers=2 test/cli/ci-usage.test.ts test/cli/ci-record.test.ts test/store/transfer-rekey.test.ts test/keys/import-tolerance.test.ts test/status/import-observed.test.ts test/cli/import-rekey.test.ts
```

```text
Test Files  6 passed (6)
Tests       50 passed (50)
Duration    13.70s
```

Both exit 0. The recorder fixture's intentional failing and crashing child commands are expected; their parent assertions passed.

A second Squeal read selected those same six files:

```text
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/cli/ci-usage.test.ts test/cli/ci-record.test.ts test/store/transfer-rekey.test.ts test/keys/import-tolerance.test.ts test/status/import-observed.test.ts test/cli/import-rekey.test.ts
Revision: 2 · fe5ac46d + 0
Named test files at revision 2: no known failures; 6 test files, each with a current result, after 18.2 s
Worktree: known failures 0; not current: 344 of 1533 test files (4 running, 339 queued, 1 unknown)
```

Exit 0. The six focused files are current. Broader pending and unknown checks remain unverified.

CI: [run 42638715917](https://github.com/hearsay-tools/squeal/actions/runs/42638715917), for this exact SHA. Queried with `gh run list --commit fe5ac46d212128bb222b1c0eafd35ba135319710 --json databaseId,headSha,status,conclusion,url,name` and `gh run view 42638715917 --json status,conclusion,jobs`. At the last observation, all three Node 22 shards and the Node 24 lint/typecheck/version-sensitive job were in progress; build and bundle checks were pending. These results are **unverified**. No result from the earlier candidate is presented as evidence for this SHA.

## Verdict

**PASS**. Zero blockers, zero new findings. B1, B2 and S1 are resolved. This is the bounded repair judgment; it does not claim a full-suite or build pass.

## Blockers

None.

## Prior findings

### B1 resolved: the destination cannot drop an exported input

**Proven resolved.** `src/core/store/transfer-rekey.ts:109` now rejects the destination unless `holdsEvery` finds every exported closure path in the assembled local closure. The source-key reproduction check still runs first. A missing input leaves the result at its exported key. The import does not widen an existing closure or observed entry.

The independent source probe recreated the original real committed fixture. Its test reads `data/value.txt` and requires `good`; executing the test passes at the export and fails after the local value becomes `bad`. It used actual commit blobs, `environmentRecord`, `importResults` and the daemon's `KeyIndex`.

`pnpm exec tsx /tmp/squeal-wave5-r2-probe.mts` returned exit 0. Results:

| Local list case | Re-keyed | Results at edited local key | Local key / observed entry |
| --- | --- | --- | --- |
| Existing empty observed entry | 0 | None | Unchanged |
| Disjoint observed entry | 0 | None | Unchanged |
| Missing exported directory listing | 0 | None | Unchanged |
| Missing exported static input | 0 | None | Unchanged |
| Superset containing the exported files and listing | 1 | None | Unchanged |

Representative actual output:

```json
{"name":"empty","exportedExit":0,"localExit":1,"rekeyed":0,"resultsAtEditedLocalKey":[],"localKeyUnchanged":true,"observedUnchanged":true}
{"name":"missing-listing","exportedExit":0,"localExit":1,"rekeyed":0,"resultsAtEditedLocalKey":[],"localKeyUnchanged":true,"observedUnchanged":true}
{"name":"superset","exportedExit":0,"localExit":1,"rekeyed":1,"resultsAtEditedLocalKey":[],"localKeyUnchanged":true,"observedUnchanged":true}
```

The committed regressions cover these refusal cases and the successful superset case, including a listing. The pre-existing source-proof and CLI tests still pass. The original different-content false pass is closed.

### B2 resolved: unequal `allowOnly` is tolerated only false to true

**Proven resolved.** `src/core/keys/environment-descriptor.ts:249` drops the unequal field only when the export has the known hash of boolean false and the local descriptor has the known hash of boolean true. `configFieldHash` uses the same hashing operation as descriptor creation. It does not change a local environment key. True to false, missing fields and unrecognized values remain strict when they differ. Status and re-keying still call the same function.

The probe executed the original `it.only` fixture with Vitest 5.0.3: true exits 0, false exits 1. The unsafe import now returns an `allowOnly` difference, refuses re-keying and stores no pass at the strict local key:

```json
{"name":"unsafe","allowOnlyTrueExit":0,"allowOnlyFalseExit":1,"differences":[["allowOnly"]],"rekeyed":0,"resultsAtLocalKey":[]}
```

A separate policy control with a constructed false-to-true bundle returns no difference and re-keys once. It tests the permitted direction; it does not claim that this `.only` fixture passed with false. The committed tests cover both directions, missing and nonboolean export values, and status text.

### S1 resolved: the unsupported-project test uses a separate CLI process

**Proven resolved.** `test/cli/ci-usage.test.ts:50` starts the source CLI through tsx in its own process, with a scratch HOME and an environment containing no module path. Lines 92–101 retain the unsupported-runner note, exit 5, absent executable exit 127, and unchanged `.git`-only tree assertions. The file passes alone (9 tests) and together with `ci-record.test.ts` in the six-file run.

## Should-fix and nits

None in this bounded delta.

## What fits

- The repair is one source-key proof followed by a destination-input containment guard and the shared safe environment comparison. It adds no second store owner, changes no key encoding and moves no local run's key.
- Keeping `watch` two-way is consistent with the approved D10 tolerance. The worker's reason is supported by `research/ci-step.md:52` and the installed Vitest 5.0.3 `dist/chunks/inspector.CvyFGlXm.js:48`: `shouldKeepOpen` reads watch only to retain the inspector when isolation is disabled and one worker runs. The inspection does not establish a false-pass direction like `.only`; the independent guard on `snapshotOptions` remains. The tolerance tests exercise both directions.
- The generated CLI bundles for Claude Code, Codex, OpenCode and Pi contain the containment guard and the boolean-direction rule. The hook diffs add the hash constants and resulting generated symbol renames. Build reproducibility remains for exact-candidate CI to establish.
- D10 and D11 amendments match the repair. Existing node:test identity, browser-mode rules, recorder attachment/privacy and D15 behavior were settled by wave-5 and were not re-prosecuted. The delta does not reopen them.

## Inputs for the next wave

- No repair row is needed for this judgment. Before release, obtain passing full-suite CI and build/bundle evidence for the exact release commit. Pending evidence above is not a pass.
- Preserve both import guards. Reproduce the exported key with its own closure, environment, commit blobs and exact dependency/runtime `keyParts`; require the local closure to contain every exported path; then write under the local environment only when the shared D10 rule permits it. A failed guard keeps the exported key and changes no local key or existing observed entry.
- The earlier inputs for 018-17 and 018-20 still apply. In particular, emit exact `keyParts`, retain D9's refusals, and settle the part's `includeTaskLocation` difference before claiming daemon-equal keys. This repair does not add tolerance for that field or snapshot updates.
