# Research: issue 51, a named wait behind a large requeue

Researcher, 2026-10-20, worktree `cez/7fae8031` at ea76593b (`package.json` 0.1.228). [Issue #51](https://github.com/hearsay-tools/squeal/issues/51): after a base-branch merge requeued 303 test files in cezarion (PR #1312), four `squeal status --wait 60000 packages/cezar/src/test-wait-discipline.test.ts` calls each printed `pending — queued behind the vitest tier running since 14:07:17`; the file then read `running since 14:11:37 in the vitest lane`. Load 84 on 24 CPUs. Reported on Squeal 0.1.226. The issue asks that a named queued file start before every unnamed file of its revision, that the wait say so, and for a regression test.

Environment: host 24 CPUs (`nproc`); one-minute load 13.52 at the start (below the CPU count, so a probe was allowed), 17.55 at the first probe run, 43.47 when the recorded run started (`results.txt` header; above the CPU count, so no further live run was made). The probe is synthetic and in-process: a fake runner, a real store and a real scheduler, with no Vitest child processes and no timings in its assertions; the load does not change the order it checks. `npm ci --ignore-scripts` in this worktree, Vitest 5.0.3. No build, no suite. The original cezar session was not replayed: its store, daemon log and timings are not available here.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a large requeue defeat C15's promotion? | No. With 303 files re-keyed by one catch-up revision and a 122-file backlog tier in flight, a promoted file led the next tier; 122 files ran ahead of it, against 298 without promotion. The tier in flight was not cancelled. | verified by experiment (0.1.228 tree) |
| 2 | Is the reported delay a running-tier constraint? | Yes, by the issue's own lines: the same `behind the vitest tier running since 14:07:17` for four waits, then `running since 14:11:37`, about 260 s, is one tier in flight. C15 never cancels or splits a running tier for promotion; that question is 001-381's. | read in official docs (spec 011 C15, C4 step 5), inferred from the issue's output |
| 3 | Why did the lines say `queued` and not `queued, promoted`? | The promotion lasts until the wait's own deadline, and a timed-out wait prints its last read at or after that deadline, when the CLI drops a promotion with `until <= now`. So a wait that times out never shows the label in its final text. | read in source code; not verified by experiment |
| 4 | How does this compare with #14, #38, #40 and the named-demand rows? | #14 (closed) is the ask C15 and 011-11 shipped. #40's research found the same two limits: promotion does not reach into a running tier, and the `promoted` label was missing from a short timed-out wait (cause left open there). #38 is unrelated (a stale file with nothing queued). 001-381 holds the running-tier question. | read in source code and repository docs |
| R | Reproduction | **Reproduced in synthetic form, not as the original.** The wait behind a running backlog tier of a 303-file requeue reproduces, and so does the promoted file starting at the next boundary. Not reproduced: cezar's 260 s tier at load 84, and the merge's exact classification, because the original store and timings are not available. | verified by experiment / not determined |

## 1. Promotion behind a 303-file requeue

**Verified by experiment** (`probes/issue-51/large-requeue.probe.ts`, output in `probes/issue-51/results.txt`). The fixture is `test/scheduler/catch-up-fixture.ts` (011-22): 303 files over 12 sources, durations 1 s to 31 s, all run once, `hostSlots: 8`, default `backlogTierSize` 200. One revision edits the 12 sources: 12 keyed paths make it catch-up (C4 step 4 as amended 2026-10-20), and every file is re-keyed. The first backlog tier is held in flight. The probe promotes the file the order would run last for 60 s, then releases the runner.

| Case | Tiers (files each) | First tier cancelled | Tier of the named file | Files run before it |
|---|---|---|---|---|
| no promotion | 122, 52, 39, 32, 28, 25, 5 | no | 7th | 298 |
| promoted | 122, **4**, 51, 39, 32, 28, 25, 2 | no | 2nd, first file | 122 |

The promoted file's tier holds 4 files because a first-group tier shares only with files of comparable duration (001-184). Every file is current at the end in both cases. This is the shape `test/scheduler/catch-up-order.test.ts` "6. ... when a named wait promotes it" already asserts on 24 files. The probe repeats it at the issue's scale.

So the issue's first acceptance criterion is met at tier boundaries: a named queued file starts before any unnamed queued file of its revision, apart from those already in the running tier. The other files ran after it in tiers of nearly the same sizes (51, 39, 32, 28, 25, 2 against 52, 39, 32, 28, 25, 5); the probe did not compare their order file by file. A regression on this scale would duplicate catch-up-order case 6.

## 2. The delay is the running tier

**Read in official docs** (spec 011 C15 "Rank": "A running tier, whether an edit's or the backlog's, is never cancelled or split for promotion: that question belongs to 001-381"; C4 step 5: a backlog tier takes up to 200 files within an estimated 120 s, and "the budget limits the tier's estimated wall time, not its real one"). **Inferred** from the issue: the tier began at 14:07:17 and the named file ran at 14:11:37. That is about 260 s, twice the 120 s estimate, at 3.5 load per CPU. No line names a second tier between them, so the file most likely led the tier after it, as in the probe. The tier's size and the file's place in the cezar queue were not observed.

What would shorten this wait is cutting the running tier: 001-381 (planned, the human 2026-10-14, research on an edit splitting its daemon's running backlog tier), or a smaller backlog budget (001-366, decided at 120 s). Neither belongs to a triage row. The issue's wording "ahead of the files queued by the same revision" is already C15. The delay it reports comes from the files the revision had already started.

## 3. The missing `promoted` label

**Read in source code** at ea76593b:
- `src/cli/status-wait-paths.ts` `waitForNamed`: the promotion is sent once, at the first ready read, with `options.timeoutMs - elapsed()`, the time left in the wait. The loop then pauses `min(pollMs, remaining)` and makes its final read when `elapsed() >= timeoutMs`.
- `src/core/scheduler/scheduler.ts` `promote`: `until = context.now() + withinMs`, the wait's deadline on the daemon's clock, plus transit time.
- `src/core/scheduler/promotions.ts` `promotedIds`: the CLI counts a published promotion only while `p.until > now`.

So the final read of a wait that times out happens at or after `until`, and the label is gone from the text it prints. During the wait the label holds and the order holds. A later wait sends a new promotion, but between waits (the agent's turn) nothing is promoted, so a tier boundary in that gap takes the backlog's order. This also explains #40's open point ("the 1.5 s wait sent a promotion ... but its text said `queued`"). **Not verified by experiment** in the time box: a probe would time out a `waitForNamed` with a live promotion row and read its final `Pending` line.

## Recommendation for Squeal

Treat #51 as already covered by C15 for queued files, with two residuals for the coordinator to weigh:
1. **Label at the deadline (small, C15 wording).** Read a timed-out wait's final reasons before the deadline, or let the daemon hold a promotion a little past the wait's deadline (for example one poll interval), so the last text says `queued, promoted, behind ...`. This meets the issue's second criterion ("the wait output says the named files were moved ahead"), which today is met only by reads before the deadline.
2. **The running tier itself.** Route to 001-381. Do not widen promotion to cancel or split a running tier from a triage row.

The third criterion (a regression behind a large requeue) is covered in shape by catch-up-order case 6; scale adds nothing the order logic depends on.

Holds preserved: 001-381 stays the owner of cancelling or splitting a running tier; the eval hold, `lookup-only` (011-33) and the 011-25 cut are untouched; nothing here moves a key.

## Open questions

- Whether cezar's tier in flight at 14:07:17 was the merge's catch-up tier or an earlier backlog tier, and whether the merge edited `test-wait-discipline.test.ts` itself (which C4 would treat as catch-up too at 10 or more keyed paths): not determined, because the cezar store and daemon log were not read.
- Whether a tier boundary fell in a gap between the four waits: not determined, for the same reason.
- Item 3's mechanism by experiment: not run, time box.

## Sources

- Issue: `gh issue view 51 -R hearsay-tools/squeal` (and 14, 38, 40).
- Spec: `docs/specifications/011-core/spec.md` C4 (step 4, step 5, lanes), C6, C15; `status.md` lines for 011-03, 011-11 to 011-13, 001-366, 011-21, 011-22, 011-25.
- Board rows: 001-381, 011-03, 011-11, 011-12, 011-13, 011-24, 011-27, gh-40 / gh-38 folded into 011-24 (`docs/board.md`).
- Prior research: `research/issue-40.md` sections 2 and the "Promoted label not seen" note.
- Source at ea76593b: `src/cli/status-wait-paths.ts`, `src/cli/status-wait-promote.ts`, `src/cli/named-files.ts`, `src/cli/named-file-lines.ts`, `src/core/scheduler/promotions.ts`, `src/core/scheduler/scheduler.ts`, `src/core/scheduler/queue.ts`; tests `test/scheduler/promotion.test.ts`, `test/scheduler/catch-up-order.test.ts`, `test/scheduler/catch-up-fixture.ts`.
- Probe: `probes/issue-51/` (README, probe, config, `results.txt`). Command: `npx vitest run -c docs/specifications/011-core/research/probes/issue-51/vitest.config.ts --reporter=verbose`.
