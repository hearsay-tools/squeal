# 011-195 notes: a model-based test of the scheduler in the suite

Worker W2 of wave 37, 2026-10-25. Base `7fbbfd54` (main after 0.1.307). Commits `ddf8a9801`, `ea1496ab2`, `2f31ae86e` and the seed cut with these notes.

## What the suite has now

Three files under `test/scheduler/`, a port of 016-18's probe (`016-extensions/research/probes/model-scheduler/model.probe.ts`):

| File | Lines | What |
|---|---|---|
| `model-clock.ts` | 145 | The still clock (`ModelClock`), its timers, and `watchWork`, the settle's view of the scheduler's work in flight. Imported by the fixture only (coordinator, option b). |
| `model-fixture.ts` | 395 | The generator (`plan`, the probe's; `backlogPlan`, recommendation 3), the fake runner (`Model.#run`), and `Model`: one sequence over `catchUpRepo` and `catchUpSide`. |
| `model-scheduler.test.ts` | 356 | The oracle (`Checks`: A to F), shrinking, the directed sequences, the sweeps, the seed list, one `it` per group. |

The fixture is over the styleguide's ~300 lines (the generator is about 90 of them); a fourth file for the plans would bring it under; not asked for.

Each sequence is played once with every invariant checked, and it stops at the first violation. The first group's case plays them all (`playAll`, memoized); each case then reads its own letter's violations and shrinks each failing sequence (greedy, at most 30 deletions) into its message. Sequences: 4 directed, seeds 1 to 24 and 60 of the probe's mixed generator, 6 backlog seeds, and 2 sweeps of 7 and 8 variants on main.

## How the done-when was shown

Each old tree is `git archive <commit>` into the scratch folder, with `node_modules` linked to this worktree's and the three files copied in; no git worktree was made. Command in each: `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/scheduler/model-scheduler.test.ts`. The first two rows ran the committed files, after the seed cut, at about 09:58Z; the other three ran the files before the cut (mixed seeds 1 to 32 and 60, backlog seeds 1 to 8), with the same directed sequences and sweeps, at about 09:40Z.

| Commit | Groups failing | Sequences that fail (first violation) |
|---|---|---|
| `squeal--v0.1.300` | A, F | A: seed 60 (event 3), seed 60's shape with a jump at readings 4 to 6. F: F's reproduction (event 3), seeds 8 and 23. |
| `5ecb377a8` (R398 pre-fix) | A, B, F | B: R398's shortest (event 4: "tier stands named, but s3 and P rank before every unended file ()"), the deadline sweep at readings 5 to 11. A as on 0.1.300 (readings 4 to 7); F as on 0.1.300 and seed 15. |
| `69d6328bf` (R398 fix) | A, B, F | B: the deadline sweep at readings 5 to 10 only; R398's shortest and seed 31 pass. |
| `231ecaeb0` (R397 pre-fix) | A, B, F | B: the deadline sweep at readings 5 to 10. |
| `b862d2f2d` (R397 fix) | A, F | B passes. |
| main `7fbbfd54` + this row | none | 6 of 6 pass, 23 runs (below). |

So: on `squeal--v0.1.300` the file fails F's reproduction and seed 60; main has 011-194 and 011-196 (which replaced 011-193), and the file passes on it. R398's shortest fails on `5ecb377a8` and passes on its fix. F's reproduction alone, played 10 times on `squeal--v0.1.300`, dropped s4's promotion 10 of 10 times.

The seed cut (coordinator, 2026-10-25, option a) dropped mixed seeds 25 to 32 and backlog seeds 7 and 8. Of them, only seed 31 failed anywhere: B on `5ecb377a8` ("tier stands named, but s4 and Q rank before every unended file (P)"), R398's class, which R398's shortest still carries.

The deadline sweep found R397 (review 0.1.296-r2 B2), which the probe did not find in 173 sequences (016-18 finding 3): a jump of 30 s at the 5th to 10th reading of P's promotion passes s1's deadline after the decision ranked s1, and the tier stands `named` while P ranks first. This is recommendation 3 at work. 016-18 open question 2 (R399, R345 with a larger budget) is still open.

## Seed 173 (016-18 open question 1): an oracle error, no row

Traced on main under `KIND=vitest` with the shortest sequence the shrink gives: `cross 1 60000; edit src/q.ts; edit src/q.ts; step 35000; step 35000; promote [s2, s4] 120000`.

1. The jump comes inside the first edit's decision: the slow tier has run 60 s past its 20 s estimate, so it yields to Q, the edit's work.
2. Q and P run in one tier from 60 s, Q at key `b5ab62`. The second edit moves Q's row to `73b316` while that run is in flight; P's input is unchanged, so the tier is not superseded.
3. At 95 s the tier yields (30 s past its estimate). The probe's C keyed the cut by the row's key at the cut, `73b316`. The run was at `b5ab62`.
4. Q runs alone at `73b316` from 95 s and is cut at 130 s: the first cut at that key.

C4 step 5: a file that a yield cut "is marked until its result lands or its key moves", so the second cut is what the spec says. Fix to the oracle: C keys a cut by the key the run started at (`Flight.startKeys`, read from the key rows as the runner is called). Seed 173 passes on main with the fix, and is a directed sequence of group C.

## The other oracle fixes against the probe

- **F after a promotion's end.** The probe's F flagged seed 13 and two others on main: `edit src/s.ts; promote s4 120 s; finish; edit src/s.ts`. The finish made s4 current, so none of the wait's files was queued or running and the promotion ended (C15 Lifetime, "whichever comes first"); the second edit queued s4 again, and a new queueing does not bring a promotion back. Fix: a wait closes at the first quiet point where none of its files is queued or running.
- **A, seeds 33 and 51 of the probe** (016-18 finding 2, the fifth oracle error): `queued` counted no file that a live run still listed, though it had ended inside that run and was queued again. `Model.running` excludes a file the run ended, so such a file counts as queued.
- **A cut judged at 31 s, as the probe**: the clock no longer drifts, but the tier's start reading and the runner's call can still differ by a jump.

## Recommendation 4: the settle

The probe waited until nothing it read changed for three polls 15 ms apart. The test waits until no work of the scheduler is in flight or has begun for 4 ms (`watchWork`, polls of 1 ms). Work in flight is a call's promise, from the call to its settling, of:

- `Mutex.prototype.run`: every decision, record commit, selection and runner part is a lock task;
- `TierRecords.prototype.record`: a run's record from its end, outside the lock first (the stability check hashes inputs, the install stamp, a slot's gathering), then its lock task;
- `InstallStamps.prototype.check` and `MergeHold.prototype.check`: the pump's awaits before it selects a tier.

