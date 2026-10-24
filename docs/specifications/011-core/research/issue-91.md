# Issue 91: what a named wait shows of a queue yield

Researcher, 2026-10-24, worktree commit `9b48fa424` (Squeal 0.1.292). Incident version: 0.1.289 on hearsay-tools/cezarion at `08a46e8f`. `git log squeal--v0.1.289..9b48fa424` shows no change to `src/core/scheduler/yields.ts`, `src/core/status/next-step.ts`, `src/core/status/standing.ts` or `src/cli/named-file-lines.ts`, so the probe's code matches the incident's for these paths (read in source code).

Verdict: four visibility gaps are reproduced. After a yield, a named wait does not show that a yield happened, which files it cut, how much run time it discarded or how far the restarted tier has run. The runtime cause of the incident is not proved: this probe does not show why the two promoted files were still queued after the restart.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Does a named wait show a queue yield? | Only while the yielding tier is in flight, and only on the queued, promoted files' line (`; the tier yields`). The line of the running files says `a running tier is not interrupted` at the same moment. After the cut, nothing names the yield. | verified by experiment |
| 2 | Does it show the affected (cut) files? | No. The cut marks live only in the daemon's memory (`TierYields.#cut`). The published `yields` meta row holds one `{ kind }` per tier in flight, with no file list. | verified by experiment; read in source code |
| 3 | Does it show elapsed work lost? | No. The cancelled run's start and end are not in any status line or `--json` field. The restarted tier's `since` replaces the first start. | verified by experiment |
| 4 | Does it show progress after the restart? | No. A `running` standing carries `lane`, `since` and `files` only: no ended-file count, no estimate, no remainder. | verified by experiment; read in source code |
| 5 | Is the incident's "cut" wording explained? | Yes. `cut` means a yield in this daemon's lifetime cut a file of the tier at its current key, and the tier will not yield again for that file. | read in source code |
| 6 | Why did the two promoted files stay queued after the restart? | Not determined, because the incident left no daemon log or run rows in the issue, and the probe ran the promoted files before the restart. | not determined |

## Method

Load before the probe: one-minute 5.36 on 24 CPUs (`uptime`, 16:15:16), under the CPU count, so the probe ran. No real worktree, daemon or cezarion test was touched; the probe uses the in-memory scheduler fixture of `test/scheduler/tier-yields-text.test.ts` (`catchUpRepo`, `catchUpSide`, `holdRuns`).

    npx vitest run --config docs/specifications/011-core/research/probes/issue-91/vitest.config.ts

Shape: four slow files (`test/s1..s4.test.ts`, 200 s known each) held in one Vitest tier after an edit; two files `f/f.test.ts`, `f/g.test.ts` queued behind it; both promoted for 60 s, as a named wait promotes them. Snapshots A to E read `standingsOf`, the text lines (`classLines`) and the `--json` entries (`fileEntry`). Full output: `research/probes/issue-91/observed.txt`.

## Findings

### F1. During the yield the two lines disagree (verified by experiment)

Snapshots B and C (after the promotion, before and after the held run saw its cancel):

    4 in the vitest tier of 4 test files running since 16:15:46: test/s1.test.ts, ...; no command runs them sooner (a running tier is not interrupted)
    2 queued, promoted, behind the vitest tier of 4 test files running since 16:15:46; the tier yields: f: f/f.test.ts, f: f/g.test.ts

The running files' line uses `NOT_INTERRUPTED` (`src/core/status/next-step.ts:57`) whatever the tier's yield standing. Only the queued line reads the `yields` row (`src/core/status/standing.ts:219-224`).

### F2. After the cut, the yield is gone from status (verified by experiment)

The runner recorded three runs: the slow tier `cancelled: true, completed: []`, then `f`+`g` (pass), then the slow tier again. Snapshot D, with the restarted tier in flight:

    4 in the vitest tier of 4 test files running since 16:15:46: test/s1.test.ts, ...; no command runs them sooner (a running tier is not interrupted)
    yieldsRow: {}

