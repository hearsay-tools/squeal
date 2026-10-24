# 015-20 notes: seeding after a catch-up, views of failing functions only

Worker 09eb6544, 2026-10-24. Brief: `tasks/wave-1b.md` W2. What the review and the next row read first.

## Seam map

| What | Where |
|---|---|
| A view holds failing functions only; a missing row reads `pass`; a passing function leaves the view | `stateStep` and `planCodeDelta` in `src/core/delivery/code-delta.ts` |
| The states a delivery reads: the failing ones, plus those of the files its view names | `statesFor` in `src/core/delivery/code-deliver.ts` |
| A registration seeds the failing states only | `seed`, `registerCode` in `code-deliver.ts` |
| `CodeViewRepo.list` skips a `pass` row an older hook wrote | `src/core/code/store/views.ts` |
| SessionEnd and the SessionStart sweep drop the session's views and told marks, and the views of every consumer no longer registered | `dropCode` in `code-deliver.ts`, called from `unregisterSession` in `src/harness/shared/sweep.ts`; `CodeViewRepo.retain` |
| The revision a consumer's code changes count after | `codeSeenUpTo` in `src/core/delivery/code-since.ts`; read by `tellCode` through `delivery.ts` (one line, coordinator agreement), and by `codeSince` and `consumerSince` |
| A transition or edit at or before it is taken in by count | `toldKind` and `standingEdit` in `code-delta.ts` (`CodePlanInput.seenUpTo`) |
| Titles | `codeTitleWords` in `src/core/delivery/code-format.ts`; `titleOf` in `format.ts` |
| The first count's status line | `codeStatusLines` in `src/core/status/code-status.ts` |

## Decisions the brief did not settle

1. **No re-seed: a revision bound.** "Seeded again, by count only, once the pass reaches it" is built as a bound, not as a second seed. `codeSeenUpTo` gives the registration revision, or the next revision when the registration has no `scanned` and that revision is a `start` one (the start scan of the daemon that the session's SessionStart spawned). A transition or edit at or before the bound is written to the view by count and never told. So the session's own edits that the same pass counts are still told, which a re-seed at "the pass reached it" would have swallowed. The same bound covers a revision that was stored before the registration but that the pass had not counted yet.
2. **The registration line can be one revision behind a catch-up** (coordinator, 2026-10-24, option (a)). It is said before the start scan, so in sq2 it says 80 when 81 are over. No line corrects it. After the catch-up the view, status (`81 over, 0 since this session started`) and `squeal code` agree.
3. **Where the bound reaches.** `codeSince` and `consumerSince` use it, so status's "since this session started", Stop's D7 block and `squeal code --changed` (W3's file reads `codeSince`) leave the catch-up out too.
4. **Limits of the start rule**, both rare. An agent edit made before the start scan ran (the first seconds after SessionStart) is absorbed into the scan's revision and taken in by count; 001-96 gives such edits unknown attribution for tests too. A daemon restart mid-session whose `start` revision is the registration's next one (so the session changed nothing before it, and the first daemon's start scan found nothing) is taken in by count as well.
5. **Rows an older hook wrote.** `views.list` skips `pass` rows, so a consumer seeded before this change pays nothing for its 16,000 pass rows. They are never rewritten. They go with `views.clear` at the next seed, and with `retain` at the next session sweep.
6. **Departed consumers.** C7's departed consumers (expired, gone harnesses, SubagentStop) lose their views at the next session sweep of any session (SessionStart with `startup` or `resume`, and SessionEnd). This happens only in the worktrees the main store lists; prune keeps the rest. Their `seeded:` and `tooBigTold:` meta keys stay, since the code meta repo cannot list keys; only the sweeping session's own keys go.
7. **A race with a registration in flight.** `registerCode` commits the code views inside the main store's registration transaction, so a sweep in another hook between the two commits can drop them. The next delivery then writes the failing functions to the view by count, silently. The only cost is that a STILL FAIL for an edit made in that window is not said.
8. **Title wording.** A code-only delivery: `SQUEAL · 1 complexity change and 2 functions still over the complexity threshold at revision 12`. Any other title (tests, baseline, liveness, a hold) is followed by `; ` and the same words. Recount and too-big lines are notes about files, not about functions, so the title does not count them, as before.
9. **The first count's status line.** `CodeStatus` has no first-count flag. The rule is "files still to count and none over". It gives D6's `Complexity: counting, 340 of 600 files.` during a first count. It gives the same line for the few milliseconds of an edit pass in a tree with nothing over. The JSON is unchanged.
10. **The timing test runs at any load.** `test/code/delivery/cost.test.ts` is not skipped under `LOADED`: it measured 45 ms against the 300 ms bound at load 37 to 44.

## Type changes

All are additive and in this row's files. Nothing in `src/core/types/` changed.

- `CodeViewRepo.retain(worktreeIds, consumers): number`, new. `CodeViewRepo.list` now skips `pass` rows (its doc says so).
- `CodePlanInput.seenUpTo: RevisionNumber | null`, a new required field of the delivery's internal plan input.
- `PlanEntry` exported from `code-delta.ts`. `CodePlan.entries` is typed with it (same shape).
- New functions: `codeSeenUpTo` (`code-since.ts`), `dropCode` (`code-deliver.ts`), `codeTitleWords` (`code-format.ts`). `codeChanges` no longer counts an `edited` entry.

## Measured

- PostToolBatch through the Claude Code hook, 20,000 functions (500 over), one code transition: 501 ms before, 42 to 48 ms after, at load 37 to 44.
- The same with 5,000 states that hold an edit (`states.edits` reads them all on each delivery): 77 to 80 ms. A later row can filter `edits` to the failing states in SQL. W1's pass tests read edits of passing functions, so this row left the query as it was.

## For the next rows

- `src/core/delivery/format.ts` was 471 lines before this row and is 481 now. `createDelivery.deliver.<transaction>` in `delivery.ts` is at complexity 44, over 20 before this row's one-line edit.
- Status still reads every state (`code-status.ts`) for `over` and `unknown`. It is a CLI read, and no hook calls it.
- The four bundle-drift tests fail until the candidate's build, as after every row of 015.
