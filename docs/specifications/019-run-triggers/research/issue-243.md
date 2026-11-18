# Issue 243: affected run-loop files wait for a pause

2026-11-18. Recommendation: the human should decide whether affected files may
cross a group's configured pause boundary, or whether edit-time messages should
expose the affected files and their narrow run command. Preserve existing holds.

## Questions and verdict

| Question | Answer |
| --- | --- |
| Can continuous activity keep a pause group's moment false? | **Verified by experiment:** yes, in a small predicate probe with a live consumer and six simulated hours. |
| Was the reported six-hour session reproduced? | **Not reproduced, because** the reporter's worktree, policy, daemon state and workload were not supplied; a faithful six-hour run exceeds the bounded triage budget. The probe reproduces the gating condition only. |
| Which spec owns it? | **Read in official docs:** 019 D1 (group moments) and D6 (status, narrow runs); related 011 C4/C6/C15 and legacy 004 D2/D8. |

## Environment and exact commands

Reported Squeal: **0.1.563**, Claude Code, revisions 25–50. Examined source:
package version **0.1.563**, commit `4c27c5a6936972c6841d236a76bb88b78caf4512`.
The session's installed Squeal primer also names **0.1.563**.

Commands executed from the repository root:

```sh
cat /proc/loadavg
nproc
node --version
git rev-parse HEAD
pnpm exec tsx docs/specifications/019-run-triggers/research/probes/issue-243/moment.ts
```

Host: 24 CPUs; Node `v26.13.0`. One-minute load was **10.40** at initial
research inspection and **10.13** immediately before the probe (5/15-minute
loads 7.24/5.62). Load was below CPU count, so the skip condition did not apply.
The probe took about 0.5 s including process startup and used no test runner.

Output (exit 0):

```json
{"simulatedHours":6,"pauseReady":0,"editReady":21598,"pauseReadyAfterIdle":true}
```

## Findings

1. **Verified by experiment, 0.1.563 source:**
   `research/probes/issue-243/moment.ts` calls the real `momentHolds` with
   synthetic consumer and revision records. Every simulated second refreshes
   the consumer's liveness. The consumer remains `in-turn`. The `pause` moment
   stays false for all 21,601 readings over six hours; an `edit` group with a
   fixed revision and 3 s quiet window becomes ready. Changing the same
   consumer to `idle` makes `pause` true immediately. Simulated time avoids a
   six-hour host run. This is a predicate experiment, not daemon integration.
2. **Read in source code, 0.1.563:**
   `src/core/scheduler/slow-trigger.ts`, `momentHolds` and `consumersIdle`,
   implement that rule. `pause` and `stop` require no live in-turn consumer.
   They do not read the revision age. Consumer expiry is 12 hours
   (`src/core/types/store-records.ts`, `CONSUMER_EXPIRY_MS`), and continued
   tool activity keeps a consumer live. `src/core/scheduler/slow-tier.ts`
   has separate explicit-request handling; a group's pending time alone does
   not turn its pause moment into edit.
3. **Read in official docs:** 019 D6 already defines
   `squeal run <group> <path>... --wait 60000` to run selected files regardless
   of moment. A status wait does not start files held by their moment. Thus
   the incident's proposed automatic promotion changes policy; surfacing
   affected pending files in edit messages is a separate delivery decision.
4. **Inferred:** the probe is consistent with the quoted “waiting for the
   agent to pause” output. It does not establish the cause of the tests-group
   backlog, the two 120 s gate timeouts, or the exact delayed failure files.
   Those may involve separate scheduling and admission mechanisms.

## Open decision and limits

Choose automatic bounded progress for affected files in pause groups, clearer
edit-time disclosure with a narrow command, or keep the configured boundary.
Do not treat this evidence as approval to change group policy, slow-file order,
load admission or existing human holds. No product code or normative document
was changed, and no full suite was run.

Sources: [issue 243](https://github.com/hearsay-tools/squeal/issues/243),
019 `spec.md` D1/D3/D6 and `status.md`; 011 `spec.md` C4/C6/C10/C15;
004 `spec.md` D2/D8 and `status.md`; the source paths and throwaway probe above.