The first tier's `since` was `1792851346011`; the restarted tier's is `1792851346084`. Both print as `16:15:46`. The probe's restart came within the same second, so the text cannot tell the two tiers apart; in the incident the clock moved (13:07:59, then 13:10:46), and that change was the only trace. Source: `TierYields.ended` deletes the tier's standing when its run ends (`yields.ts`, `ended`), and `#publish` deletes the row when no tier is in flight.

### F3. The `cut` reason appears only when another promotion arrives (verified by experiment)

Snapshot E, after `f` and `g` were re-keyed and promoted again behind the restarted tier:

    2 queued, promoted, behind the vitest tier of 4 test files running since 16:15:46; the tier does not yield: it holds a file a yield already cut at its key: f: f/f.test.ts, f: f/g.test.ts; no command runs them sooner (a running tier that does not yield is waited for)

This is the incident's wording. It names no file, no cut time and no lost time. `#decide` returns `{ kind: "cut" }` when any unfinished file of the tier has a cut mark at its key (`yields.ts:202-203`); the mark is set only on a `yield` decision (`yields.ts:141-144`) and is in memory only, so a daemon restart forgets it (read in source code).

### F4. No progress field (read in source code, verified by experiment)

`PendingReason` `running` is `{ kind, lane, since, files }` in every snapshot. `Tier.ended` (row 011-54) knows which modules ended, but status does not read it.

### F5. The incident's JSON snapshot had no yield standing (read in the issue; inferred)

The issue's `status --json` entries for all six files say `next: "no command runs it sooner (a running tier is not interrupted)"` and carry no `; the tier ...` suffix, while the text wait before it carried the `cut` suffix. `NOT_INTERRUPTED` is the wording for a queued file with no published yield (test `tier-yields-text.test.ts`, last case). So at 11:17:17 UTC the daemon had no yield standing for that tier. Possible causes in source: the tier's standing is deleted when `#decide` returns `recheck` or `null` (`yields.ts:148-152`), for instance when no promoted file waits; or the promotion ended with the previous wait. Not determined which.

## Unproved runtime causes

These the issue raises and this triage does not prove:

- Why the yield cut the 13:07:59 tier. The first wait's line had no `; the tier ...` suffix, so the tier was not then found to yield for the promoted files. The yield may have been the 30 s overrun rule (C4 step 5, row 011-107) or another work item (an edit's work, a runner part). Not determined.
- Why the restarted tier ran the four cut files before the two promoted files. In the probe the promoted files ran first. One inferred path: a named wait's promotion lasts its 60 s wait; if it lapsed before the next selection, the cut files, which keep their class when re-queued, would be selected first. Not verified.
- How much of the minutes waited were rerun work versus the tests' own runtime. The cut run's start (13:07:59) and the restart (13:10:46) bound the discarded time at about 2 min 47 s, but the cut moment is not in the issue.

## Recommendation for Squeal

Treat issue 91 as a visibility defect with four reproduced parts (F1 to F4), not as a scheduling defect. A fix would publish, per worktree, the last yield: its time, cause, cut files and the discarded run time, and show it on the running files' line of a named wait until the restarted tier ends. Read the yield standing on the running line too, so the two lines agree (F1). Show ended files of a running tier (F4). The scheduling questions under "Unproved runtime causes" need a run with the daemon log of a real incident before a row.

## Open questions

1. Should the last yield survive a daemon restart, given that cut marks do not?
2. Should `--json` gain a field (additive, no `schemaVersion` raise, as 011-51 did for `yields`), or text only?

## Sources

- Issue: `gh issue view 91 -R hearsay-tools/squeal`, read 2026-10-24.
- Spec 011 C4 step 5, C6, C15; `status.md` entries of 2026-10-21 (001-381, 011-51), 2026-10-22 (011-107, 011-112), 2026-10-24 (011-169).
- Source at `9b48fa424`: `src/core/scheduler/yields.ts`, `src/core/status/next-step.ts`, `src/core/status/standing.ts`, `src/core/types/standing.ts`, `src/cli/named-file-lines.ts`.
- Lead test: `test/scheduler/tier-yields-ended.test.ts`; fixture source: `test/scheduler/tier-yields-text.test.ts`.
- Probe: `research/probes/issue-91/` (`yield-visibility.probe.ts`, `observed.txt`, `output.txt`).
