# Issue 251: a capped load retry spends the retry allowance while still overloaded

Recommendation: bring a narrowly bounded C5 retry-policy amendment to the human;
the reported refusal follows the current contract, and the synthetic mechanism
reproduces in both 0.1.570 and 0.1.572. This research authorizes no implementation.

## Scope and verdict

Examined 2026-11-20. Report: [#251](https://github.com/hearsay-tools/squeal/issues/251),
Squeal 0.1.570, revision 15. Current checkout and `origin/main`:
`b8d32f6b9f341dbd27d156e7d0bb42fc5d5dc3e9`, package 0.1.572.
Reported release source: `squeal--v0.1.570^{commit}` =
`af2018f1dce9f94f35c45cc189f0a014e1e79d16`.
Current release: `squeal--v0.1.572^{commit}` =
`816b63fb17d1c7c868ff76edaa43e197b3f51e19`.

**Reproduction verdict: synthetic mechanism reproduced; full incident not
reproduced.** A standalone probe imports the actual request, scheduling and
completion functions. It supplies fake time/load and a failing result. It does
not reproduce the reported test timeout, parent/subagent session mapping, live
daemon, CPU admission, CLI, pre-PR gate or CI recovery. The issue's attribution
of its timeout to overload remains the reporter's diagnosis.

Initial host measurement, before probing: 2026-11-20T00:24:24.642Z, one/five/fifteen
minute load `15.77 / 10.12 / 11.87`, 24 CPUs and available parallelism 24.
The one-minute load was below the CPU count, so the load-based skip did not apply.
No load was generated. Node v26.13.0 and pnpm 12.15.0 ran the probe, in under one
second per invocation. No tests, full suite, benchmark or live incident reproduction ran.

| Question | Answer and evidence |
| --- | --- |
| Does the 600 s cap admit a retry while overloaded? | Yes, into the queue at normal priority, not a guaranteed immediate start. F1. |
| Does another FAIL spend the session/key allowance after load clears? | Yes, for both reasons. F2. |
| Is the retry's load missing? | No. The failed run's tier-start load is already recorded, but budget accounting ignores it. F3. |
| Is this a regression between 0.1.570 and 0.1.572? | No change found in the relevant retry files; both source versions reproduce. F4. |
| Would a narrow run, wait or daemon restart reset this allowance? | Narrow run/wait do not force a current failure; the allowance is stored, not daemon-local. F5. |

## Findings

**F1, verified by experiment, 0.1.570 and 0.1.572.** With fake load 69.6 on
24 CPUs (2.90 per CPU), `takeRetries` does not queue at the first closed look or
at +599,999 ms. At +600,000 ms it claims and force-queues the file once, emitting
the expected overloaded-load note. This confirms C5's bounded gate. C4 and C15
still determine queue order and other admission constraints; the cap does not
prove the reporter's actual run started at exactly 600 s.

**F2, verified by experiment, 0.1.570 and 0.1.572.** After the probe supplies a
failing result to `endRetry`, the request ends `failed`. With fake load then
12 on 24 CPUs (0.50 per CPU), `takeRetries` queues nothing further and `askRetry`
returns `spent` for both `load` and `environment` at the same file/key/session.
A different session or key returns `queued`. The implementation's `spends`
counts a pending request or a passed/failed result, irrespective of reason,
gate expiry or load; only unknown/cancelled outcomes and no-result requests
avoid spending it. C5 explicitly defines one retry per key per session, shared
by its parent and subagents. The CLI maps `spent` to the refusal in #251.

**F3, verified by experiment, 0.1.570 and 0.1.572.**
The probe records and reads back the failed run's 2.9 load per CPU through
`recordFailedLoad`. In the actual recording path, `tiers.ts` samples load at
tier start; `record-tier.ts` records it before ending the retry. `RetryEnd.runId`
links the request to the failed run and `failed-run-loads` keeps its load.
`askRetry` never reads these facts. The reporter's proposal to record load is
partly already implemented. This is a tier-start sample, not a measurement of
every test's start or the whole retry interval; the map retains 1,024 runs.

**F4, verified by experiment, 0.1.570 and 0.1.572.**
The probe passed against the current checkout and an isolated archive of
0.1.570's source, with identical output. The five-file diff below is empty.
C5 and its 2026-10-25 amendment explicitly combine the bounded overloaded run
with the one-retry rule. Existing `load-retry-bound.test.ts` even expects a
capped retry that fails to end `failed`; those tests were read, not run here.
Changing the allowance would change policy, not merely restore current C5.

**F5, read in source code, 0.1.572; inferred for the incident.** C4 validity is
key-based, not load-based. `queueNarrow` excludes current files, including a
current FAIL, matching the reported narrow run returning that failure. C6
status reads state; C15 promotion does not change result validity or create a
second retry. A fresh daemon cannot reset an ended request still in the shared
`retries` row. The probe verifies refusal through another wrapper over the same
meta rows, not an actual restart. The record cap means this is not a claim of
permanent refusal after arbitrary later history.

## Decision and unknowns

**Inferred, based on both versions:** the decision is whether a failed retry
that ran while overloaded should permit one later, explicitly requested retry
below the threshold, while keeping the failure counted until a pass. That would
provide calmer evidence without asserting that overload caused the failure.
The tradeoff is another run at unchanged inputs versus C5's current bounded cost
and resistance to retrying a real failure until it passes. Scope any approval
to this allowance; existing holds on priority, unrelated retry/gate work and
implementation remain unchanged.

The human must settle the extra allowance, what observed load qualifies it,
what missing/evicted load means and how joined requests share it. The report's
later load of "about 1 per CPU" does not establish eligibility: `loadAllows`
requires strictly less than one, and equality stays closed. The incident's
actual run/load timestamps and same-input CI evidence were not independently
collected. No behavior change or remedy is validated by this research.

## Commands and sources

Read-only identification and host measurement:

```sh
node -e 'const os=require("node:os");console.log(JSON.stringify({utc:new Date().toISOString(),load:os.loadavg(),cpus:os.cpus().length,available:os.availableParallelism()}))'
git rev-parse HEAD origin/main
node -p 'require("./package.json").version'
git rev-parse 'squeal--v0.1.570^{commit}' 'squeal--v0.1.572^{commit}'
gh issue view 251 --json body,url
git diff squeal--v0.1.570..HEAD -- src/core/retry/records.ts src/core/retry/gate.ts src/core/retry/load.ts src/core/scheduler/retries.ts src/cli/retry.ts
```

Both exact probe commands and their complete output are preserved in
[probe README](probes/issue-251/README.md); both exited 0. No installed runtime
was substituted for the source versions named above.

- [C4, C5, C6 and C15](../spec.md), especially C5's external-failure paragraph
  and 600 s amendment; [status amendment log](../status.md), 011-213 and 011-343.
- [Request allowance](../../../../src/core/retry/records.ts), `spends` (130),
  `askRetry` (154), `RetryEnd` and `RetryRecord`.
- [Bound](../../../../src/core/retry/gate.ts), `LOAD_RETRY_WAIT_MS` (16),
  `markGateClosed`; [load threshold/storage](../../../../src/core/retry/load.ts).
- [Scheduler retry implementation](../../../../src/core/scheduler/retries.ts),
  `queueDue` (132), `endRetry` (168), `recordFailedLoad` (214).
- [Tier sampling](../../../../src/core/scheduler/tiers.ts), line 248;
  [recording order](../../../../src/core/scheduler/record-tier.ts), lines 192 and 195.
- [CLI refusal](../../../../src/cli/retry.ts), `askRetry` call and `spentLine`;
  [narrow run](../../../../src/core/scheduler/narrow-run.ts), `queueNarrow`.
- [Existing cap tests, read only](../../../../test/scheduler/load-retry-bound.test.ts).

All local source paths refer to the examined checkout SHA above; the archived
0.1.570 source was removed after its probe completed.
