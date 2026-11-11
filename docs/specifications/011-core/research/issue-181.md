# Issue 181: a named new test file got no verdict while a direct run took seconds

The cezarion incident is **not reproduced**. In a small fixture on Squeal 0.1.429, a named new test file was listed at once and was not held by revision discovery. It still got no verdict for 61 s, while a direct Vitest run of it returned in 0.5 s. Two other things held it: a running tier of another file, and its own first-failure re-run, which waited behind a 30 s re-run of that file. This is a synthetic blocker. It does not prove what caused the incident.

2026-11-11, 01:21–01:28 UTC. Research baseline `1ac649d40` (0.1.430 released). Documentation and throwaway probes only. No product code, board, spec, status or skill was changed. No other session's daemon, socket or store was touched.

## Answers

| # | Question | Answer and evidence tag | Version |
| --- | --- | --- | --- |
| 1 | Can a named new unit regression wait remain behind revision discovery while a focused direct run returns in seconds? | **Not in this probe.** The new file's revision was listed within about 1 s (`refinedRevision: 2`, `runnerPartPending: false`, `testFilesListed: true`). The wait still had no verdict after 15 s, exit 3, while the direct run failed in 509 ms. What held it was a running tier, then a first-failure re-run behind another file. **verified by experiment** | 0.1.429, Vitest 5.0.3 |
| 2 | Is the cezarion incident reproduced? | **Not reproduced, because** the issue gives no store, daemon log or trace, the cezarion workload (1,869 test files: 33 current, 137 pending and 1,699 unknown in the recorded revision-6 JSON) was not replayed. The issue reports pending discovery, intermittent late heartbeats, a locked stop write and three oxlint timeouts. These combined conditions were not recreated. In the probe the revision advanced at once and the heartbeat was on time. **inferred** from the issue's JSON | incident 0.1.429 |
| 3 | Installed runtime against the reported 0.1.429 | Installed CLI and plugin: **0.1.430**. Retained 0.1.429 exists and was the CLI the probes used. The difference from 0.1.429 to 0.1.430 is only 020-14 (`import("x")` types in the counter); no scheduler or status change. **read in source code** (`git log squeal--v0.1.429..squeal--v0.1.430`) | 0.1.429, 0.1.430 |
| 4 | Host load before live work | 14.19 at the start on 24 CPUs. 14.12 before the blocked run, 16.78 before the control run. All below the CPU count, so live probes ran. **verified by experiment** | n/a |

## Host and versions

```text
$ date -u; nproc; cat /proc/loadavg
Wed Nov 11 01:21:52 UTC 2026
24
14.19 11.11 8.49 19/3053 626834
$ /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version   # path from the issue
0.1.430
$ squeal --version            # /home/agent/.local/bin/squeal
0.1.430
$ ls /home/agent/.codex/plugins/data/squeal-hearsay/versions/ | tail -2
0.1.429
0.1.430
```

Node v24.22.1. The probe recorded `"version":"0.1.429","vitest":"5.0.3"`.

## Experiment

Probe: `research/probes/issue-181/` (README gives the full sequence). Commands, from the checkout root:

```sh
node docs/specifications/011-core/research/probes/issue-181/probe.mjs docs/specifications/011-core/research/probes/issue-181/evidence-blocked
node docs/specifications/011-core/research/probes/issue-181/probe.mjs docs/specifications/011-core/research/probes/issue-181/evidence-control --control
```

The fixture has `fast.test.ts` (50 ms) and `slow.test.ts` (30 s), lookup-only baseline. In the blocked scenario, `slow.test.ts` is edited and starts its run. Then the probe writes `blocked-switch.test.ts`, a new file whose one test fails, and at once starts `squeal status --wait 15000 blocked-switch.test.ts` beside `node_modules/.bin/vitest run blocked-switch.test.ts`. The control does the same with no run in flight.

### Results

Times are from when the new file was written, from the fixture store's `runs` table (`store-runs.txt`).

| Event | Blocked | Control |
| --- | --- | --- |
| Direct Vitest run of the new file | exit 1 in 509 ms | exit 1 in 507 ms |
| Revision with the new file listed | yes, at the first status call (about 1 s) | yes |
| Named wait, 15 s | **no verdict, exit 3**, after 15.2 s | **FAIL verdict, exit 1**, after 1.3 s |
| First run of the new file | +29.5 s to +29.8 s, fail | +0.2 s to +0.5 s, fail (with `fast.test.ts`) |
| Re-run of the new file (first failure) | +60.1 s to +60.3 s | +0.5 s to +0.7 s |
| Verdict | about +61 s (`final-wait.out`: "after 45.4 s" of a second wait) | +1.3 s |

The blocked wait's own words (`evidence-blocked/named-wait.out`):

