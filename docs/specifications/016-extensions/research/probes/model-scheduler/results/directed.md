# Directed replays (016-18), run 2026-10-25 with `run.sh ... EVENTS='<json>' DEBUG=1`

Each line: commit, events, outcome. `KIND=vitest SLOW_MS=200000` unless named.

- F, the dropped promotion. HEAD `2f9328ff6`, events `step 1000; promote [s4] 120000; promote [P] 60000; step 35000; promote [q] 3000`, 3 of 3 runs: after the tier yields to P, the `promotions:` row holds only P's promotion while s4 is queued (`queued=4`) and its wait is open.
- The first B find, before B read the daemon's promotions: `promote [s4] 120000; promote [P] 60000; step 35000; promote [s3] 3000` fails B 3 of 3 at `5ecb377a8`, `69d6328bf` and HEAD. The trace on HEAD shows s4's promotion gone after the second promote: the same mechanism as F.
- A at seed 60 (HEAD, `KIND=mixed`): `promote [s4, P] 120000; cross 1 read +60000; promote [s2, s3] 120000` on a 20 s tier: the tier yields at the second promote and cuts s4 (`head-trace.json`).
- A at seeds 33 and 51 (HEAD): the promoted s2 had ended inside the tier and was queued again (forced, `queued=6`); the probe's `queuedNow` does not count a file still in a run, so these are oracle false positives.
- R427 by hand, `KIND=node SLOW_MS=20000 INV=D,E`: `finish; finish; runAll force; step 1000; edit src/s.ts; finish slot 0 crash`. `dae700644`: fails D ("s1 runs at its key and its row is not pending"; every key row's pending is null while the edit's run of s1 to s4 is in flight). `bc8ed7742`: passes, the rows read `running`.
