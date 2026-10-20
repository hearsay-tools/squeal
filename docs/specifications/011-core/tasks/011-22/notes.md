# 011-22 notes (W1 of wave 5, 2026-10-20)

A revision that changes 10 or more keyed paths queues the files it re-keys as **catch-up**: a group between an edit's work and the rest of the second group, on the backlog's route (pool grant, 120 s budget, slots for node:test and pytest), failing first then shortest first; a later edit cancels it in a Vitest lane and runs beside it in a node:test or pytest lane; the four-tiers turn takes it first (spec 011 C4 step 4 as amended 2026-10-20, `research/catch-up.md`). Base `cand/0.1.225` (c141fa8f). With the coordinator's note from review W4r: the turn's tier now takes the backlog's grant and, in a lane of slots, is one slot.

## The seam map

- **The mark.** `src/core/scheduler/revision.ts` `isCatchUp(context, ledger, paths)` with `CATCH_UP_KEYED_PATHS` 10: a changed path is keyed when it is a test file the ledger holds, a declared input (`keys.isDeclaredInput`, glob-based) or a path some closure holds (`keys.index.reverse.referencing([path])`). Fewer than 10 changed paths returns at once, so an agent's edit pays nothing. `rekeyContent` counts once per revision, before the re-key, and passes `catchUp` to `Ledger.settle` and on in `ContentRekey.catchUp`.
- **Through the runner part.** `fetchRunnerPart` copies `content.catchUp` into `RunnerPart.catchUp`, and `applyRunnerPart` passes it to its `settle`, so the runner's direct importers and the re-resolved closures of a catch-up revision are catch-up too. A runner-only refinement (`NO_CONTENT`) has none.
- **The daemon start.** `bootstrap.ts` `baseline`: what no runner saw change (`scan`'s `start` revision and the unrefined ones, plus the install wait's) is counted as one revision by `isCatchUp`; misses it reaches are queued recent below 10 keyed paths, catch-up from 10. Under `lookup-only` nothing is queued, as before.
- **Where the mark lands.** `Ledger.settle(…, { catchUp })`: a miss in `recentOf(changed, direct)` is queued `recent` or, on a catch-up revision, `catchUp` (`Ledger.enqueue`'s fifth argument). Everything else `settle` does is unchanged.
- **The groups.** `queue.ts`: `Entry.catchUp`, OR-ed on `add` like `recent`; `groupOf(entry, promoted)` is the first group when recent or promoted, else catch-up when marked, else the second. `sorted` orders by `GROUP_ORDER` (edits: first, catch-up, second; the turn: catch-up, second, first), then the promotion rank, then the class (catch-up: failing, then the rest; elsewhere `Priority`), evidence, duration (catch-up: unknown last), seq, path. `isCatchUp(ref)` is new. `hasFirstGroup`, `hasRecent`, `isFirstGroup` and `tierSelected` are unchanged: catch-up is not the first group, so `selectTier`'s `backlog` test, `busyLanes`, `cancelsBacklog`'s `hasRecent`, the claim wait (`waits = mayWait && !recent`) and the turn's count all treat it as the backlog with no further change.
- **The cancel's remainder.** `TierFile.catchUp` (set in `selectTier`); `recordTier` re-queues a cancelled tier's unfinished files, and a requeued tier's, with it, so they stay ahead of the backlog. Without it they lost the mark and ran behind the rest of the second group (red in `catch-up-cancel.test.ts` test 1).
- **The turn (review W4r).** `selectTier(…, turnDue = queue.backlogTurn())`: `turn` is `!backlog && turnDue`; the tier is the turn's (`turnTier`) when its first pick is not of the first group. It keeps `runner.tierSize` and `joinSpan`, takes the pool's lease at `widest(picked)` (`workers` reaches the runner), and in a lane of slots is one slot (`backlogSlot`, `joinsSlot`, cancellable so `busyLanes` sees a slot and the edit's tier runs beside it; node:test and pytest ignore the abort). A Vitest turn stays uncancelled (C4 step 5). When the pool answers `WAIT_FOR_CAPACITY`, `selectTier` selects again with `turnDue` false: the edit's tier goes now and the turn stays due. `Ledger.ordered(turn)` and `RunQueue.ordered(durationOf, turn)` take the turn explicitly for that.
- `src/core/keys/key-format.ts`: `KEY_FORMAT_VERSION` 17, hash `7fd2effa…b51e`.

## Tests (the done-when of `research/catch-up.md`, 011-22)

Fixture `test/scheduler/catch-up-fixture.ts`: worktrees of one git repository whose test files import plain sources, a real store and a real per-user pool, a fake runner of fixed reported durations whose runs take each file's `realMs` on the next free of their workers (the grant, else one per file) and honour a cancel (or ignore it, `cancels: false`, as node:test and pytest do). "Red" is the test against c141fa8f's `src` (or with only the named part reverted).

| # | Test | Red without |
|---|---|---|
| 1 | `catch-up.test.ts` "1. runs a 12-source change's 480 files as a backlog tier": 480 files of 0.1 to 5 s plus one of 60 s, 23 slots; the first run has a grant, more than 4 files, a wall estimate within 120 s, not the 60 s file; every run granted | yes: no grant, tiers of 4 |
| 2 | same file, "2. … across 9 sources as edit tiers": no grant, ≤ 4 files each | no (the control: as before) |
| 3 | same file, "3. is catch-up as a watch / interval revision" and "… a daemon start's revision under lookup-then-run-missing" | yes, all three |
| 4 | `catch-up-cancel.test.ts` "4. cancels a catch-up Vitest tier 1 s in …": the tier is cancelled, the edit's tier (4 files, no grant) is next and current within its run plus 6 s, finished files never run again, the rest runs as catch-up before a second project's environment backlog | yes (no grant); with only the `recordTier` re-queue reverted: the backlog runs before the remainder |
| 4 | same file, "4. starts the edit's node:test tier beside the catch-up slots, with no permit" | yes: no slots (edit tiers of 4) |
| 5 | `catch-up-order.test.ts` "5. runs the edit, then catch-up, then the run --all backlog" (`lookup-only`, `run --all` held in its first tier, then the 12-source change and the edit) | yes |
| 5 | same file, "5. takes a catch-up tier on the turn after four tiers of the edit's": edit ×4, catch-up, edit; only the turn's tier has a grant | yes |
| 6 | same file, "6. … when a later edit re-keys it": the catch-up tier is cancelled, the edited file leads an edit's tier | yes |
| 6 | same file, "6. … when a named wait promotes it": the catch-up tier ends uncancelled, the promoted file leads the next tier | no (promotion already led on main; it checks that it still does) |
| 7 | same file, "7. … in a Vitest lane, where the heavy file exceeds the tier's budget (timeoutMs 100 s: 50 s)": all 50 light files are current when the 60 s file's run starts | yes |
| 7 | same file, "7. … in a node:test lane, in slots": all 50 current before the 60 s file's run ends, at the defaults | yes |
| 8 | `catch-up-claims.test.ts` "8. runs each key … once": the second worktree runs nothing, waits on the first's claims and holds its results with the first's provenance | yes: the second ran 12 files itself |
| W4r | `catch-up-turn.test.ts` "in a Vitest lane takes a grant, and an edit during it cancels nothing" | yes: no grant |
| W4r | same file, "in a lane of slots is one slot with its permit, and the edit's next tier runs beside it" | yes: 4 files, no permit |
| W4r | same file, "gives way to the edit's tier while the pool would hold it back": lane x's backlog tier holds the free worker, another owner every permit; the fifth edit tier starts before lane x's tier ends | yes, with only the `WAIT_FOR_CAPACITY` fallback reverted: it waited for lane x |

Done-when 7 in a Vitest lane needs a budget the 60 s file exceeds: at the default 120 s, `sum / W + (1 − 1/W) × longest` of 50 × 0.1 s and 60 s is at most 65 s at any W, so the 60 s file joins the light files' tier and they become current with it, at its end (a Vitest tier stores at its end). Cezar's case is the same rule at scale (its 576 s file exceeds 120 s), so the test uses `timeoutMs` 100 s (budget 50 s) for that lane and the defaults for slots. Shortest first keeps a heavy file out of the first round; only the budget keeps it out of the light files' tier.

## Done-when 9: the cezar replay on the slice's selection

`replay-slice.ts` (this folder; `npx tsx docs/specifications/011-core/tasks/011-22/replay-slice.ts <research/probes/catch-up/results/cezar-733.json>`): the slice's scheduler in a scratch repository, store and pool (`mkdtemp`, removed after; nothing outside it is read but the JSON), a fake runner whose 795 fast files report the times the probe extracted (740 Vitest, 55 node:test, a file run twice at its later run's time and lane, as `replay-733.mjs`), 24 host slots, Vitest at min(grant, 23), node:test 4 slots. A 12-source `interval` revision re-keys all 795 at once; the selected runs are then timed with `replay-733.mjs`'s model (makespan over the grant plus 0.5 s per Vitest tier, one after another; node:test one file per slot plus 0.5 s). 2026-10-20, load 19.94 / 17.07 / 12.98 on 24 CPUs (a replay of recorded durations; no hold applies):

| Rule | Lane | Done | Mean time to a result | At 2 / 5 / 10 min | Tiers |
|---|---|---|---|---|---|
| Edit route, tierSize 4 (0.1.224, probe) | Vitest | 2,574 s | 1,588 s | 72 / 84 / 88 | 186 |
| Third group, shortest first (probe's model) | Vitest | 857 s | 51 s | 710 / 733 / 733 | 6 |
| **This slice's selection** | Vitest | **862 s** | **54 s** | **600 / 733 / 733** | 6: 200 200 200 110 23 7, grants 23 20 20 23 23 7 |
| Edit route, tierSize 4 (probe) | node:test | 140 s | 24 s | 48 / 55 / 55 | 15 |
| **This slice's selection** | node:test | **132 s** | **12 s** | **54 / 55 / 55** | 55 slots |

The slice cuts the same tiers as the probe's model. The two differences are the shared pool: the second and third Vitest tiers were granted 20, not 23, while the node:test slots held 4 of the 24 permits (C10), so each ends about 1.5 s later and the fourth (110 files) ends at 123.5 s against 118.3 s, just past the 2-minute mark. Hence 600 at 2 min, not 710; 733 at 5 min in both. The edit's wait is the cancel's (≤ 6 s, Vitest) or none (beside the node:test slots), as tests 4 show; the replay does not model it. A live cezar measurement below load 8 is the coordinator's.

## Decisions the spec did not settle

1. **What is counted, and when.** Keyed paths are counted at the content part, before the runner part lists anything: a path an added test file holds counts only once a closure or a declared input names it. A pull that only adds 10 or more new test files, and changes no keyed path, stays an edit's work. Counting again after the listing would catch it, but the content part has already queued the revision's files recent by then; not done.
2. **A daemon start** counts every path no runner saw change as one revision (the `start` revision, unrefined ones and the install wait's), since the baseline settles them in one pass.
3. **Unknown durations in catch-up sort last**, after every known one. In the first group an edited file's unknown duration sorts first (gh-31); "the edited, direct and transitive classes do not divide" catch-up, and a new heavy file must not take the first round of a backlog tier.
4. **What keeps the mark on a re-queue.** A cancelled or requeued tier's unfinished files keep `catchUp` (they did not run). A timeout split, a discard and `Scheduler.#requeue`'s error path re-queue without it, as they re-queue without `recent` (they ran, or the error path loses `forced` too).
5. **The turn's size** stays `runner.tierSize` with `joinSpan`, uncancelled in a Vitest lane. At backlog width and uncancelled, an edit arriving during it would wait up to the 120 s budget every fifth tier; the brief and the review asked for the grant and the slot, not the width.
6. **The turn on a full pool** yields to the edit's tier (C10: an edit's tier never waits on the pool) and stays due, so it runs at the first tier boundary the pool allows.

## Type changes (all additive)

`RunQueue.add(…, catchUp = false)`, `RunQueue.isCatchUp(ref)`, `RunQueue.ordered(durationOf, turn = backlogTurn())`; `Ledger.enqueue(…, catchUp = false)`, `Ledger.ordered(turn = …)`, `SettleOptions.catchUp?`; `ContentRekey.catchUp?`, `RunnerPart.catchUp?`, `TierFile.catchUp?`; `selectTier(context, ledger, busy, turnDue = …)`; new exports `CATCH_UP_KEYED_PATHS` and `isCatchUp` (`revision.ts`). `KEY_FORMAT_VERSION` 17.

## For the next worker

- `failures.ts` `settleFailures` settles the files a runner failure unblocked with the revision's `changed` and no `catchUp`: on a catch-up revision that also ends a runner failure, those files are queued recent. Not in this row's seam; a one-line pass-through if it matters.
- 011-25 (an agent's edit of a central source) cuts at the same place: `Ledger.settle`'s `recent` set, split into direct importers (stay recent) and the transitive rest (`catchUp`). `RunnerPart.direct` already carries the runner's direct importers; `recentOf` merges them with the reverse index's transitive set, which is where the split goes.
- 011-23 (adoption) needs nothing from this slice: catch-up files look keys up as any queued file does.
- The bundles under `plugins/*/dist` are not rebuilt (the coordinator's); their four drift tests fail until they are.
