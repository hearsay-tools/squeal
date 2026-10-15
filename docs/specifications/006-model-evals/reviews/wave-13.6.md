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
