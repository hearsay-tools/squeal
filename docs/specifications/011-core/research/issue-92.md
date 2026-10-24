# gh-92: load retries never run on a host that stays above one load per CPU

Researcher reproduction for [#92](https://github.com/hearsay-tools/squeal/issues/92), 2026-10-24. Documentation only. Worktree `cez/777777f6` at commit `9b48fa424` (`package.json` 0.1.292). The gate code is the same as in release `squeal--v0.1.291` (`39bca22e7`), the version the issue names: `git diff --stat squeal--v0.1.291 HEAD -- src/core/retry src/core/scheduler/retries.ts src/cli/retry.ts` prints nothing.

Host load at each probe start: `6.87 6.71 8.50` (one-minute 6.87, then 7.40 at the first run) on `nproc` 24. Both below the CPU count, so the live probe ran. The probe never loads the host: it mocks the load through `SchedulerOptions.hostLoad`.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Does a `load` retry stay queued without end while the one-minute load is at or above the CPU count? | Yes. 60 reconciliation passes at mocked loads 24 to 105 on 24 CPUs ran nothing; the request stayed unclaimed and unended. No time bound exists in the code or the spec. | verified by experiment; read in source code; read in spec |
| 2 | Does it open below the CPU count? | Yes. The first pass at 23.99 on 24 CPUs ran the file. The gate is `oneMinute < cpus`, strict, on the load now. The load recorded with the failure plays no part. | verified by experiment; read in source code |
| 3 | Does the FAIL stay counted until a pass? | Yes. While pending: `fail`/`current`. A rerun that passes ends the request `passed` and the state is `pass`/`current`. A rerun that fails ends it `failed` and the FAIL stays `current`. | verified by experiment; read in spec (C5, C6) |
| 4 | Is the original cezarion incident reproduced? | No. Only the mechanism is reproduced, synthetically. The incident (load 66 to 105, 13 web files, cezarion PR #1611) was not re-run, and the brief forbids loading the host. | n/a |
| 5 | Why did 4 of the incident's retries run and pass while load stayed 66 to 105? | Not determined, because no store, log or `--json` output from the incident exists. Candidate paths read in source: a request for a file with no result at its key runs at once whatever its reason (gh-36, `noResult`); a key change lapses the request and the file reruns as ordinary work; a short dip of the one-minute load below 24 that the reporter's samples missed. | inferred |

## Findings

**F1. The gate compares the load now with the CPU count, nothing else** (read in source code, 0.1.291 = 0.1.292). `src/core/retry/load.ts`:

```ts
export function loadAllows(load: HostLoad): boolean {
  return load.oneMinute === null || load.oneMinute < load.cpus;
}
```

`src/core/scheduler/retries.ts` `takeRetries` claims a due request only when `[...due.values()].every((d) => d.now) || loadAllows(loadOf(context))`. It runs in every reconciliation pass (the comment: "looked at in every reconciliation pass until then, however long that takes"). `src/core/retry/records.ts` has no expiry for a pending request: it ends by a run, by `--cancel`, by a key change (lapse), or by falling out of the newest 1,024 rows (`RETRIES_KEPT`). The load per CPU stored with the failing run (`failed-run-loads`, `recordRunLoad`) is read only for the text of inherited and recorded failures (C5), never by the gate.

**F2. The spec asks for this behaviour** (read in spec, `spec.md` C5, line 176): "`squeal retry <file>... --reason load` queues one run of each file for when the one-minute load average is below the host's CPU count, waiting as long as that takes", and "A request clears nothing: the FAIL stays counted in `Known failures` until a retry's run passes". It also says Squeal never retries such a failure "alone and never on a timer" (decided by the human, 2026-10-14). C6 (line 205): `Known failures: N` counts failures whose validity is `current`; and "a same-key forced re-run or retry of a current failure leaves it current until its run stores a result". The probe shows the state `current` while the request waits. So the issue reports specified behaviour; any change is a spec amendment, not a defect fix.

**F3. The CLI reply matches the issue's text** (read in source code; pinned by `test/cli/retry.test.ts`). `src/cli/retry.ts:236`: "runs once more when the one-minute load average falls below the CPU count, however long that takes (load average N on M CPUs now)". The probe's `waitsText("load", {83.92, 24})` gives the status wording: "waits for the one-minute load average to fall below the CPU count (load average 83.92 on 24 CPUs now)". No status text says the gate cannot open soon, and none names a manual check.

**F4. Synthetic reproduction** (verified by experiment). Probe `research/probes/issue-92/load-retry.probe.test.ts`, on the repo's own scheduler harness (`test/scheduler/helpers.ts`, `retry-fixture.ts`): a Vitest file fails while a marker file outside the worktree exists, which no key covers. Command, from the worktree root:

```
npx vitest run --config docs/specifications/011-core/research/probes/issue-92/vitest.config.ts --reporter=verbose --silent=false
```

Results (full output in `probes/issue-92/run-output.txt`; Vitest 5.0.3, Node 24.21.0, 3.80 s):

```
[gh-92] waits: waits for the one-minute load average to fall below the CPU count (load average 83.92 on 24 CPUs now)
[gh-92] after 60 passes at load 24..105 on 24 CPUs: runs=1 state=fail/current claim=null end=null
[gh-92] after 1 pass at load 23.99: runs=2 state=pass/current end=passed
[gh-92] load 5.46, cause kept: runs=2 state=fail/current end=failed
 Test Files  1 passed (1)
      Tests  2 passed (2)
```

Case 1 sets the failure at 104.73, removes the marker (a run would now pass), asks a `load` retry at 83.92, then cycles the loads 105, 66, 83.92, 70, 50, 30, 24, 24.0 for 60 passes. 60 passes stand for 30 minutes of the change feed's 30 s interval (the fixture's `pass` comment). Load 30 and 50 also hold it, so a gate at half the recorded load (52) would have opened at 50 and 30 in this run. Load 24.0 holds it: the comparison is strict.

**F5. Hand runs do not reach Squeal's state** (read in the issue; consistent with C4, where only a daemon's run stores a result). The reporter's `npm test -- --project web <files>` passes were not recorded. Not probed.

