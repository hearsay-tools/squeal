# Format-18 bundle review

Candidate: `cand/0.1.228`, pinned to `8a4af878d6977913813babe9202ec7a4d72e6a2f`.

**FAIL: 1 proven blocker, 0 other findings.** The comparison's coverage reader can reject a changed line that its cases executed. No proven product-state or inheritance break was found in the six rows.

## Verification

All checks and probes ran against the pinned candidate with no product edits. The range named by the brief is `origin/main..8a4af878`; the local remote-tracking main also precedes the explicitly excluded 0.1.227 work. The reviewed product delta is therefore `00a99166..8a4af878`. Nothing in 011-42 or 011-46 is a finding here.

```text
$ git rev-parse HEAD
8a4af878d6977913813babe9202ec7a4d72e6a2f

$ npm ci
added 196 packages, and audited 197 packages in 39s
32 packages are looking for funding
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.228 lint
> biome check .
Checked 1525 files in 1498ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.228 typecheck
> tsc --noEmit
```

These commands exited 0. `npm ci` also warned about the deprecated `node-domexception` package and six packages with install scripts not covered by `allowScripts`. `npm run build` was deliberately omitted, as the review assignment requires.

Independent full-suite output (exit 1):

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  3 failed | 761 passed | 1 skipped (765)
     Tests  3 failed | 6416 passed | 10 skipped (6429)
  Duration  1269.97s (tests 97%, import 2%, transform 1%)
```

The first attempt was interrupted by the cockpit restart without a verdict. The recovered run above completed against the clean pinned tree; it is the full proof used here. The three failing files were then run individually, sequentially under the same lock, using `npx vitest run <file> --maxWorkers=1`:

| File | Failure in the full run | Standalone result |
| --- | --- | --- |
| `test/daemon/vacant-wait.test.ts` | The `--await-lock` waiter returned a daemon handle rather than `lost-lock` at line 180. | Exit 0; 1 file, 6 tests passed; 20.78 s. |
| `test/harness/opencode-dispose.test.ts` | The held Stop expired before the new turn reached its request; all three barrier attempts missed the 2 s deadline. | Exit 0; 1 file, 3 tests passed; 18.50 s. |
| `test/e2e/pytest.test.ts` | Python 3.10's synced third worktree recorded one completed billing run where zero were expected at line 350. | Exit 0; 1 file, 8 tests passed; 254.53 s. |

These are the three files that failed loaded and passed alone. The reruns do not erase the full-run failures; none supplies a proven additional defect in this range. The OpenCode failure explicitly missed its timing barriers. The waiter and pytest failures were not reproduced in their standalone runs.

Squeal's separate background checkpoint completed at revision 2 with 7,082 passing checks and two known 001-390 recorder-fidelity failures (`test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`). Their recorded histories predate this candidate; the independent full run passed both files. The final status returned on quiet with zero running or queued checks. These background failures are not findings against this bundle.

## Blockers

### B1. Proven: coverage from an uncalled phase hides coverage from the phase that calls the function

Location: `test/keys/validity/coverage.ts:26-42`, especially the concatenation at line 38, and `countAt`'s range selection at line 52. Callers: `sides.ts:106-109` and `compare.ts:154-174`.

011-37 section 3 requires that every changed emitted line ran in some case, and that the comparison passes when outputs agree and coverage is complete. The new comparison has separate `run` and `decide` child processes. `coverageOf` concatenates all their V8 ranges. `countAt` then picks the narrowest range, retaining the first on a tie. A function not called by `run` has a zero-count function range. When `decide` calls it, that execution has the same outer function range with a positive count. The first zero wins, so an executed changed line is falsely reported as uncovered. Which report is read first also makes the result depend on report ordering.

The smallest counterexample, run in the candidate tree:

```sh
node --import tsx --input-type=module -e 'import { unrun } from "./test/keys/validity/coverage.ts"; console.log(unrun("x\n", [{ start: 0, end: 2, count: 0 }, { start: 0, end: 2, count: 1 }], [1]));'
```

```text
[ 1 ]
```

Expected: `[]`, since one execution covered line 1.

A throwaway end-to-end probe also called `compareTrees` against this checkout itself, with only the six `accept` cases. Its sole overlay changed the beginning of `Ledger.probe` from:

```ts
const { store, worktreeId, now } = this.context;
let hits = store.results.byKey(key, now());
```

to:

```ts
const { store, worktreeId, now: readTime } = this.context;
const now = readTime;
let hits = store.results.byKey(key, now());
```

All six accept outputs agreed and neither tree threw. Nevertheless the comparison returned:

```text
outputsEqual: true
uncovered:
  src/core/scheduler/ledger.ts:316 (baseline bundle line 5752)
  src/core/scheduler/ledger.ts:316 (candidate bundle line 5752)
  src/core/scheduler/ledger.ts:317 (candidate bundle line 5753)
failures:
  changed lines no case runs, each needing a case under test/keys/validity/cases/: ...
