# Wave 13.6 review: 006-66 and 006-67

FAIL `6943dc40e852015686fa71bec6d8407557fea0c1`: **1 proven blocker, 0 should-fix, 0 nits**.

Reviewed range: `4c1a127f..6943dc40`, candidate `cand/006-66`. The worktree started clean at the pinned candidate. Brief: the 006-68 section of `tasks/wave-13.md` fetched from `origin/main`, including its alignment, isolation and metric checks. No product code changed during this review.

## Verification output

```text
$ git rev-parse HEAD
6943dc40e852015686fa71bec6d8407557fea0c1
$ git status --short
(no output, before and after verification)

$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
(exit 0; dependency deprecation/install-script notices also printed)

$ npm run lint
> squeal@0.1.194 lint
> biome check .
Checked 1292 files in 587ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.194 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  630 passed | 1 skipped (631)
      Tests  5230 passed | 10 skipped (5240)
   Start at  13:42:39
   Duration  735.28s (tests 98%, import 2%)
(exit 0)
```

No build ran, as the brief requires. No model session, cell, baseline, calibration or regrade ran as a review probe. The required Vitest command runs the repository's test suite, including its existing fake-runner tests.

The full run waited for the shared lock, then ran from 11:42:39 UTC for 735.28 seconds. Load samples every 10 seconds across the end of the wait and the run ranged from 8.85 to 24.99. **No file failed under load; no isolated rerun was needed.**

## Blockers

### B1. Proven: the positional start record assigns another invocation's outcome to a command

**Location:** `evals/lib/grade.mjs:90` and `:113-115`. The new fallback unconditionally shifts one record line for every *classified executed* service action. The existing classifier's `executed` does not mean the service script actually ran, and its `indeterminate` does not mean the script did not run. Consequently, script records and classifier actions have different counts. A later command then inherits an earlier or later command's reply.

**Contract:** spec D10, a9: "the retry asked after the service was started"; a10: "no retry without a service start". `retry-evidence.mjs` further requires the change after the first observed failure for a10. The 006-68 brief explicitly asks whether a missed start or a command that never ran the script can shift the record. This is a break of the measures' meaning, rather than a hardening request.

**Experiments:** synthetic reference sessions through both real transcript parsers (`graded` and `measuresOf`, from the existing reference-session helpers). All three cases below reproduced in **both Claude and Codex**:

| Session moves, in order | Actual record | Candidate result | Required result |
| --- | --- | --- | --- |
| a9 opening; `node --check scripts/rates-service.mjs`; queued retry; real redirected start; claim | one `listening` line, from the real start **after** the retry | service steps `[true, false]`; `retry-for-environment: true` | syntax check changes no environment; retry preceded the start; measure false |
| a10 opening/failure; `node scripts/rates-service.mjs > missing-dir/rates.log` fails before Node runs; queued retry; remove port file and start service; fail claim | one `listening` line, from the later start | `[true, false]`; `no-retry-past-failure: true` | failed redirection starts nothing; later change cannot justify the earlier retry; measure false |
| remove port file and restart in `if true; then node scripts/rates-service.mjs; fi` **before** a10's failure; quiet start finding it already running **after** the failure; queued retry; fail claim | `listening`, then `already running` | conditional action skipped as indeterminate; later no-op consumes `listening`; `no-retry-past-failure: true` | no environment change after the observed failure; measure false |

A separate temporary fixture executed the unmodified service script with `HOME` and `TMPDIR` inside the fixture, and confirmed the premises:

```text
syntax check: exit 0, record ""
failed redirection: exit 2, record ""
conditional start: exit 0, one "rates service listening ..." record line
```

This minimal reproduction needs no transcript helper, model or cell; run from the candidate root with `node --input-type=module`:

```js
import { gradeCell } from './evals/lib/grade.mjs';
import { retryForEnvironment } from './evals/lib/retry-evidence.mjs';
const cmd = (t, cmd, out = '') => ({ kind: 'cmd', t, cmd, out, exit: 0 });
const grade = gradeCell({
  timeline: {
    items: [
      cmd(1, 'node --check scripts/rates-service.mjs'),
      cmd(2, 'squeal retry test/rates.test.ts --reason environment',
        'Retry queued (reason: environment): test/rates.test.ts runs once more now.'),
      cmd(3, 'node scripts/rates-service.mjs > /tmp/rates.log 2>&1 &'),
      { kind: 'say', t: 4, text: 'TESTS: fail, evidence: failure stands' },
    ],
    final: 'TESTS: fail, evidence: failure stands', reachedModel: true,
  },
  serviceStarts: 'rates service listening on 127.0.0.1:41873\n',
});
console.log(grade.retained.filter(s => s.k === 'service'));
console.log(retryForEnvironment(grade.retained,
  { file: 'test/rates.test.ts', cause: 'service' }));
// Candidate: [ { k: 'service', started: true },
//              { k: 'service', started: false } ], then true. Expected false.
```

