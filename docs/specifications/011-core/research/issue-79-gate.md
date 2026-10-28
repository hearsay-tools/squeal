# Issue 79 and 121: what a large named gate costs, from tier size and from interruptions

Recommendation: take option B (a promoted tier sized by the backlog's wall budget). Do not take option C (protection kept after a wait ends) on its own. Take B+C only with a bound on how long a protected group may hold back a later file.

Researcher, row 011-208 as widened by gh-121, 2026-10-28. Worktree commit `2f49b3e92` (Squeal 0.1.374 source; no scheduler change since `issue-121.md`). Durations from cezar's live store at cezar `991c14b96`. Brief: `tasks/wave-57.md` R1.

## Questions answered

| # | Question | Answer (23 workers, agent repeats waits with 15 s between them) | Tag |
| --- | --- | --- | --- |
| 1 | Time to verdict for 56 named parity files today | 1,096 s when the same 56-file wait repeats. 1,367 s when the two globs alternate. 974 s with #79's guard wait. **638 s with no wait at all.** | verified by experiment |
| 2 | Where that time goes | Tier size. Promoted files run 4 at a time, each tier as long as its slowest file: 15 tiers, 1,117 s of tier maxima. The backlog runs 23 at a time. | verified by experiment; inferred sum |
| 3 | Discarded run time today | 24 to 602 file-seconds per gate (1 to 4 cuts). At 8 workers: 172 to 1,234. | verified by experiment |
| 4 | Option B: promoted tier sized by the wall budget | 343 / 632 / 413 s to verdict (same three plans). 0 to 697 file-seconds discarded. | verified by experiment, patched scheduler |
| 5 | Option C: protection kept after a wait ends | 1,096 / 1,232 / 974 s. Discards fall from 602 to 75 file-seconds in the alternating plan. No change in the other two. | verified by experiment, patched scheduler |
| 6 | Opposite case: a later file behind a protected group nobody waits for | Worst extra wait: today 126 s, B 30 s, C 171 s, B+C 193 s. | verified by experiment, patched scheduler |

## Method

Load before the first run: 14.46 on 24 CPUs. Each row of the result files records the one-minute load before and after its run. The loads were 12.83 to 29.77. `run.sh` checks for load at or below the CPU count only when it starts, so some rows started above 24. Model results do not depend on load. The same plan (today, whole, 23 workers) gave 1,096.456 s in three runs started at loads 17.63, 13.52 and 16.81. Load changes only the real run time of 22 to 54 s per simulation.

The probe is `probes/issue-79/gate.probe.ts`. It uses the real scheduler and store of `test/scheduler/catch-up-fixture.ts`, and the model clock and work tracker of `model-clock.ts` (row 011-195). A fake runner places each file on the earliest free worker, after a 1 s run overhead. A tier's width is its grant, and an edit's tier runs one worker per file (as `CatchUpRunner` does). The driver steps the clock at most 1 s at a time. It reports file ends through `fileEnded`, and completes or cancels runs.

Inputs come from `durations.json`, written by `extract.mjs` from cezar's store (read-only). Each file's duration is its median passing file-level duration since 2026-10-21. The 56 parity files total 3,874 s, longest 237.6 s. The backlog is 537 other Vitest files (seeded choice, #79's guard files included), 2,950 s in total. Policy is cezar's: `tierSize` 4, `timeoutMs` 900,000, so the wall budget is 120 s. `backlogTierSize` is 200. The pool has 23 slots (cezar's CPUs − 1), or 8 for a loaded host.

Start: baseline, then an edit of the root environment file, which queues all 593 files as the backlog. A backlog tier starts at t0. Agent plans:

- **whole:** wait 60 s on the 56 files, pause 15 s, repeat.
- **halves:** alternate the `core/` and `workflows/` globs. A selection then omits running files, as in #121 F2.
- **guard:** #79's later comment. The second wait names `file-length`, `stopped-composer` and `worker-destroy` (0.3, 1.9 and 69 s).
- **none:** no wait. This is the control.

Gap sensitivity used pauses of 0 and 45 s. The opposite case: the agent repeats the whole wait until T, then waits on the shortest queued non-parity file, with T from 60 to 600 s in 15 s steps.

Options B and C are patches inside the probe only:

- **B:** while `selectTier` runs, promoted-only work reads as "no first group". The order is cut to promoted files. The tier is then chosen as a backlog tier: budget, grant, no tier-sharing ratio, kind `backlog`.
- **C:** `RunQueue.rankAt` returns, for a running file, the least request order of any wait that ever promoted it, after that wait ends. The 30-second rule and the once-per-key guard are unchanged. No plan here moves a key, so "while keys are unchanged" holds by construction.

Commands, from the repository root:

    sh docs/specifications/011-core/research/probes/issue-79/run.sh matrix GATE_WORKERS=23,8
    sh docs/specifications/011-core/research/probes/issue-79/run.sh gap0 GATE_GAP_S=0
    sh docs/specifications/011-core/research/probes/issue-79/run.sh gap45 GATE_GAP_S=45
    sh docs/specifications/011-core/research/probes/issue-79/run.sh small GATE_AGENTS= GATE_SMALL_AT=60,75,...,600
    sh docs/specifications/011-core/research/probes/issue-79/run.sh none GATE_OPTIONS=today GATE_AGENTS=none GATE_WORKERS=23,8

Outcomes: `Tests 24 passed`, `12 passed`, `12 passed`, `148 passed`, `2 passed`. Each row is in `<name>.jsonl`, and each run's tier sequence is in `<name>-traces.jsonl`.

## Findings

**F1. Today, promotion makes a large gate slower, not faster (verified by experiment).** The figures below are time to verdict for the 56 files:

| Workers | No wait | Whole, pause 0 / 15 / 45 s | Halves, pause 15 s | Guard, pause 15 s |
| --- | --- | --- | --- | --- |
| 23 | 638 s | 1,174 / 1,096 / 726 s | 1,367 s | 974 s |
| 8 | 1,173 s | 1,289 s at pause 15 s | 1,666 s | 1,364 s |

The traces show why. A promoted file is an edit's work, so it runs in a tier of `runner.tierSize` (4), and the tier-sharing ratio holds that tier to comparable durations (C4 step 5, C15 Rank). Each tier lasts as long as its slowest file, and one tier runs per lane at a time. The last three promoted tiers at 23 workers take 150, 227 and 239 s in sequence, while 19 workers stand idle. Unpromoted, the same files run in backlog tiers of up to 23 at once. The longer the agent pauses between waits, the more parity work runs in backlog tiers, so the gate ends sooner. This answers #79's original report (38 to 40 of 41 files pending after 30 minutes): the cause is the tier size, not the queue order.

**F2. Interruptions cost less than tier size, but they are real (verified by experiment).** These are discarded file-seconds, from the cancelled runs' started work:

| Plan | Workers | Today | B | C | B+C |
| --- | --- | --- | --- | --- | --- |
| whole | 23 | 24 (2 cuts) | 0 | 24 (2) | 0 |
| halves | 23 | 602 (4) | 697 (1) | 75 (1) | 0 |
| guard | 23 | 24 (1) | 0 | 24 (1) | 0 |
| whole | 8 | 172 (3) | 0 | 172 (3) | 0 |
| halves | 8 | 1,234 (8) | 1,121 (4) | 232 (5) | 13 (1) |
| guard | 8 | 184 (3) | 328 (2) | 184 (3) | 0 |

Today's cuts have two shapes:

- In the 15 s pause, promotion lapses and a backlog tier starts with parity files in it. The next wait cuts it less than 30 s in. These are the "whole" cuts.
- After a wait ends, a wait naming other files cuts a promoted tier 47 to 75 s in. These are #121 F2's cuts in "halves".

C removes the second shape and not the first. Several first-shape cuts restart the cut parity files in the very next tier ahead of the waiting files (`uselessCuts` 1 to 3). This is #121 F3, which row 011-263 handles.

**F3. B cuts time to verdict by 54 to 69% at 23 workers and by 24 to 51% at 8 (verified by experiment, patched scheduler).**

| Workers | Plan | Today | B | B+C |
| --- | --- | --- | --- | --- |
| 23 | whole | 1,096 s | 343 s | 343 s |
| 23 | halves | 1,367 s | 632 s | 573 s |
| 23 | guard | 974 s | 413 s | 413 s |
| 8 | whole | 1,289 s | 631 s | 631 s |
| 8 | halves | 1,666 s | 1,265 s | 951 s |
| 8 | guard | 1,364 s | 948 s | 701 s |

At 23 workers B runs the gate in two tiers: 33 files in 89 s, then 22 files in 239 s. The floor is the longest file, 238 s. B also beats no wait (638 s, 1,173 s), so promotion helps again. The agent needed 5 waits instead of 15. The backlog finished sooner too: 658 s against 1,312 s. B's cost is its tier's width. A wide tier still runs after its wait ends, and a later wait for other files cuts it once it has run 30 s. In "halves" one such cut discarded 697 file-seconds, more than today's four cuts together.

**F4. C alone saves little; with B it removes B's cost (verified by experiment, patched scheduler).** Alone, C changes only "halves": 1,367 to 1,232 s and 602 to 75 file-seconds at 23 workers, and 1,666 to 1,439 s at 8. With B, discards fall to 0 to 13 file-seconds in every plan.

**F5. The opposite case: C makes a later file wait behind a group nobody waits for (verified by experiment, patched scheduler).** The victim waits on the shortest queued non-parity file at T. The victims are 3 to 125 s files: by each wait's start, the backlog tiers had taken every shorter file. "Extra" is the wait beyond the victim's own run and the 1 s overhead. It does not depend on the victim's duration, because the victim leads its own tier once the lane is free.

| Option | Start times with a queued victim | Worst extra wait (at T) | Mean extra wait | Most discarded meanwhile |
| --- | --- | --- | --- | --- |
| Today | 37 of 37 | 126 s (315) | 42 s | 495 file-s |
| B | 21 of 37 | 30 s (60) | 3 s | 1,075 file-s |
| C | 37 of 37 | 171 s (465) | 73 s | 24 file-s |
| B+C | 21 of 37 | 193 s (90) | 87 s | 43 file-s |

So a 2 s file waits at worst about 129 s today, 33 s under B, 174 s under C and 196 s under B+C (inferred: extra + 2 s + 1 s). Under B+C at T = 90 to 150 s, the 33-file tier holds the lane. Under B alone, that tier was cut at a cost of 977 file-seconds. Today's 126 s worst comes from rules that stay in force under every option: a tier holding a cut file does not yield, nor does one whose remainder is 30 s or less. Under B, every start time from 375 s found the backlog empty.

## Recommendation for Squeal

1. **Take B as a proposed row.** A tier made only of promoted files is sized as the backlog's: the wall budget at the grant, one file per granted worker first. It cuts time to verdict by 54 to 69% at 23 workers and by 24 to 51% at 8, and the backlog ends sooner too. It reuses `BacklogWall` and the pool. Questions for the spec:
   - Does such a tier take a grant and wait on the pool (the probe's B does), or run ungranted as an edit's tier?
   - Does an edit cancel it as it cancels a backlog tier?
   - Does it count toward the four first-group tiers before the backlog's turn? Under the probe's B it does not.
2. **Do not take C on its own.** Its gain is limited to selections that omit running files. It adds up to 171 s for an unrelated later file.
3. **B+C needs a bound.** With B the protected group is wide, so C's saving and its cost both grow. A bound such as "protect after the wait ends only while the tier's remainder is at most N s", or "only while no other wait is open", was not measured.
4. Row 011-263 (W1) is still needed. Cuts in a tier's first 30 s that restart the cut files ahead of the waiting ones remain under B and under C (`uselessCuts` in `matrix.jsonl`).

## Open questions

- Do cezar's parity files keep their medians when 22 to 33 of them run at once? They spawn processes. Medians come from mixed tiers, and contention at 33 is unmeasured. A real B tier may run longer. Inferred risk, not determined.
- Pool contention: B's tier takes a grant. Under load 44 to 77 (#79) the grant may be small; the 8-worker runs show B still gains 24 to 51%.
- The opposite case at 8 workers was not swept.
- B+C bounds (recommendation 3) were not measured.

## Sources

- Brief: `docs/specifications/011-core/tasks/wave-57.md` R1. Board rows 011-208, gh-79 and gh-121.
- Prior research: `research/issue-79.md`, `research/issue-91.md`, `research/issue-121.md` (F2, F3, F4).
- Spec 011 C4 step 5 (tiers, backlog wall budget, yields, 30 s rule), C10, C15 Rank and Lifetime.
- Issues: [#79](https://github.com/hearsay-tools/squeal/issues/79) with its [later comment](https://github.com/hearsay-tools/squeal/issues/79#issuecomment-6433715406), and [#121](https://github.com/hearsay-tools/squeal/issues/121). Read with `gh issue view` on 2026-10-28.
- Source at `2f49b3e92`:
  - `src/core/scheduler/tiers.ts` (`selectTier`)
  - `queue.ts` (`ordered`, `hasFirstGroup`, `rankAt`)
  - `promotions.ts`
  - `yields.ts` (`waitedFor`, `rankToBeat`, `byRemainder`)
  - `claims.ts` (`backlogSize`)
- Cezar: `~/projects/cezar/.git/squeal/store.sqlite` (`checks` kind `file`, `results`), `squeal.config.json`, `vitest.config.ts`, at `991c14b96`.
- Probe: `probes/issue-79/`: `gate.probe.ts`, `extract.mjs`, `durations.json`, `run.sh`, `vitest.config.ts`, and per run `<name>.jsonl`, `<name>-traces.jsonl`, `<name>-load.jsonl`, `<name>-output.txt`.