Each is replaced on the prototype for one sequence and put back at its close. With the first version (the lock and `SlotRecords.record` only, 10 ms), F's reproduction once passed on `squeal--v0.1.300` at a load of 29: the settle ended while the cut run's record hashed outside the lock, so F was read before the record dropped the promotion. The store signature went with the change: the store is written only inside lock tasks.

What the settle still does not see: a record's `reconcilePaths` for paths that moved during the run, and the pump's quiet rechecks, which sleep on the host's clock (`node:timers/promises`, up to `QUIET_RECHECK_MS`). A `step` therefore calls `requestRetries`, which takes no request here and wakes the pump, as its next recheck each second would. A settle that ends early only lets the next event come before the pump starts a tier: a legal order, so on main it can change which order a seed plays, never make a correct scheduler fail.

## Other choices the probe did not make

- **The clock stands still.** `ModelClock` reads the host's clock once, at the scheduler's first reading (after the daemon registered, so published rows are not older than it), and moves only on `step` and `cross`. No deadline passes on the host's clock between events, so the probe's 200 ms leniency is gone. Its timers fire at their delay on the host's clock, or as soon as the model's clock passes their deadline.
- **A jump stays armed until the settle ends**, not only during the event's own call, so a `cross` before an `end` or a `step` reaches the decision the end or the timer sets off. Seed 60 of the generator is `cross 4 60000` (`results/directed.md` says "cross 1 read"); it fails A at the same event as in the probe.
- **The sweep** plays a base sequence with `cross(k, ms)` before its last event for k = 0, 1, 2 ... until the jump does not come (the reading is past the event's last). It counts every reading of the event and what it sets off, not one `TierYields.check` (011-194's `nextCheck` frames one check; not used).
- **`catchUpSide`, not a bare scheduler**: a pool of 8 host slots, `host: null`, as `tier-yields-named.test.ts`. The probe passed no `capacity`.
- **Errors**: `catchUpSide` passes no `onError`, so the test reads the worktree's notes and counts each that holds `Error: ` (a background error's note carries `String(error)`) as an `err` violation, in group E's case.