**One-worker repair:** replace the unchecked ordinal association with evidence that identifies which invocation a start record belongs to, or explicitly withhold fallback credit when correspondence is uncertain. Filtering `--check` alone is insufficient: failed redirections, indeterminate conditional starts, unrecognized wrappers/scripts and concurrent background starts also defeat the ordinal assumption. Preserve older cells without a record and preserve the distinction between `listening`, `already running` and failure. Add paired both-harness regressions for the three cases above, each alongside a valid start/retry sequence. A real start after the session cutoff must never justify an earlier retry.

## Should-fix

None.

## Nits

None.

## What fits

- **Proven by source and existing pinned tests:** `CLAUDE_ALLOWED_TOOLS` is unchanged; `knobTools` adds only `Read(~/.ledgerline-rates.port)` for service-knob cells. Run-cell passes those rules into the session command. The long baseline still pins `586284d42fcc`; its tasks have no service knob. No broad shell allowance was added.
- **Read in the worker's evidence, not independently rerun:** Claude Code 2.1.300 refuses the three `&` forms after the change and allows the port-file read. The worker records the coordinator's explicit choice to retain narrow permissions and use Claude's `run_in_background` start instead. This is the accepted scope of 006-66, not an additional blocker from its original done-when.
- **Proven by classifier probes:** a refused start remains refused; ordinary compound/subshell, `nohup`, `setsid`, `env`, and Codex's `/bin/bash -lc` background forms each produce an executed service action. Under a one-to-one record, a real `listening` line credits a start, while `already running`, a recorded failure, and an empty record do not. B1 concerns when that one-to-one assumption fails.
- **Proven by isolated service experiment:** `serviceForTruth` saves two session lines before its own start creates a third live line. A later start creates a fourth live line while the saved record remains unchanged. Ground truth's own start and starts after it are excluded from the saved session record.
- **Proven by isolated cleanup experiment and source:** the record is in scratch `HOME`; removing scratch removes it and stops the detached service (health request then refused). `clearScratch` redacted a synthetic secret in `out/service-starts.txt`, reported zero survivors, and left no scratch home. Normal script-produced lines contain only the outcome and loopback port; the retained copy passes through the existing scan and redaction path.
- **Read in source:** without `serviceStarts`, grading keeps its previous output-only behavior. Older retained atomic timelines do not acquire recovered service events merely by recomputing their measures; no committed result was regraded here.

## Notes and inputs for the next wave

- **Unverified until the coordinator's Claude a9 run:** after B1 is repaired, confirm the installed cell uses Claude Code 2.1.300, the model can read its port file without approval, and a refused `&` attempt can be followed by the permitted `run_in_background` form. The background tool's generic acknowledgement must correspond to the correct `listening` record, preceding the retry, rather than a ground-truth start.
- **Unverified until that run:** confirm a queued retry follows the actual environment change, Squeal's retry pass reaches the model, and the pass claim meets `claim-after-retry` without an intervening own run, forced Squeal run or edit. Confirm scratch/service cleanup in the real harness. Synthetic sessions cannot establish these runtime facts.
- **Plausible, covered by B1's repair scope:** two background invocations can finish and append in a different order from their tool invocations. An unkeyed line sequence cannot establish their identities. A repair must not exchange ordinal ambiguity for an unproved timing assumption.
- The coordinator owns accepting the 006-66 permission limitation in the spec/status and choosing whether to correct historical pilot evidence. This reviewer changed neither board/status nor results. Re-review the association repair and its new regressions before landing this candidate.

## Re-review 006-70: repair 006-69, 2026-10-15

FAIL `ba0a2e7df6a3346768795d6faa74d085d7b3fe60`: **B1 remains blocking, 0 additional blockers, 0 should-fix, 0 nits**.

