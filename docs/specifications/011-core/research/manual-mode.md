# Manual mode under overload: a replay on recorded history

Researcher task 3440e6d5, 2026-11-07, for the shape the human chose in task 7d611fc4. Data: the stores of squeal, cezar and toolkit-dev with their runs' `report.json` files, copied 2026-11-07 21:45Z (61,479 runs; they reproduce `load-slowdown.md`'s exposure: 39.8% of Squeal's worker-hours above 16 busy, 39.4% before); sar `-u`, 2026-10-29 23:00Z to 2026-11-07 08:20Z; Claude Code and Codex transcripts of the same window. The stores hold fewer than 30 runs from 2026-10-29 23:00Z to 2026-10-31 20:00Z (no run at all from 2026-10-30 10:47Z for 27.4 h), so every switch figure covers **2026-10-31 20:00Z to 2026-11-07 08:20Z, 6.4 days**. Source read at `b509d603f`. This worktree's daemon was stopped (`squeal stop --until-start`) and its runs and transcript are out of every count. No test, build or load was started. Probes: `probes/manual-mode/` (README there).

**Verdict.** Manual mode as shaped, with the switch after two 60 s windows above 1.25, does **not** work: it switches **40 to 76 times a day**, with a median period of 3 to 6 min. A session that is active 4 h or more in a day sees a mean of 8 to 10 message pairs that day, p95 24 to 31. Stronger resume hysteresis does not fix this: at 21 to 41 switches a day, Squeal stays in manual mode 43 to 61% of the time and leaves 5 to 17 h of background work undone (starvation). The cause is the 60 s signal. 42% of the minutes with a signal read above 1.25, and the reading holds for long runs. Manual mode **works when it starts only after five windows in a row** above 1.25: with resume after two windows at or below 1.10 and a held ramp, it switches **11 to 12 times a day**. Periods have a median of 9 to 12 min, a p95 of 72 to 81 min and a maximum of 105 to 170 min. A long session sees a mean of 2.7 pairs a day (p95 10). It protects the machine as well as the stepped budget in `background-backoff.md`: host time above 20 busy vCPUs goes from 8.0% today to 2.1 to 2.2% (budget 2.8 to 2.9%). It delays more: 36 to 37% of background work starts 10 min or more late, and the **delay is p50 31 to 33 min, p95 197 to 202 min, at most 244 to 246 min**. For the budget, p95 is 109 to 115 min and the maximum is 180 to 184 min. Nothing is left at the end.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Switches | Two-window entry: 40–76 periods a day, median 3–6 min. Five-window entry, resume ≤ 1.10 after 2 windows, ramp +1 per window held above 1.10: 11–12 a day, length p50 9–12, p95 72–81, max 105–170 min; a long session sees 2.7 pairs a day (p95 10, max 15) | inferred (replay) from the verified signal; pairs per session from transcripts |
| 2 | Load | Host time above 16 / 18 / 20 busy: today 21.6 / 14.0 / 8.0%, budget 22.2 / 10.7 / 2.9%, recommended manual 20.7 / 7.7 / 2.1%. Background core time above 20: 13.9%, 4.1%, 2.3%. Other work's mean slowdown 1.325, 1.248, 1.236 | inferred (replay) |
| 3 | Delay | Recommended manual: 35.6% of background work starts ≥ 10 min late, p50 31, p95 199, max 246 min, 0 h left. Catch-up after a resume: p50 14, p95 69, max 92 min. 42 of 77 resumes return to manual before the waiting work is done | inferred (replay) |
| 4 | Edits | Recommended manual: 289 edited code files in manual periods (45 a day, lower bound). The agent asked about 60% first, the Stop check would run 20%, a resume comes first for 20%. About 25 failures (4 a day) would be found later: median 2.5–3 min, p95 12–18 min, max 28 min | verified by experiment (transcripts) on replayed periods; inferred (delays) |
| 5 | Design | Enter after 5 windows > 1.25; resume after 2 windows ≤ 1.10; ramp +1 permit a window, only in windows ≤ 1.10; one slot; Stop check promotes the turn's unchecked edits outside the background budget; two short messages (below) | inferred |

## Method

