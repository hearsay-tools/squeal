# 021-36: how often a clone-wide writer role would move

Question: if one daemon per clone held the writer role until it exited, and the oldest other live daemon then took it, how often would the role move, how long would a holder keep it, and how often would the clone have no live daemon at all (a store process with an exit grace would bridge the short gaps).

Window: 2026-11-14T20:00Z to the latest log line, 2026-11-19T15:05Z (4.80 days). Probe: `probes/role-moves.py` (read-only; log parsing from `021-34/probes/restarts.py`).

## Results

| | squeal | cezar |
|---|---|---|
| Serving daemon lives (worktrees) | 1,672 (283) | 1,134 (594) |
| Role moves | 231 (48/day) | 178 (37/day) |
| Handovers (other daemons live, writes in flight move) | 155 (32/day) | 125 (26/day) |
| Moves into an empty clone (no handover) | 76 (16/day) | 53 (11/day) |
| Holder tenure p50 / p90 / max | 15 min / 52 min / 3.7 h | 17 min / 81 min / 5.1 h |
| Empty-clone gaps (no live daemon) | 76 | 52 |
| of them under 3 / 5 / 10 min | 53 / 55 / 57 | 16 / 22 / 27 |
| 10 min or longer | 19 | 25 |
| Gap p50 / p90 | 0.8 min / 52 min | 9.2 min / 86 min |

A store process that exits 5 minutes after its last client would have exited 21 times in squeal (4.4/day) and 30 times in cezar (6.3/day); with 10 minutes, 19 and 25.

Per UTC day (first and last days are partial: 4 h and 15 h):

| Day | squeal handover | squeal into empty | cezar handover | cezar into empty |
|---|---|---|---|---|
| 11-14 | 6 | 10 | 3 | 2 |
| 11-15 | 19 | 27 | 34 | 15 |
| 11-16 | 22 | 6 | 33 | 15 |
| 11-17 | 54 | 13 | 21 | 7 |
| 11-18 | 35 | 13 | 16 | 12 |
| 11-19 | 19 | 7 | 18 | 2 |

Reading: no daemon lives long. The holder keeps the role about a quarter of an hour at the median, so a handover with writes in flight happens 26 to 32 times a day per clone, and on the busiest day 54 times (about every 27 minutes). The handover path is a routine path, not a rare one. Squeal's empty gaps are mostly under 3 minutes (a worktree's daemon exiting and the next starting); cezar's are longer and a few-minute grace bridges only about half of them.

## Method

- A daemon life is one `serving ...` line to the last line of that (worktree log file, pid), across `.log` and `.log.1`; a second `serving` line under the same key starts a new life. Daemons that never served (gave up on the lock, another daemon serves) are not counted.
- Sweep over all life starts and ends in time order. At the window start the oldest live daemon holds the role (not counted as a move). When the holder ends: if others are live, the oldest of them takes it (handover); else the clone is empty until the next start (move into empty, and the gap length is recorded). Tenure is acquisition to the holder's end.
- Only "oldest takes it" was simulated. A different successor rule changes which daemon holds next, so counts under "any" would differ somewhat; handovers are bounded by holder exits either way.

## Caveats

- There is no periodic heartbeat line in the logs; an idle daemon can stay silent for long stretches. This matters little: 2,784 of 2,806 lives end with a `daemon stopped: ...` line, which is the real exit. 8 lives whose pid is still a running Squeal process at read time end at the window end. 14 (1 squeal, 13 cezar) end with no stop line and a dead pid: their end is taken as the last line, a lower bound. Rerunning with those ends pushed up to 30 minutes later (capped at the next start in that worktree; `role-moves.py next`) changes squeal not at all and cezar by one move.
- The squeal clone's main checkout daemon accounts for 980 of its serving lives (not checked: how many of the short empty gaps are its restarts).
- The window is under five days and covers this host's agent-heavy use; a user's clone with fewer worktrees would have fewer handovers and more empty gaps.