```text
Revision: 2 · ffb7098c + 2, dirty
Selected: blocked-switch.test.ts
Pending (1):
  1 queued, promoted, behind the vitest tier of 1 test file running since 02:23:37; the tier has run past its estimate and yields at 02:24:07, 30 s past it: blocked-switch.test.ts
Named test files have no verdict: the deadline passed after 15.0 s: 1 test file still pending at revision 2: [...]
```

Store runs in the blocked case (`evidence-blocked/store-runs.txt`, abridged):

```text
slow.test.ts            rev 1  217850..247912  run cancelled: it yielded to an edit's work, a promoted file or a runner part waiting for it (30006 ms, no file completed)
blocked-switch.test.ts  rev 2  247923..248199  completed (FAIL, report.json)
slow.test.ts            rev 2  247926..278207  completed
fast.test.ts            rev 2  278214..278442  completed
blocked-switch.test.ts  rev 2  278449..278693  completed (FAIL, stored)
```

### Findings

F1. **verified by experiment, 0.1.429.** Discovery did not hold the new file. Revision 2 was listed and refined while `slow.test.ts` ran (`runnerPartPending: false`). The file was promoted at once.

F2. **verified by experiment, 0.1.429.** The promoted file waited behind a running tier until the tier yielded, 30 s after the tier started. `slow.test.ts` had no duration estimate, so the yield came after 30 s, when its own test had nearly ended. The yield then cancelled it and discarded the result (`completedFiles: []`), so it ran again for 30 s.

F3. **verified by experiment, 0.1.429.** The new file's first failure was re-run (spec 001 D6 as amended by row 001-171, quoted in `src/core/scheduler/rerun.ts`: "reported at once, then its file is re-run once in the next tier, forced, at its normal D5 priority"). That re-run started only after the 30 s re-run of `slow.test.ts` and after `fast.test.ts`. The named verdict came only after the re-run, about 30 s after the first failing run had ended.

F4. **inferred, 0.1.429.** The named wait seems to count a file queued for its first-failure re-run as pending, and the re-run seems to lose the promotion once the first result is current (C15 "Lifetime": a file stays in its batch "until its result is current at its key"). The store order supports this: an unpromoted `fast.test.ts` ran before the re-run. The source path was not read to confirm it. In the control the re-run came at once, so the effect is invisible without other queued work.

F5. **inferred, incident 0.1.429.** The issue's recorded JSON is revision 6, with `runnerPartPending: true`, listing runners Vitest and node:test, 137 queued files and no running files. It records a 12,321 ms late-heartbeat age with daemon state `down` after stop; the earlier named wait at revision 4 reports a 21 s stale heartbeat while the socket answered. The incident includes the named status reason text quoted in the issue. These observations do not establish which operation or lock caused the delay. The probe did not reproduce these combined conditions.

## Comparison with earlier research

- `issue-142.md` (0.1.390): a new file reads "not listed yet" while discovery is pending; the original stall was not reproduced. Here discovery was not pending, so that path did not apply.
- `issue-139.md` (0.1.390/0.1.393): a capacity wait that status does not name. Not seen here; the wait named its blocker.
- `issue-152.md` (0.1.407): a completed file waits for its batch's tier to end. F3 is close to it: a known failing result exists, but the verdict waits for more work in the queue.

## Recommendation for Squeal

Keep #181 open as an incident not reproduced. Do not record discovery as its cause. Two cheap follow-ups decide more than a longer probe:

1. Obtain the incident daemon log and operation/lock timing around the reported named wait for `packages/cezar/src/workflows/removed-project-root.test.ts`. The issue already includes its pending-discovery reason line; the concrete blocking operation remains unknown.
2. A row may confirm F4 in source: whether the first-failure re-run of a named file keeps its promotion, and whether the named verdict must wait for it. The issue reports two intended regression failures in newly added tests; this makes the new-failure control relevant without proving a shared cause.

## Limits

- One run per scenario, n = 1. Timings at load 14 to 17 on 24 CPUs.
- Synthetic fixture of 3 files; no lint, no coverage, no other worktree, no claim.
- The probe did not make the runner part slow, so "behind revision discovery" was not forced. It was only observed not to happen.
- The incident's late heartbeat and missing revisions were not reproduced.
- `events.json` `ms` fields of events with a duration are the command's duration, not time since start (probe README).

## Sources

- Issue: `gh issue view 181 -R hearsay-tools/squeal --comments` (read 2026-11-11 01:21 UTC).
- Spec `docs/specifications/011-core/spec.md` C4 (validity, yields; read in part), C15 (named demand: "An unlisted revision ... no tier starts until the revision is listed, promoted or not"; "Lifetime").
- Source `src/core/scheduler/rerun.ts` header at `1ac649d40`.
- Tags `squeal--v0.1.429`, `squeal--v0.1.430`.
- Probe and evidence: `docs/specifications/011-core/research/probes/issue-181/`.
- Comparison: `research/issue-139.md`, `research/issue-142.md`, `research/issue-152.md`.