`manual.py` reuses `background-backoff/replay.py`'s fluid model on 60 s steps. Background work (backlog and restart baselines, 464 core-hours) arrives as recorded and waits first in, first out. Other load and foreground work (edit tiers, `run --all`) stay as recorded. The slowdown curve converts cores into work done. In manual mode the background gets one slot, 2 cores. In automatic mode it drains the waiting work up to the pool (12 permits × 0.7 cores) and the curve's throughput peak. After a resume it drains up to the ramp. Each step reads `S(busy) × e`. Here `e` is the **measured** 60 s residual of that minute where the minute has 5 records (56% of minutes). The measured signal persists: P(above 1.25 next minute | above now) = 0.75 against P(above) = 0.42 (`signal60.py`, `verified by experiment`). Other minutes draw `e` as `replay.py` does. A step with under 0.3 Squeal cores running has no records and moves no counter. With no manual period the model gives back today's figures exactly (background above 18 / 20: 23.4 / 13.9%). Seeds 2 and 3, fully random noise (`NOISE=draw`), a 16-core pool (`AUTO_CAP=16`) and a 1-core slot (`REPLAY_MIN=1`) were also run. `sessions.py` and `q4.py` place each agent session's code edits, asks (`squeal status --wait`, `squeal run`), Stop hooks and SQUEAL failure messages against the replayed periods (997 working sessions, 187 with code edits).

## Findings

**1. Switches, load and delay by rule.** `inferred` (replay, seed 1; seeds 2–3 within ±1.5 switches a day and ±0.4 points). Ramp "1h" = +1 core a window, only in windows at or below the resume threshold. "Pairs" = message pairs per day for a session active ≥ 4 h that day (123 such session-days), mean / p95.

| Entry | Resume | Ramp | Periods a day | Manual time | Length p50 / p95 / max (min) | Pairs | Host > 20 | Bg > 20 | Others' slowdown | Late ≥ 10 min | Delay p50 / p95 / max | Left |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| today | — | — | — | — | — | — | 8.0% | 13.9% | 1.325 | 0 | — | 0 |
| stepped budget θ 1.25 | — | — | — | — | — | — | 2.9% | 4.1% | 1.248 | 29.0% | 2 / 110 / 180 | 0.04 h |
| 2 windows | 1.25 × 2 | none | 73.8 | 27.5% | 3 / 18 / 86 | 10.2 / 31 | 4.9% | 10.3% | 1.283 | 34.6% | 21 / 165 / 223 | 0 |
| 2 windows | 1.15 × 2 | 1h | 48.7 | 28.9% | 4 / 26 / 106 | 7.8 / 24 | 2.0% | 2.3% | 1.229 | 58.1% | 43 / 245 / 271 | 4.9 h |
| 2 windows | 1.10 × 5 | 1h | 21.7 | 60.7% | 24 / 154 / 269 | 4.8 / 14 | 1.8% | 1.7% | 1.214 | 80.1% | 160 / 407 / 441 | 16.5 h |
| 5 windows | 1.25 × 2 | 1h | 18.3 | 11.7% | 5 / 27 / 87 | 3.8 / 14 | 2.7% | 3.7% | 1.247 | 29.1% | 21 / 164 / 189 | 0 |
| 5 windows | 1.15 × 2 | 1h | 15.6 | 14.5% | 7 / 46 / 106 | 3.3 / 12 | 2.3% | 2.8% | 1.239 | 32.7% | 25 / 185 / 230 | 0 |
| **5 windows** | **1.10 × 2** | **1h** | **12.0** | 16.9% | 9 / 72 / 170 | 2.7 / 10 | 2.1% | 2.3% | 1.236 | 35.6% | 31 / 199 / 246 | 0 |
| 5 windows | 1.10 × 2 | none | 15.0 | 19.4% | 8 / 72 / 175 | — | 3.9% | 7.6% | 1.260 | 31.3% | 26 / 190 / 231 | 0 |
| 5 windows | 1.25 × 5 | 1h | 9.7 | 20.1% | 13 / 118 / 171 | 2.7 / 8 | 2.2% | 2.7% | 1.237 | 35.9% | 34 / 203 / 249 | 0 |