## Run time and stability

About 0.3 s a sequence: 0.27 s of it is the start (the repository, `git` four times, the baseline). The file's CPU is about 16 s (user and system together), so its wall time follows the host's load.

20 runs in a row on main, before the seed cut, 2026-10-25 from 09:46Z, each `env -u PLUGIN_ROOT -u PLUGIN_DATA npx vitest run test/scheduler/model-scheduler.test.ts`. Load is the one-minute load average on 24 CPUs before and after the run. Runs 1 to 3 ran beside 16 busy loops I started (09:46:19Z to 09:47Z, when the coordinator stopped them: load made on purpose, which this host must not get); runs 4 to 20 ran at the host's own load, the first ones still with the loops' load in the average.

| Run | Exit | Wall (s) | Load before → after | |
|---|---|---|---|---|
| 1 | 0, 6 passed | 19.70 | 4.83 → 11.43 | beside the loops |
| 2 | 0, 6 passed | 23.74 | 11.43 → 17.33 | beside the loops |
| 3 | 0, 6 passed | 25.83 | 17.33 → 22.83 | beside the loops |
| 4 | 0, 6 passed | 29.86 | 22.83 → 27.50 | |
| 5 | 0, 6 passed | 27.64 | 27.50 → 27.08 | |
| 6 | 0, 6 passed | 19.51 | 27.08 → 25.75 | |
| 7 | 0, 6 passed | 18.29 | 25.75 → 22.31 | |
| 8 | 0, 6 passed | 19.32 | 22.31 → 20.09 | |
| 9 | 0, 6 passed | 20.09 | 20.09 → 18.43 | |
| 10 | 0, 6 passed | 23.05 | 18.43 → 22.33 | |
| 11 | 0, 6 passed | 33.68 | 22.33 → 36.23 | |
| 12 | 0, 6 passed | 33.29 | 36.23 → 44.78 | |
| 13 | 0, 6 passed | 30.70 | 44.78 → 42.50 | |
| 14 | 0, 6 passed | 27.88 | 42.50 → 39.64 | |
| 15 | 0, 6 passed | 27.85 | 39.64 → 37.54 | |
| 16 | 0, 6 passed | 30.62 | 37.54 → 42.09 | |
| 17 | 0, 6 passed | 32.02 | 42.09 → 40.84 | |
| 18 | 0, 6 passed | 34.47 | 40.84 → 45.08 | |
| 19 | 0, 6 passed | 26.49 | 45.08 → 39.27 | |
| 20 | 0, 6 passed | 30.98 | 39.27 → 40.20 | |

20 of 20 passed; 17 of them, runs 4 to 20, at the host's own load of 18 to 45. Seven of those 17 took 30.6 to 34.5 s, all at loads of 36 to 45, so the seed count was cut by about 17% (mixed 33 to 25, backlog 8 to 6).

After the cut, 3 runs at the host's own load, about 09:56Z:

| Run | Exit | Wall (s) | Load before → after |
|---|---|---|---|
| 1 | 0, 6 passed | 33.41 | 50.39 → 59.02 |
| 2 | 0, 6 passed | 27.67 | 59.02 → 54.77 |
| 3 | 0, 6 passed | 26.73 | 54.77 → 57.47 |

Run 1 started while Squeal's daemon was still running the same file after the cut (its status read "1 running"). Runs 2 and 3 are under 30 s at loads of 55 to 59. Not measured: 20 runs after the cut; the cut file is a subset of the sequences of the 20 runs above.

## For the next worker

- A new invariant is a method of `Checks` called from `steady` (at each quiet point), `#cut` (inside a cancel's decision) or `released` (after the drain), and a letter its group's case reads. The seven of 016-18 finding 1 are later rows, one at a time.
- A second worktree and a restart are the next model additions (016-18 finding 4): a second `catchUpSide` on `repo.other`, and a `close` and a new side on the same store.
- Shrinking runs only when a case fails, at about 0.3 s a try; a failing file takes 35 to 60 s.
- Do not run the probe's `run.sh` or `replay.sh`: the old trees here were plain `git archive` exports in the task's scratch folder.