```

The candidate's `probe` was executed by both decision runs. This is a false coverage rejection, not a missing corpus case. The baseline's own accept function is additionally never called by this flow: D1(a) deliberately makes the candidate decide over both stores. Requiring coverage of removed baseline decision code needs an explicit coverage execution outside the compared decisions, or a requirement limited to the decision code actually used.

Fix sized for one worker: preserve the boundaries between coverage reports, determine the innermost range within each execution, then count a line covered when any execution covers it, or use a correct V8 coverage merge. Merely taking the maximum of equally sized ranges does not handle a zero-count inner range from one execution masking a positive outer range from another. Cover both the small counterexample and a semantics-preserving overlay in a function used only by `decide`; retain the genuinely unrun branch self-test. Resolve the baseline decision coverage without changing D1(a)'s output comparison.

## Should-fix and nits

None.

## What fits

- **Formats 13 to 17 as 18.** The list is exactly 13 through 17, with the raising rows named. The format parameter changes only the environment-hash segment. 011-38 adds reading and copying; it does not change a stored check's identity, outcome or fingerprint. 011-39 is tests and CI fetch configuration only. The integration raises once to 18 and re-pins the source hash.
- **001-365 equivalence.** Policy `inputs` are wired through `daemon.ts`, `node-test-runners.ts` and the adapter solely to suppress advice for covered files. This does not alter closures, rows, observed sets or acceptance. Both list and map policies have regressions, including empty declarations and an end-to-end daemon check.
- **011-31 equivalence and cancellation.** A step-down calls the same idempotent `#cancelTiers` as stop before scheduling shutdown. Every lane and backlog slot receives that cancellation through the existing scheduler close. Completed files retain the existing record path; unfinished files remain queued. The hook sends stop after an accepted step-down, with at most two socket requests, retaining the old unknown-request fallback. Cancellation changes which runs finish, not what an already stored set means. The new two-lane tests distinguish the daemon's own cancellation from the hook's extra stop.
- **011-33 equivalence and lookup seam.** Handover reads the predecessor's pending rows and open moves, and only chooses which misses to queue. The baseline's existing `Ledger.settle` calls run before that choice, so 011-38 settles readable old-format rows without a second lookup path. `lookup-only` leaves unrelated cold-start misses unqueued. A pending failure re-run remains forced and is handed over. Grouping, environment-only keys, changed keys, default-baseline priority and the named wait have regressions. This changes scheduling, not stored-row meaning.
- **013-02 equivalence.** The adapter narrows the files withheld by a touch and recreates only for a counting touch. The barrier narrows withholding to each file's stability inputs and observed growth. Every file format 17 stored is still eligible for the same record construction at 18; rows newly allowed by 18 have no old row to misread. No recorder version or kept-observation semantics changed. The accepted self-written `fs` fixture deviation is recorded in 013's status log. The cross-release barrier and adapter cases remain 011-40/011-41 work, as the brief explicitly allows.
- **013-02 touch safety.** The module start set combines Vite's file index and cleaned IDs, covering virtual inputs and CSS imports. The walk falls back per project when no run file reaches a counted module. Read-once inputs withhold all files. Pending uncounted touches remain until calls already in flight return, so a transform that registers reads late can still make a touch count. The new tests cover regressions 1 to 11, including the overlapping runner-part transform and gh-33's two rewrites.
- **011-38 copy and adoption.** The SQL selects the set with the newest record time and copies its rows in one guarded statement. An existing current-key set prevents replacement or mixing. Provenance, failure text references and record time are preserved; normal lookup updates last-use. The memo is set after a successful read/copy and dropped on file removal or a newly stored matching older key. Risks 6, 7 and 8 have tests: list bounds, an older daemon's later write, and a confirmed foreign fail being held once more. A fault-injected probe confirmed a busy first copy is retried at the next lookup: `first: "database is locked", copies: 2, nextHits: 1`.
- **Merged seams.** `daemon.ts` retains both the policy-input wiring and step-down cancellation. `test/version-sensitive.txt` retains both new daemon entries. The accept harness's fake key index supplies `keysReadAsOne` on a miss.

The raw cross-release comparison against the last ancestral release, `squeal--v0.1.226`, ran 21 cases with formats pinned equally: no differing outputs, no thrown cases and no dependency-fingerprint difference. It reported 83 uncovered entries, including barrier and alias paths not yet in the corpus and the coverage defect above. The current test deliberately permits a raised format until 011-41, so its green result alone is not a complete coverage proof. Equivalence of this interim bundle also rests on the per-row readings above.

## Inputs for repair and the next wave

Repair B1 in the coverage reader and comparison self-tests only. Re-review that delta and the two discriminating probes; do not reopen the settled product paths without a new diff affecting them.

011-40/011-41 still own the accept/store extraction, retired-check comparison, the barrier/adapter cases at 17 and 18, and enforcement of coverage and raise-needs-a-difference. Keep the single lookup path and D1(a)'s candidate decisions over both stores. Do not infer complete coverage from `failures()` returning an empty list for different format versions.

011-25's newer namesake/direct-importer policy is outside this bundle. Its implementation should apply the same classification to handover and start baselines, which currently use closure reach for a small revision. This review evaluates 011-33 against its assigned 011-30 design and brief, not the pending policy row's implementation.