- **The two-window entry fails on noise, not on load.** Even run on the signal as recorded, with no feedback, two windows above 1.25 start 29.8 periods a day (`signal60.py`, `verified by experiment`). Five windows start 10.6. With feedback, a resume releases waiting work and the load rises. So 27 to 71% of a two-window rule's resumes end in a new period within 10 min; for the recommended rule, 14%.
- **The held ramp matters most for load.** The five-window rule at 1.10 × 2 with no ramp has 3.9% host time above 20 busy and 46 quick flip-backs. With the held ramp the figures are 2.1% and 11. A ramp of +2 or +1 cores a window that does not hold lies between them (`grid-s1`).
- **Hysteresis trades switches for starvation.** One slot cannot keep up with the background work that arrives while the host is busy. At 4.9 to 16.5 h left over 6.4 days, waiting work would pile up without end. Every five-window rule finishes with 0 h left.
- **Robustness.** For the recommended rule, seeds 1–3 give 10.9–12.0 periods a day and a p95 delay of 197–202 min. Random noise gives 9.7 a day, and a 16-core pool 12.9. A slot of 1 core instead of 2 lengthens the delay to p95 269 min. If the slot alone needs two minutes per reading (`SLOT_EVERY=2`, finding 4), the rule gives 11.1 a day, p95 period 109 min and p95 delay 204 min.

**2. Load against today and the stepped budget.** `inferred`. The recommended rule cuts host time above 20 busy from 8.0% to 2.1% (budget 2.9%) and above 18 from 14.0% to 7.7% (budget 10.7%). It cuts background core time above 20 from 13.9% to 2.3% (budget 4.1%). Above 16 the figures stay near 21%, because other load alone is above 16 busy for 7.8% of the time (`background-backoff.md`). Other work's mean slowdown falls from 1.325 to 1.236: other work takes 6.7% less time. The budget gives 1.248. The two policies protect the machine about equally. Manual mode protects slightly more because a period holds the background at one slot, where the budget steps back up one permit a minute.

**3. Delay and catch-up.** `inferred`. Under the recommended rule, 35.6% of background work starts 10 min or more late, against 29.0% under the budget. The p95 delay is 199 min against 110, and the maximum 246 against 180 min. That is 1.8 times the budget's p95: one slot drains less work than a budget that falls only to its floor when the signal stays high. After a resume the waiting work takes p50 14, p95 69 and at most 92 min to drain. 42 of 77 resumes return to manual before it is done. Only 11 of them do so within 10 min. Waiting work at a resume is p50 50, p95 659 isolated core-minutes.

**4. Edits and failures during manual periods.** `verified by experiment` for the counts, on the replayed periods; `inferred` for the delays. Transcripts show 1,006 code edits by edit tools and `apply_patch` (shell edits are not visible, so these are lower bounds) and 233 SQUEAL failure messages. A file edited in a turn counts once.

| Rule | Edited files in manual | Asked by the agent first | Stop check first | Resume first | Edit → Stop, p50 / p95 | Failures found later (seen / estimated) | Their delay p50 / p95 / max |
|---|---|---|---|---|---|---|---|
| 2 windows, 1.15 × 2, 1h | 369 | 44% | 20% | 36% | 6.2 / 30.5 min | 10 / 39 | 2.5–3.3 / 11–17 / 28 min |
| **5 windows, 1.10 × 2, 1h** | 289 | 60% | 20% | 20% | 6.6 / 31.0 min | 7 / 18 | 2.5–3.2 / 12–18 / 28 min |
| 5 windows, 1.25 × 5, 1h | 344 | 57% | 32% | 11% | 8.1 / 30.6 min | 8 / 21 | 2.5–2.8 / 12–16 / 28 min |

- An "ask" covers a file when it names no path, has `--all`, or names the file or a folder above it. Loosely, with any ask counted, the agent asked first for 78% (224 of 289).
- Only 37 of 237 failure messages follow an edit the transcripts show. For the other 200, the run is placed at the measured median lag of 80 s before the message (the "estimated" column). Today a failure arrives a median 80 s after its edit. In manual mode it arrives when the agent asks, at Stop or at resume, plus the same run time. For a file reached by a resume, the figure is a lower bound, because waiting work restarts through the ramp.
- One slot gives a median of 3.2 file records a minute (files of 100 ms or more, n 14,719 runs). A 60 s window needs 5. So in manual mode, with no asked runs, a resume reading takes about two minutes. `SLOT_EVERY=2` models this (finding 1).
- If no record arrives, no reading is possible. In the full window, one seed stayed in manual mode for 27.7 h over the 2026-10-30 gap, where the stores hold no run.

## Recommendation for Squeal (proposals only)

All numbers are ratios, window counts or permits. None depends on this machine's core count.