## Limits

- Mocked load only. The real `os.loadavg()` path (`hostLoad()`) and a daemon's 30 s pass timing were not exercised.
- One file, one worktree, one session. The incident's 13 files, other worktrees' daemons claiming at the same key (D8), and slot gating under load (C10) were not probed.
- The incident is not reproduced: no store copy, no `--json`, no daemon log from cezarion. Question 5 stays open.
- The probe imports test helpers from `test/scheduler/`; a change to them can break it. It is throwaway.

## Recommendation for Squeal

The issue is reproduced as specified behaviour (F1, F2): on a host whose one-minute load never falls below the CPU count, a `load` retry never runs and its FAIL stays counted, with no end and no hint. The decision is the human's, as a C5 amendment, because C5 forbids a timer-driven retry. The options the issue names, each with its tradeoff:

1. A gate relative to the load stored with the failure (`failed-run-loads` already holds it per run). Opens on a host that stays busy but calmer. A host that stays as loaded as at the failure still never opens.
2. A bounded wait, then a status line that says the retry cannot run soon and names the hand check. Changes text only; the FAIL still stays counted.
3. Run a load retry alone, with one worker, after a bound. Can attempt a verdict while the host stays busy; a timeout that comes from the load itself can fail again, which then ends the request `failed` (probe case 2 shows that path).

Option 2 is the smallest change and fits C5's "never on a timer" for runs. Options 1 and 3 change when Squeal runs work and touch C10's capacity rules.

## Open questions

- Question 5: which path ran the incident's four retries.
- Whether a retry run should be exempt from C10's backlog slot gate once the load gate opens. Not checked.

## Sources

- Issue: `gh issue view 92 -R hearsay-tools/squeal` (opened 2026-10-24 11:48 UTC, reported on 0.1.291).
- Spec: `docs/specifications/011-core/spec.md` C5 (line 176, retry; line 186, gh-36 amendment; line 179, recorded load facts, gh-52), C6 (line 205, `Known failures`), C10 (line 308, slots), C15 (line 402, next-step commands). `status.md` 2026-10-23 entry for 011-67 (`loadAllows` on one CPU's share).
- Source at `9b48fa424`: `src/core/retry/load.ts`, `src/core/retry/records.ts`, `src/core/retry/text.ts`, `src/core/scheduler/retries.ts`, `src/cli/retry.ts:230-243`.
- Related: board rows gh-52 / 011-67 (done, 0.1.271), gh-82 (proposed, `retry --wait`).
- Probe: `docs/specifications/011-core/research/probes/issue-92/` (README, `vitest.config.ts`, `load-retry.probe.test.ts`, `run-output.txt`).
