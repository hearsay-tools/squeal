# 011-263: a yield to a promoted file must start that file sooner

Worker 00dc9d6c, 2026-10-28. Brief: `tasks/wave-57.md` W1. Source: `research/issue-121.md` F3 and F4.

## 1. What changed

Before this row, a promoted file made a running tier yield whenever the tier had run less than 30 s and its estimated remainder was over 30 s. In F3 a wait named three running 308 s files, and 10 s later a second wait added a queued 1 ms file. The tier yielded. The cut files kept the earlier wait's rank, so they ran again first, for 308 s against the 298 s the tier had left. The 1 ms file waited longer than with no cut.

Now, before a `promoted` verdict, `startsSooner` (`src/core/scheduler/yield-sooner.ts`) asks whether the cut would start the promoted file before the tier's estimated remainder:

1. The cut files that rank before the promoted file go back to the queue ahead of it. The order is C15's rank, then C4's order: class, then last-known duration. A cut file's class is `priorityOf(file, NOTHING_CHANGED)`, as `requeueFile` queues it. The promoted file's class is its queue entry's (`RunQueue.priorityOf`, new). On a full tie the promoted file goes first, because the cut queues its files after it.
2. Tiers form from those files as selection forms an edit's tier: at most `runner.tierSize` files, by the tier-sharing rule (`joinSpan`), with the past-estimate marks. The tier's other files join where they share, as in `selectTier`.
3. The promoted file starts sooner when it joins the first tier, or when the tiers before its own end before the remainder. Each tier counts its longest last-known duration. A file with no known duration counts 0, as `remainder` counts it.

When no promoted file starts sooner, the tier runs on as `named`. Its line keeps the reason text that row 011-184 added: "the tier does not yield: it runs a file this wait or an earlier one selected". That text is correct here: a cut file ranks ahead only when the same or an earlier wait selected it. Before 30 s, such a tier is checked again when one of its files ends (`standsNamed`) and at the earliest deadline of a promotion that ranks one of its files (`Beat.until`). After 30 s, the rule changes nothing: the rank to beat (row 011-184) already requires the promoted file to rank before every unfinished file, so no cut file is ahead of it.

The 30-second rule, the once-per-key guard and promotion lifetime are unchanged.

## 2. Spec sentences to amend

C4 step 5. After the sentence that ends "...the cut would delay it by up to the time that file had run.", insert:

> At any time, a promoted file makes a tier yield only when the cut starts it before the tier's estimated remainder. The cut files that rank before it (C15's rank, then C4's order) go back to the queue ahead of it. Tiers form from them as an edit's tier forms (`runner.tierSize` and the tier-sharing rule), and the tier's other files join them where they share. The promoted file starts sooner when it joins the first of those tiers, or when the tiers before its own end before the remainder, each tier taking its longest last-known duration (a file with none counts 0). Otherwise the tier runs on, and the wait's line names the reason (`named`). The tier is decided again when one of its files ends and at the deadline of the first promotion that ranks one of its files. (Amended 2026-10-28, the human, decision card "A1 + B", and the coordinator's rule, row 011-263, `research/issue-121.md` F3: a wait at 10 s that added a 1 ms file to three running 308 s files that an earlier wait selected cut them; they ran again first, 308 s against the 298 s left.)

C15 Rank. In "A promoted file queued behind a running tier makes it yield as C4 step 5 says: once per file and key, when its estimated remainder exceeds 30 s, never the backlog's turn, and, once the tier has run 30 s, ...", insert after "never the backlog's turn,":

> only when the cut starts it before that remainder (row 011-263),

## 3. Decisions the brief did not settle

| Question | Choice | Who |
| --- | --- | --- |
| The brief's lead was "the promoted file is in the lane's next tier after the cut". That rule blocks a useful yield in a backlog tier, which has no tier-sharing rule: C (2 s, an earlier wait's) and L (300 s) run; at 10 s a wait names Q (60 s). After a cut, C runs again for 2 s and Q leads the next tier: about 70 s to Q's result, against about 350 s with no cut. | The time rule of section 1, for every tier kind. | Coordinator, reply to request 143b0a81 |
| Q's class, for a tie at the same rank. | Read the exact queued class: new read-only `RunQueue.priorityOf(ref): Priority \| null`. `null` (not queued) means the file cannot start sooner. | Coordinator, reply to request 5c579c0c |
| `test/scheduler/promotion-cut.test.ts`, test "016-18's F", depended on a yield that ran P no sooner: s4 and the other three would run again for 200 s, past the 199 s left. | Setup changed: P's last-known duration 1 ms becomes 100 s, so P shares s4's next tier and the tier still yields. No assertion changed. Its own commit. | Coordinator, reply to request 45bf0f72 |

No other existing test's setup changed.

## 4. Limits of the model

The model reads only the tier's own files and the promoted file.

- Queued files are not read. A queued promoted file that ranks first is checked as its own candidate. Queued edit work that would join a tier ahead of the promoted file is not counted, so that tier can take longer than the model says. This errs toward a yield, as before.
- A due backlog turn is not modelled. After four tiers of the first group, the next tier is the turn's, and it leads with the second group. The model forms an edit's tier. This can err either way.
- Other worktrees' claims and stored results for the cut files are not read. A cut file ahead that the next selection takes from the store, or holds for a claim, does not run, but the model counts its duration. This can skip a yield.
- `tierCap` (a timed-out tier's files) and lanes of slots are not modelled.

## 5. Tests

- `test/scheduler/tier-yields-next-tier.test.ts`, in the scheduler with a held tier: F3 (no yield, Q runs after the tier); four cut files of an earlier wait fill the next tier (no yield); Q shares the next tier with one cut file of an earlier wait (yields, next run `[s1, Q, s2, s3]`); the earlier wait's deadline passes before 30 s with no event (yields, Q first by C4's order).
- `test/scheduler/yield-sooner.test.ts`, the rule alone: F3; the backlog example (yields); an edit's tier where an unpromoted cut file joins the earlier wait's file ahead of Q (no yield); unknown durations count 0 (yields); room in the next tier and none; ties at the same rank by class and by duration; no cut file ahead, also past the estimate (yields).

## 6. Seam map

- `yields.ts` `rankToBeat` reads every unfinished file's rank once per decision, into `Beat.files`. Before 30 s, `Beat.until` is the earliest deadline among those ranks; `boundOf` uses it for `named`.
- `waitedFor` asks `startsSooner` inside `runsSooner`, after the rank-to-beat check and before the claim check. A file that does not start sooner sets `named`.
- `startsSooner` reuses `joinSpan` and `priorityOf`. It does not call `selectTier`, which probes the store and changes the queue.