1. **Switch to manual** after **5 windows of 60 s in a row** with the pooled median file ratio above **1.25** (`background-backoff.md`'s signal: each file against its own 25th-percentile duration over 7 days, at least 5 earlier records). Two windows are not enough (finding 1).
2. **Resume** after **2 windows in a row at or below 1.10**. A window needs at least 5 records. In manual mode, a window with only the slot running is extended until it holds 5 records. A window with no records and no waiting work counts as at or below 1.10: nothing waits, and nothing needs protection. Without that rule, a quiet machine never resumes.
3. **Ramp:** after a resume, the background starts at the one slot. It gains **one permit per 60 s window, only in windows at or below 1.10**, up to `hostSlots`. A window above 1.25 during the ramp counts toward the five-window entry as usual.
4. **One slot** (one permit, host-wide) for the longest-waiting file during manual mode, as shaped.
5. **Asked work and the Stop check run outside the background budget**, like edit tiers and named waits today (rows 011-98, 011-308, 011-309). The Stop check: at a main agent's Stop in manual mode, take the code files the session edited this turn that have no current result. Promote them with their edit cut (namesakes and the shortest direct importers, as an edit tier would) and wait as the existing waiting Stop entry does (`stop-slow.ts`, bounded by `stop.slowWaitMs`). Hold the turn for their failures. A file reaches Stop a median 7 min after its edit (p95 31 min). The Stop check is the first reader for about 20 to 32% of the edited files.
6. **Messages**, once per session per switch, plain:
   - Start: `SQUEAL · manual mode: this machine is overloaded (test files run 25% or more slower than usual). Squeal starts no test on its own until load is fine. It still answers \`squeal status --wait <path>\` and \`squeal run\`, and at the end of your turn it runs the files you edited.`
   - Resume: `SQUEAL · automatic again: load is fine. Squeal runs the tests that waited, a few at a time, and checks your edits as before.`
7. **Measure after it ships** (daemon log per switch: time, signal, records, waiting work): switches a day (predicted 11–12 here), manual time (17%), period p95 (72–81 min), host time above 20 busy (8.0% → about 2%), the p95 delay of background work (about 200 min), and resumes that return within 10 min (about 2 a day).

**Against the stepped budget.** Both protect the machine about equally. Manual mode adds about 12 switch messages a day, a hold at Stop and a p95 delay 1.8 times longer. In return, the agent gets a state it can read and choose. Which matters more is a product decision.

## Open questions

- Not determined: a session's own choice of manual mode. Transcripts hold no such choice, so there is nothing to replay.
- Not determined: whether +1 permit a window fits larger machines. The ramp takes `hostSlots` minutes to reach the ceiling: 63 min on a 64-thread host. A ramp proportional to `hostSlots` was not replayed.
- Not determined: the test work the Stop check saves or adds. In manual mode, one run per turn replaces one edit tier per revision. The stores keep no tier kind or cancel per run (`wait-timeouts.md`), so the saving cannot be counted.
- Not determined: the replay holds other load fixed and drops no waiting work that a later revision makes stale. Both effects favour manual mode and the budget alike.
- The slowdown curve, the pool size (12 permits × 0.7 cores) and the 2-core slot are this host's. The rules above do not depend on them, but the predicted figures do.

## Sources

- Stores and run reports: `~/projects/{squeal,cezar,toolkit-dev}/.git/squeal/` (`store.sqlite` with `-wal`/`-shm`, `runs/*/report.json`), copied 2026-11-07 21:45Z, read with `node:sqlite` read-only via `probes/load-slowdown/extract-runs.mjs`.
- sar: `/var/log/sysstat/sa29`–`sa07`, `sadf -d -U … -- -u`, cut at 08:20Z.
- Transcripts: `~/.claude/projects/*/*.jsonl` with `*/subagents/*.jsonl`, `~/.codex/sessions/2026/*/*/*.jsonl`, 2026-10-29 23:00Z to 2026-11-07 08:20Z; paths and times only.
- Source at `b509d603f`: `src/harness/shared/stop-slow.ts`, `stop.ts`, `stop-decide.ts` (the Stop entries and the waiting entry).
- Earlier results: `background-backoff.md` (signal, stepped budget, `replay.py`), `load-slowdown.md` (curve), `wait-timeouts.md` and `host-load/011-181.md` (transcript methods).