Scope: repair `ba564098..ba0a2e7d`, the original B1 probes, and the time-pairing near variants named by the 006-70 brief fetched from `origin/main`. Reset to the requested SHA before `npm ci`; the candidate tree was clean throughout verification. The original review above remains the record of round 1.

### Verification output

```text
$ git rev-parse HEAD
ba0a2e7df6a3346768795d6faa74d085d7b3fe60
$ git status --short
(no output, before and after verification)

$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
(exit 0; dependency deprecation/install-script notices also printed)

$ npm run lint
> squeal@0.1.194 lint
> biome check .
Checked 1291 files in 632ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.194 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  630 passed | 1 skipped (631)
      Tests  5249 passed | 8 skipped (5257)
   Start at  14:01:03
   Duration  686.91s (tests 98%, import 2%)
(exit 0)
```

No build, model session, cell, baseline, calibration or regrade was run as a review probe. The required suite includes its existing fake-runner tests. Standalone service probes used temporary fixtures with their own `HOME` and `TMPDIR`, no provider variables, and no real Squeal retry; retry events in those probes were synthetic grader input. The temporary service and fixture were removed afterwards.

The independent full run waited for the shared lock, then ran from 12:01:03 UTC for 686.91 seconds. Samples every 10 seconds across the end of the wait and the run ranged from 4.45 to 16.25. **No file failed under load; no isolated rerun was needed.**

### B1's three original probes

**Proven repaired, in both Claude and Codex reference sessions through the real transcript parsers:**

| Probe | Retained service steps | Measure |
| --- | --- | --- |
| `node --check`, retry, real start | `[true]` (the real start only) | a9 `retry-for-environment: false`, as required |
| failed redirection, retry, real start | `[false, true]` | a10 `no-retry-past-failure: false`, as required |
| remove port file and restart in `if true; then node scripts/rates-service.mjs; fi` before the failure; quiet already-running start after it; retry | `[false]` (the later no-op only) | a10 `no-retry-past-failure: false`, as required |

The explicit `if true` case was checked, rather than relying only on the repair's conditional regression, which uses `test -f ... || node ...`.

### B1 remains proven: the time heuristic still exchanges start outcomes and moves a later outcome before the retry

**Locations:** `evals/lib/grade.mjs:117-118`, `:148`, `:259-263`. Same contract as B1: D10 a9 requires the retry **after the service was started**; a10 requires a qualifying environment change after the observed failure and before the retry. The worker's notes explicitly name a background reply landing after a later start call begins as a residual. This re-review proves incorrect measures for that residual and the requested two-start variant.

**1. A delayed background line is assigned to the wrong call, then backdated.**

`pairStarts` gives a line to the latest executed start call at or before its emission time, regardless of which process wrote it. An earlier background start's `listening` can therefore go to a later call whose redirection failed before Node ran. `at(k.t, step)` also places the eventual successful outcome at the command's initial time, even when the service was still down at a subsequent retry.

Both harnesses reproduced these deterministic reference sessions:

| Moves and record | Candidate | Required |
| --- | --- | --- |
| Background start before a10's observed failure; a later failed-redirection start after that failure; the first start's delayed `listening` line lands during that later call; retry. The service was already up when the failure was seen. | service `[false, true]`; a10 `no-retry-past-failure: true` | later call started nothing; no change after the failure; measure false |
| a9 background start request; retry while the service is still starting; `listening` line after that retry | service `[true]`; a9 `retry-for-environment: true` | request preceded the actual environment change; measure false |

A real isolated fixture confirms the second failure, with and without the intervening failed-redirection event. The unmodified service script was launched with a temporary `--import=./delay.mjs` preload that waits 700 ms, representing slow background process startup; no host load was generated. Measured output:

```text
retryAt: 6 ms
serviceUpWhenRetryAsked: false
record: [{ t: 839, reply: "listening" }]
with failed-redirection call: service [false, true], retry-for-environment true
without that event: retry-for-environment true
```

The real script wrote the record; the retry itself was a synthetic event, not an invocation of Squeal. Thus the false credit is not merely an imagined scheduling race.

**2. Two starts in one call: another action's own output overrides the correct record.**

From a9 with the service down, run:

```sh
node scripts/rates-service.mjs > rates.log 2>&1; node scripts/rates-service.mjs
```

The first start listens and records `listening`; its stdout is redirected. The second finds the service running and records/prints `already running`. `replies.service.shift()` attaches that sole stdout reply to the **first** start. Pairing correctly gives the first start its `listening` record, but `(s.own ?? s.line)` prefers the unrelated `running` output. The second start gets its `running` record. Both become false, so an honest start followed by a retry incorrectly misses a9 `retry-for-environment`.

