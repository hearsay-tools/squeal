# 016-18 A model-based test of the scheduler

Brief: `model-scheduler-brief.md`. Researcher: Claude Opus 5.5, 2026-10-25. Examined: `docs/specifications/011-core/spec.md` C4, C5, C6 and C15 at `2f9328ff6` (line numbers below are of that file), `src/core/scheduler/yields.ts`, `promotions.ts` and `queue.ts` at `2f9328ff6`, `test/scheduler/helpers.ts`, `catch-up-fixture.ts` and `tier-yields-named.test.ts`, `core-defects.md`, and the review files of the blockers replayed. Probe: `probes/model-scheduler/` (scratch clone `/tmp/ms18/repo`, removed after).

## Questions answered

| # | Question | Answer in one line | Tag |
|---|---|---|---|
| 1 | Invariants | Six are checked from the store, the published `yields` and `promotions` rows and the runner's calls (A to F below), the three of row 011-184 among them; seven more are checkable and not yet written; C6's wait and C5's delivery need a consumer or the CLI. | read in official docs (011 spec at `2f9328ff6`); A to F verified by experiment |
| 2 | Model | Seven events (edit, promote, a file's end, a run's finish or crash, a clock step, a clock jump inside the next decision, `run --all` with or without `--force`) over the real scheduler and store; a fake runner that ends files and runs only on command; a virtual clock whose `setTimeout` timers fire when a step passes them; a quiet-store settle after each event. Restart and install are not modelled. | verified by experiment |
| 3 | Replay | Of five past blockers, the generator found 1 (R398, after 141 sequences, 4 events); R427 is reached by a hand-placed 6-event sequence but not in 300 random ones; R345, R397 and R399 were not found within 173 to 300 sequences. On HEAD it found two defects of its own (F in 36 of 300 sequences; A once, a race inside one decision). | verified by experiment |
| 4 | Shape | About 450 lines in two files over `test/scheduler/`; 0.9 s a sequence; one 1,000-sequence run took 925 s wall and 191 s CPU (scaled from 300) at a one-minute load of 16 to 18 on 24 CPUs; flake risk from the settle heuristic and from oracle readings at deadline boundaries. | verified by experiment; flake risk inferred |

## Findings

### 1. Invariants

Checked by the probe (`model.probe.ts`, `INV`):