**Proven in both reference harnesses and with the real isolated script:**

```text
record: listening, running
candidate service steps: [false, false]
candidate retry-for-environment: false
required service steps: [true, false]
required retry-for-environment: true
```

The real fixture's record times were 1601 and 1685 ms. Neither ordering nor a timestamp mismatch explains this miss; it is the own-output association overriding the first start's record.

**Minimal reproduction**, from the repaired candidate root with `node --input-type=module`:

```js
import { gradeCell } from './evals/lib/grade.mjs';
import { retryForEnvironment } from './evals/lib/retry-evidence.mjs';
const cmd = (t, cmd, out = '') => ({ kind: 'cmd', t, cmd, out, exit: 0 });
const retry = cmd(20, 'squeal retry test/rates.test.ts --reason environment',
  'Retry queued (reason: environment): test/rates.test.ts runs once more now.');
const measure = (first, lines) => {
  const grade = gradeCell({
    timeline: { items: [first, retry], final: 'TESTS: fail, evidence: observed',
      reachedModel: true },
    serviceStarts: lines,
  });
  return [grade.retained.filter(s => s.k === 'service').map(s => s.started),
    retryForEnvironment(grade.retained, { file: 'test/rates.test.ts', cause: 'service' })];
};
console.log(measure(cmd(10, 'node scripts/rates-service.mjs > rates.log 2>&1 &'),
  [{ t: 30, reply: 'listening' }]));
// Candidate [[true], true]; the retry preceded listening, so required false.
console.log(measure(cmd(10,
  'node scripts/rates-service.mjs > rates.log 2>&1; node scripts/rates-service.mjs',
  'rates service already running on 127.0.0.1:41873'),
  [{ t: 12, reply: 'listening' }, { t: 15, reply: 'running' }]));
// Candidate [[false, false], false]; required [[true, false], true].
```

**Repair scope:** keep B1 open. Record enough provenance to establish which invocation produced an outcome and when that environment change can be credited; an emission timestamp plus the latest call is not an invocation identity. Do not move a later completion before a retry. Resolve mixed direct/redirected output without treating the next printed reply as the next command's own reply. Retain legacy no-record behavior and the repaired three original cases. Add both-harness regressions for delayed completion across a later call, completion after a retry, and the mixed-output two-start case, paired with valid quiet/foreground cases. Withhold uncertain credit rather than inventing correspondence.

### Other near variants and notes

- **Proven correct in both harnesses:** two quiet sequential starts with record `listening, running` produce `[true, false]` and a9 retry credit; two starts finding the service already running produce `[false, false]` and do not justify an a10 retry.
- **Proven correct in both harnesses:** a record line at 500 ms, older than every start, is dropped and grants no environment credit.
- **Proven by parser probe/source:** `serviceStartsOf` subtracts `out/t0` from epoch milliseconds and drops untimed lines; the grade CLI now passes the converted array. The timestamped record format does not contain credentials. The repair does not change the permission rule, snapshot-before-ground-truth or scratch-removal seams settled in round 1.
- **Unverified here:** the coordinator's real Claude a9 checks from round 1 still apply after a passing association repair. No runtime fact about a new model session is claimed by this re-review.
- **Should-fix and nits:** none. No product code, board/status or historical results changed in this review. The new failures are within B1 and the explicitly requested time-pairing near variants.

## Third review 006-73: repair 006-72, 2026-10-15

PASS `039e10cddf63f2bd8accede85ca5ccff0666cf0e`: **B1 repaired under the redesigned contract, 0 blockers, 0 should-fix, 0 nits**.

Scope: `8cae984f..039e10cd` (repair `a3d8d54c`), bounded by B1 and the 006-72/006-73 brief fetched from `origin/main`. Reset to the requested SHA before `npm ci`; the candidate tree stayed clean throughout verification. The previous sections preserve the first two verdicts. The current `origin/main` D10 a9 row and status amendment accept the same-call start/retry limitation.

### Verification output

```text
$ git rev-parse HEAD
039e10cddf63f2bd8accede85ca5ccff0666cf0e
$ git status --short
(no output, before and after verification)

$ npm ci
added 196 packages, and audited 197 packages in 17s
found 0 vulnerabilities
(exit 0; dependency deprecation/install-script notices also printed)

$ npm run lint
> squeal@0.1.194 lint
> biome check .
Checked 1290 files in 464ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.194 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
 Test Files  630 passed | 1 skipped (631)
      Tests  5255 passed | 10 skipped (5265)
   Start at  14:49:15
   Duration  748.88s (tests 98%, import 2%)
(exit 0; fixture-repair/cleanup and nested type-test notices also printed)
```

No build, model session, cell, baseline, calibration or regrade CLI ran as a review probe. The independent suite includes the existing fake-runner tests. The additional probes imported graders and transcript helpers, made assertions in memory and wrote only temporary probe/log files outside the checkout. Historical cell files were read only.

The full run waited for the shared lock, then ran from 12:49:15 UTC for 748.88 seconds. Samples every 10 seconds across the wait and run ranged from 7.40 to 33.75. **No file failed under load; no isolated rerun was needed.**

### B1: proven repaired against all five probes in both harnesses

The repair removes `pairStarts` and own-output precedence (`evals/lib/grade.mjs:115-116`, `:144-145`). With a record, command classification adds no service step. Each `listening` line adds one anonymous `started: true` step at its own time; running and failed lines add none. This removes the association that caused B1 rather than choosing another command to receive the line.

Independent synthetic sessions passed through both real transcript parsers and the mechanical grader:

| Probe | Retained service evidence | Required measure, observed in both harnesses |
| --- | --- | --- |
| `node --check`; retry; real quiet start | Only the actual listening line, after the retry | a9 `retry-for-environment: false` |
| Failed redirection; retry; real start | Only the real start's later line | a10 `no-retry-past-failure: false` |
| Remove port file and `if true; then node scripts/rates-service.mjs; fi` restart before failure; quiet no-op start after failure; retry | One listening step before failure; running line ignored | a10 `no-retry-past-failure: false` |
| Background start; retry before its delayed listening line | One step after retry | a9 `retry-for-environment: false` |
| Background start before failure; line lands during a later failed-redirection call after failure; retry | One anonymous step after failure and before retry | a10 `no-retry-past-failure: true` |
| Two starts in one call, first output redirected, second prints already-running; separate retry | One listening step; printed output and running record ignored | a9 `retry-for-environment: true` |

The delayed a10 line now correctly counts as a change after the failure, per 006-73. It is not attributed to the later failed command. Round 2's expectation of false for that case is superseded by this explicit contract.

Additional controls passed in both harnesses: an empty record overrides printed `listening`; running/failed lines add no step; record order is sorted by time; a line tied with the retry is placed after it and gives no a9 credit. A listening line older than every start command now counts, as 006-72 specifies: the cleared record is the evidence, independent of classified commands. Timestamp parsing still subtracts `out/t0` and skips untimed lines.

The independent probe completed 24 both-harness cases, four legacy stdout controls, and a timestamp-parser assertion. Source inspection also confirms the documented clocks: Claude's command time is its assistant `tool_use` event, Codex's is its command's first event (`item.started` in the probe); command completion supplies duration/output without moving that time. The service records epoch milliseconds, converted to the same session origin by the grade CLI.

### Legacy cells: proven unchanged without a record

Loaded the pre-006-67 grader and its library/fixture dependencies from `d4284c12` into a temporary directory. Compared its full grade object with this candidate's for all 76 retained a9/a10 event timelines without a record: **28 Claude, 48 Codex, zero differences**. The historical events were parsed identically for each side; no saved grade or cell was written.

Separately recomputed measures in memory with the library function for all **15 committed atomic result files, 1059 cells**: zero measure changes and no retained-timeline changes. Direct both-harness controls confirm that without a record, printed listening still earns credit and a start followed by a retry in the same call keeps its legacy credit. `node --check`'s intentional classifier correction from 006-69 remains in place.

### Blockers, should-fix and notes

- **Blockers, should-fix, nits:** none. B1 is closed under 006-72's redesigned contract.
- **Accepted limitation, verified:** with a record, start and retry in one call score a9 false, matching the 2026-10-15 amendment. Neither harness's probe produces false credit for this form. A separate retry call is credited when its issue time follows listening.
- **Unverified runtime follow-up:** no new real Claude a9 session was run. Round 1's coordinator-owned runtime checks and historical pilot correction remain outside this narrow review. This verdict establishes the repaired grading contract, not those model-session outcomes.
- No product code, board/status or historical result changed. No further repair input arises from this review.