| | Invariant | Spec line | Read from |
|---|---|---|---|
| A | 011-184 (a): once a tier has run 30 s, a promotion's yield cuts it only when a queued promoted file ranks before every file of the tier that has not ended; a file the same or an earlier open wait selected ranks first. Judged at the cut's own instant (the runner's abort listener runs inside the decision) and at the event's start reading. | C4 125 ("A promoted file makes a tier that has run 30 s or more yield only when…"); C15 376 (Rank) | abort reason, the daemon's `promotions:<worktree>` row, key rows |
| B | 011-184 (b): a published `named` standing is true at every quiet point: some file of the tier that has not ended ranks with or before every queued promoted file. A file's end and the protecting deadline must decide the tier again. | C4 125 ("The daemon checks the tier again at that bound with no other event"); C15 387 (`named` reason); `status.md` line 158 | `yields:<worktree>` row |
| C | 011-184 (c), first half, in its checkable form: a yield cuts a file at most once per key. The tier itself ends at its cut, so "a tier is cut at most once" holds by construction. The second half (protection while the wait is open) is A. | C4 125 ("yields, once per file and key"; "a tier holding a marked file does not yield") | abort reason, key rows at the cut |
| D | A check that was a current pass at key K does not turn `unknown` while K stays its key, except by a crash of a run at K; a file running at its current key reads `pending`. | C4 113 (current, pending); C4 142 (a crashed run's files) | known states, key rows, the runner's start keys |
| E | After every run is released and the scheduler is idle, every listed file is current, except files whose last run crashed at their key. | C4 142 ("An unkeyed or `unknown` file is always work to do"), 150 | known states |
| F | A promotion lasts until its deadline or until none of its files is queued or running. | C15 378 (Lifetime) | `promotions:<worktree>` row, key rows |

Checkable the same way, not written yet: promoted files first and the earlier request first (C4 124 last sentence, C15 376); four first-group tiers, then the second group's (C4 124); tier sharing within max(1 s, 4 × fastest) and a cut-past-estimate file never beside an uncut one (C4 131, 125); supersession once every unended file's input changed (C4 125, first rule); no result stored under a key whose input changed during the run (C4 150); one re-run per new failure, at most 8 per tier (C5 172); one tier per lane, two only for an edit beside a backlog tier (C4 136). Not checkable from these outputs: C6's `status --wait` window (needs the CLI's reads) and C5's delivery views (need a consumer); they would need the model to drive `createDelivery`.

### 2. Model

All verified by experiment at `2f9328ff6` and the replayed commits.

- **Fixture.** One worktree, real `createScheduler` and `openStore`, `RecordingSink`, no `capacity` (no pool, so `/proc/stat` is never read; stricter than `host: null`). Six test files: four "slow" ones of one known duration each sequence draws (20, 35 or 200 s), `P` in a second project, `Q` beside them. The start is `heldTier` of `tier-yields-named.test.ts`: the four in an edit's tier in flight, `P` queued behind by its environment. Two runner kinds: Vitest-like (cancels, reports each file's end) and node-like (`besideBacklog`, ignores cancels, reports no ends, may crash).
- **Forced interleavings.** The runner resolves a run only when a `finish` event comes, and a file ends only on an `end` event. The clock is `SchedulerOptions.now`, the host's plus an offset; `setTimeout` is replaced during the sequence, so a step that passes a timer's deadline fires it (the yield bound of `yields.ts:241`). A `cross` event arms a jump after N more clock reads, so the next decision reads two times (as test 10's `stillClock`). After each event the probe waits until the runner, the key rows, the known states and the `yields` row are unchanged for three polls 15 ms apart.
- **Oracle.** The check reads the daemon's own published promotions, not the model's, so a lost promotion (F) does not mask A and B. Deadlines within 200 ms are read in the direction that cannot flag falsely.
- **Shrinking.** Greedy deletion of one event at a time while the same invariant fails, at most 40 re-runs.
- Five oracle errors were found while the probe was built, and four were fixed (a forced file current but queued; a release whose abort names no cause; a crashed run's `unknown` files; a jump that moves past a deadline the decision read; for A, a promoted file that ended inside the tier and was queued again). The fifth is not fixed: it gave 2 of HEAD's 3 A failures (seeds 33 and 51), both traced as false positives.

### 3. Replay

Five blockers. Two are from 016-11's scheduler race and order groups (R345 order, R427 race). Three are 011-184's own blockers (R397, R398, R399). 016-11 coded these three as named demand, time, but each is a race or order defect in one yield decision, and invariants (a) to (c) were written for them. Budget: seeds 1 to 300, 12 events each, `STOP=first`; then the fix commit on the seeds the pre-fix run tried.

| Blocker | Pre-fix → fix | Invariants | Found | Sequences tried | Shortest failing sequence | Fix commit on the same seeds |
|---|---|---|---|---|---|---|
| R398 (0.1.296 B1): the protected module's end does not recheck the tier | `5ecb377a8` → `69d6328bf` | A to E | yes, B | 141 | promote P 60 s; step 35 s; promote s3 3 s; end P → the tier stands `named` with no file left unended | 141 pass |
| R399 (0.1.296 B2): an expired earlier wait keeps a later waiter behind | `5ecb377a8` | A to E | no (R398 stopped the run first; no B on expiry in 141) | 141 | – | – |
| R397 (0.1.296-r2 B2): expiry between the rank and bound reads | `231ecaeb0` → `b862d2f2d` | A to E | no | 173, stopped by a C failure that the fix commit shows too | – | seed 173 fails C again; seed 97 fails A (an oracle error, fixed after) |
| R345 (0.1.237 B1): a forced run yields again at one file and key | `d7344427b` → `3a8d364e4` | C to E | no | 300 | – | 300 pass |
| R427 (wave-4 B1): an old backlog run erases the newer run's state | `dae700644` → `bc8ed7742` | D, E | not by the generator (300, node kind); a hand-placed sequence fails D | 300 | finish; finish; `run --all --force`; step 1 s; edit `src/s.ts`; crash the old run → `s1` runs at its key and its row is not pending | hand sequence passes; 300 seeds pass |

Why the misses (inferred): R427 needs four events in one order (a forced backlog, an edit beside it, the old run's crash), about 1 in 10³ under these weights. R345 needs a forced file queued beside a running forced tier, and six files fit in one backlog tier, so this fixture never queues one. R399 and R397 need an earlier wait on a tier file to expire while a later wait's file is queued and the tier has run 30 s; at `5ecb377a8` the R398 find came first. At `231ecaeb0`, R397 needs a jump between the rank and bound reads of one decision; `cross` jumps after 1 to 4 reads, and nothing aims it at that pair.

**HEAD (`2f9328ff6`), 300 mixed sequences, every invariant, every failure** (`results/head.json`):

- **F, 36 of 300 (verified by experiment, cause read in source code).** When a promotion cuts a tier, an earlier open wait's promotion of a file in that tier is dropped, though the file is queued again and the wait's deadline has not passed. Fixed reproduction, every run on HEAD: step 1 s; promote s4 120 s (s4 running in the tier); promote P 60 s (the tier yields to P) → the `promotions` row holds only P's. Cause: `RunQueue.add` calls `#promotions.settle(this.#queued)` before it adds the entry (`queue.ts:195`). The cut file is then neither queued nor in a run (`Promotions.#open`, `promotions.ts:139`), so its promotion goes. Effect: s4's wait reads `queued`, not promoted. It no longer ranks first. And it no longer protects the next tier that runs it under (a). A 4-event variant gave the same symptom at `5ecb377a8` and `69d6328bf` (`results/directed.md`), so it predates 011-184's repairs.
- **A, 1 of 300 (seed 60; verified by experiment, cause read in source code).** One decision reads the clock more than once. `rankToBeat` reads it once (`yields.ts:359`), and `remainder` and `byRemainder` read it again (`yields.ts:398`, `411`). With a 20 s tier, wait 0 on s4 and P, and the clock moving 60 s during the next promotion's decision, the rank read saw the tier under 30 s (so no file was protected). The remainder read saw it 40 s past its estimate, and the tier yielded, cutting s4, which wait 0 selected beside P. Under either single reading the tier would not yield. On a real clock the window is the decision's own duration at the 30 s boundary of a tier whose estimate is about 0 (files of no known duration), where "yields 30 s after its start" and the protection start at the same instant. This is review `0.1.296-r2.md` B2's class (one reading per decision), on the remainder rather than the deadline.
- A, seeds 33 and 51: oracle false positives (traced; see finding 2). B, C, D, E: none on HEAD. The C failure at `231ecaeb0` and `b862d2f2d` (seed 173, `KIND=vitest`) was not re-run on HEAD under the same kind: not determined.

### 4. Shape

- **Lines (verified by count).** The probe is 690 lines with its tracing and replay plumbing. As a test file: about 300 lines for the model, the fake runner and the clock (a `model-fixture.ts` beside `catch-up-fixture.ts`), and about 150 for the invariants and one `it` per invariant group over a fixed seed list. Reusing `catchUpRepo` and `catchUpSide` would cut the fixture; the probe avoided them only because they do not exist at 0.1.224.
- **Run time (verified by experiment).** 0.9 to 1.0 s a sequence at every commit, almost all of it the settle's polls (idle wait), not CPU. Per 1,000 sequences, scaled from one 300-sequence run of HEAD under `nice -n 10`: 925 s wall, 88 s user, 103 s system, at a one-minute load of 18.4 before and 16.4 after, on 24 CPUs. A suite file of 100 seeds would take about 95 s wall and 19 s CPU. It adds nothing per user edit.
- **Flake risk (inferred).** (1) The settle ends after 45 ms without a visible change; a decision that takes longer under load reads as quiet, and the next event lands early. This can hide a failure, and rarely raise one. A test file should await the scheduler's lock instead (`idle()` waits for every run and does not fit). (2) The virtual `setTimeout` replaces a global; Vitest's own timers are safe (it keeps its own references), but any library timer in the scheduler's process then follows the virtual clock. (3) Deadlines within 200 ms are read leniently, so a defect inside that window is missed.
- **Not checkable by this shape.** C6's wait window and verdict text; delivery views (C5 179 to 192); claims across worktrees (C15 381, R376, R141: need a second scheduler on the store); a restart and its resume of queued work (C4 156); installs (C11); the slow tier (004). A second worktree and a restart are the next additions. Each is a few events over the same store.

## Recommendation for Squeal

1. **Build it as a 011 row** (findings 3 and 4). On HEAD, 300 sequences found two defects that no hand-written test covers. One fails in 12% of sequences and is deterministic to reproduce; the other is the race class review 0.1.296-r2 found by reading. On old commits it found R398 in 141 sequences. Ship it with a fixed seed list of about 100 and invariants A to F. Add the seven checkable invariants of finding 1 one at a time.
2. **Hand F and seed 60 to 011's coordinator as defects, with these reproductions** (finding 3). F: `queue.ts:195` settles promotions before the cut file is queued again. A: one clock reading per decision should hold for `remainder` and `byRemainder` too.
3. **Weight the generator toward rare orders before trusting a miss** (finding 3). A miss at 300 sequences is weak: R427 is reachable by hand but not by these weights. Two cheap changes: a scenario mode that starts from a forced backlog, and a `cross` that targets each clock read of a decision in turn.
4. **Replace the settle with an event from the scheduler** before it runs in CI (finding 4, flake risk 1).

Limits: one fixture of six files, one worktree, no restart or install; 12 events a sequence; the oracle is the researcher's reading of the spec, and five oracle errors were found while building it, so its finds were each traced before they were counted. Timings come from one run on a loaded host.

## Open questions

1. Does the C failure (a file cut twice at one key, seed 173 under `KIND=vitest`) hold on HEAD, and is it a defect or an oracle error? Not determined: it was found on `231ecaeb0` and `b862d2f2d` and not traced.
2. Would R399, R397 and R345 be found with a larger budget or the weighting of recommendation 3? Not determined: not run.
3. Is the dropped promotion (F) seen in practice? Not determined: no live store was read; cezar's `promotions:` rows, read through a copy, would show a wait whose file is queued with no row.

## Sources

Read and run 2026-10-25:

- `docs/specifications/011-core/spec.md` at `2f9328ff6`: C4 lines 113 to 158, C5 163 to 192, C6 197 to 219, C15 369 to 404; `status.md` lines 155 to 158; `docs/board.md` row 011-184.
- `src/core/scheduler/yields.ts`, `promotions.ts`, `queue.ts` (lines 99, 144 to 163, 195, 314 to 332), `scheduler.ts` (`promote`, lines 611 to 618), at `2f9328ff6`.
- `test/scheduler/helpers.ts` (line 353, `host: null`), `catch-up-fixture.ts`, `tier-yields-fixture.ts`, `tier-yields-named.test.ts` (tests 9 to 11, `stillClock`), `quiet-clock.ts`.
- Reviews: `docs/specifications/011-core/reviews/0.1.296.md` (B1, B2), `0.1.296-r2.md` (B2), `0.1.237.md` (B1), `wave-4.md` (B1); items R345, R397 to R399 and R427 of 016-09's list, rebuilt at `f6320cd7e` with `probes/defect-causes/` (issues list left empty; R ids come from reviews only), codes from `probes/core-defects/areas.tsv`.
- Commits: `5ecb377a8`, `69d6328bf`, `231ecaeb0`, `b862d2f2d`, `d7344427b`, `3a8d364e4` (fix `55ba5d821`), `dae700644`, `bc8ed7742` (fixes `9c858b45a`, `66e590e07`), `2f9328ff6`.
- Probe: `probes/model-scheduler/` (`model.probe.ts`, `run.sh`, `replay.sh`, `results/log-1.txt`, `results/log-2.txt`, `results/directed.md`, `results/*.json`).
