# 011-354: the yield check split into decide and act

Worker 9e1d33bb, wave 100 W1, 2026-11-15. Base: `52232b673` (011-351 on main, 011-352 on cand/0.1.513, 011-353 not yet reviewed). Design: `../../research/scheduler-step.md`, "The yield split".

## What changed

- `src/core/scheduler/decide-yields.ts` (new): `decideYields(at, trigger, view)`. It is today's `#decide`, `boundOf` and the per-tier fold of `TierYields.check`, over one reading. `trigger` is the revision just stored, or `null`. `view` holds the context, the ledger, the tiers in flight, the marks (`#cut`) and the standings before the check, and `held`. It returns `null` while `held`; else one `TierDecision` per tier (decision, bound, the yield the history records), the marks after the check, the standings after the check, and `changed` (the row must be written). It never reads the context's clock: it gives its helpers a context whose `now` returns `at`, as `check` did. As first landed (`1a8d27434`) it was not pure: through `peekClaim` it wrote the claims' first-seen times and waiting flag, and through `focusedWaiting` it pruned expired focused entries (review 0.1.514 B1). Since the repair it writes nothing; see "Repair after review 0.1.514". `YIELD_REMAINDER_MS` moved here; `yields.ts` re-exports it, so its importers (`status/next-step.ts`, `status/tier-text.ts`) are unchanged.
- `src/core/scheduler/yield-waits.ts` (new): `waitedFor`, `rankToBeat`, `selected`, `recreates`, `unfinished` and `remainder`, moved unchanged from `yields.ts` so that `decide-yields.ts` stays under 300 lines.
- `src/core/scheduler/yields.ts`: `TierYields.check(context, ledger, tiers, revision, held = false)` reads the clock once, calls `decideYields`, and applies the answer: the marks and standings, then per tier in order the history entry, the quiet wait of a cancelled backlog tier, the abort and the bound; then the row and the wake. `yieldReach(event, view)` is the one exhaustive switch over `SchedulerEvent` (see "Which events reach the check").
- `src/core/scheduler/step-events.ts`: five event kinds, additive: `revision` (with the `Revision`), `runner-work-applied`, `request-taken`, `tier-started` (`runId`, `beside`), `file-ended` (`runId`). The sites pass them to `#cutTiers`; none is posted to the pump's `#events`, so the pump is unchanged until 011-356.
- `src/core/scheduler/scheduler.ts`: `#cutTiers(event)` asks `yieldReach` and either runs the check in this lock turn (`#checkTiers(trigger)`, which reads the `held` halt and passes it) or queues it (`#recheckTiers`, which adopts stored results and then calls `#checkTiers(null)`). The sites:

| Site | Before | After |
|---|---|---|
| `RunnerWork.applied` | `#cutTiers(null)` | `#cutTiers({ kind: "runner-work-applied" })` |
| `RequestIntake.cutTiers` | `#cutTiers(null)` | `#cutTiers({ kind: "request-taken" })` |
| `#pass` | `#cutTiers(applied.revision)` | `#cutTiers({ kind: "revision", revision })` |
| `startNext`'s `fly` | `if (tier.beside === true) #cutTiers(null)` | `#cutTiers({ kind: "tier-started", runId, beside })` |
| `#fileEnded` | `if (changes === 0 && !standsNamed) return; #recheckTiers()` | `#cutTiers({ kind: "file-ended", runId })` |
| `TierYields`'s bound wake | `#recheckTiers()` | `#cutTiers({ kind: "wake", reason: "yield-bound" })` |

## Which events reach the check (`yieldReach`)

| Event | Reach |
|---|---|
| `revision` | check in its lock turn, after that revision |
| `runner-work-applied`, `request-taken` | check in its lock turn |
| `tier-started` | check when `beside`; else none |
| `file-ended` | queued, adopting first, when the tier's inputs changed or it stands `named` (R398, review 0.1.296 B1); else none; none when the tier is no longer in flight |
| `wake` `yield-bound` | queued, adopting first (rows 011-107, 011-123) |
| any other `wake`, `asked`, `slot-ran`, `tier-ended`, `runner-work-drained`, `stalled`, `closing` | none |

## Decisions the design record did not settle

1. **Where "held reaches nothing" is read.** The record puts it in the switch. Today the hold is read in the lock turn the check runs in (`#cutTiers`), and the file-end filter at the file end, outside the lock. A queued check (a file end, a bound) reads the hold only when its lock turn comes, and it adopts stored results even under a hold. One switch read at the event would read the hold too early for a queued check: a hold that begins or ends between the event and the lock turn would change the answer, and the adopt under a hold would go. To keep behaviour exact, the hold is `YieldView.held`, read in the check's lock turn, and `decideYields` returns `null` for it (a table row). `yieldReach`'s comment points there. In 011-356 the step reads events and the hold in one lock turn, so the hold can move into the switch then.
2. **"claims" in "yield-bound and claims adopt stored results first".** Read as the claim recheck of row 011-123 (`RECHECK`, bound `CLAIM_RECHECK_MS`), which comes through the `yield-bound` wake. The `claims` wake reason (the queued files' claim poll) does not reach the check today and still does not.
3. **The tier of a file end.** The event carries `runId`, as `tier-ended` does; the switch looks the tier up among the tiers in flight. `#fly` sets the flight before the run and deletes it after its record, so a file end always finds it. A file end of a tier no longer in flight reaches nothing (a table row); before, the filter read the tier object and could queue a check that then checked only the other tiers.
4. **The apply order.** Before, tier 1's abort ran before tier 2's decision; now all decisions come first, then the aborts in the same order. No abort listener touches the ledger or the yields synchronously (the Vitest, node:test and pytest runners resolve a promise or kill a child; the test fixtures resolve a promise), so tier 2 reads the same facts.
5. **`check` keeps its signature** and gains an optional `held` (default `false`), so `tier-yields-ended-count.test.ts` and `promoted-tier-bound.test.ts`, which call it directly, are unchanged.

## Type changes (all additive)

- `SchedulerEvent`: five kinds (above).
- New exports: `decideYields`, `YieldView`, `YieldDecisions`, `TierDecision`, `Yielded`, `YieldDecision`, `Cut`, `holds` (`decide-yields.ts`); `waitedFor`, `rankToBeat`, `selected`, `unfinished`, `remainder`, `Beat`, `Waiting` (`yield-waits.ts`); `yieldReach`, `YieldReach`, `ReachView` (`yields.ts`).
- `TierYields.check` gains the optional fifth parameter `held`.

## Tests

- `test/scheduler/decide-yields.test.ts` (new): 11 `decideYields` rows (the context's clock throws on every row, so one reading is pinned) and 19 `yieldReach` rows, R398 a named row.
- Deleted from `tier-yields-bound.test.ts`, covered by `decide-yields.test.ts` rows:
  - "within its estimate the bound is estimate + 30 s too, so a stale estimate yields there" → "within its estimate the bound is estimate + 30 s, so a stale estimate yields there".
  - "files under SHARE_FLOOR_MS or of no known duration yield at the timer, 30 s past their estimate (row 011-112)" → "files of no known duration or under SHARE_FLOOR_MS are bound 30 s past their estimate (row 011-112)".
  - "a tier whose files have all ended arms no timer and never yields past its estimate" → "a tier whose files have all ended has no bound and never yields past its estimate".
- Kept in `tier-yields-bound.test.ts`, because they test what `TierYields` applies: the bound's wake firing the re-check that yields (case 1), the stored marks `cutPastEstimate` reads (case 4), one wake at the earliest bound cleared on end and close (case 6).
- `tier-yields-clock.test.ts`: no case deleted. All three drive a real scheduler (`catchUpSide`) and pin the published standings and the reading count of `check` (2: the decision's and the row's), which the apply keeps. The table's throwing clock pins the decision's side. Deleting them is a coordinator call; I left them as tests that drive a scheduler.

## Checks (2026-11-15, revision 13 = `0c5aa64f6`)

- `squeal status --wait 60000` on the seven changed source and test paths: 934 affected test files current, 930 pass, 4 fail. The 4 are the bundle-drift checks (`test/harness/plugin.test.ts`, `codex/packaging/runtime.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`: "cli/squeal.mjs differs from the build"). Expected: the brief forbids `pnpm run build`, and `plugins/*/dist` is the coordinator's.
- Among the passes: `model-scheduler.test.ts` (run by Squeal at one-minute load 6 to 9 on 24 CPUs), `test/keys/key-format.test.ts` (no version raise), every `tier-yields-*.test.ts`, `promoted-tier-bound.test.ts`, `decide-yields.test.ts` (30 cases).
- `pnpm run lint`: 3,513 files, no fixes. `pnpm run typecheck`: exit 0.

## Repair after review 0.1.514

Review `reviews/0.1.514.md` (FAIL, B1, proven): `decideYields` changed the live ledger. `peekClaim` called `Claims.holds`, which records a claim's first sight (`#seen`), sets `waiting` and drops an ended claim; `focusedWaiting` called `FocusedEntries.waiting`, which drops waiting entries past their deadline. A discarded decision at `T` made a later one at `T + 606,001 ms` yield where an untouched ledger rechecks.

The repair (`fc69690d3`):
- Read-only reads added beside the writing ones; the writing ones are unchanged and still used by tier selection, slots and the pump:
  - `Claims.peek(key, at)` in `claims.ts`: `holds`'s answer at `at` with nothing recorded.
  - `readClaim(context, ledger, ref)` in `claims.ts`: `peekClaim`'s answer through `Claims.peek`, and `asked`, the key whose claim `peekClaim` would have recorded.
  - `FocusedEntries.peekWaiting(now)` in `focused-entries.ts`: `waiting`'s entries, none dropped.
  - `readFocused(context, ledger, where)` in `focused.ts`: `focusedWaiting`'s answer through `peekWaiting`, and `read`, whether it would have read the entries.
- `waitedFor` takes a `notes` list and pushes, in read order, `{ kind: "claim", key }` for each claim it read and `{ kind: "focused" }` when it read the focused entries. Both of its calls push: the decision's and the second, for the history's `to`, after the tier's own cut.
- `YieldDecisions.bookkeeping` returns that list. `TierYields.check` replays it before it applies the tiers' decisions: `ledger.claims.holds(key, at)` and `ledger.queue.focused.waiting(at)`, at the decision's reading. Before, these writes happened during the decision, so before the first tier's abort; they still do.
- Why the replay is exact: within one decision every claim read is at the same `at`. `Claims.peek` answers as `holds` would at the first read, and a repeated read at the same `at` gives the same answer either way: a first sight records `at`, so `at - since` is 0; an unclaimed key stays unclaimed. Nothing else the decision reads looks at `#seen`, `waiting` or the dropped focused entries: `peekWaiting` already leaves out the entries `waiting` would drop. The replay's `holds` reads the store's claims again in the same synchronous turn; nothing in between writes `test_file_keys`.
- Tests (`decide-yields.test.ts`, 4 new rows): the review's three reproductions (a discarded decision leaves `waiting` unset; starts no claim bound, so at `T + 606,001 ms` both ledgers decide `recheck`; prunes no focused entry), red before the fix, and one row that `TierYields.check` applies the bookkeeping (`waiting` set, the focused entry gone, the claim bound started at `T`).
- Type changes, additive: `Bookkeeping` (`yield-waits.ts`), `YieldDecisions.bookkeeping`, `waitedFor`'s `notes` parameter, `Claims.peek`, `readClaim`, `FocusedEntries.peekWaiting`, `readFocused`.

Checks after the repair (revision 20 = `fc69690d3` plus these notes; the source is that of revision 19):
- `squeal status --wait 60000` on the 32 named test files (`claims*`, `focused*`, `named-wait*`, every `tier-yields-*`, `decide-yields`, `promoted-tier-bound`, `model-scheduler`, `key-format`): all current, no failure, at revision 19. `model-scheduler.test.ts` ran in this worktree at revision 19: PASS, 12.9 s, one-minute load about 7 on 24 CPUs. `decide-yields.test.ts`: 34 cases; its three reproduction rows went FAIL -> PASS.
- `squeal status --wait 60000` on the 7 changed source and test paths: 936 affected test files current, 932 pass, 4 fail. The 4 are the bundle-drift checks, as before (no build, `plugins/*/dist` is the coordinator's).
- `pnpm run lint`: 3,513 files, no fixes. `pnpm run typecheck`: exit 0. `test/keys/key-format.test.ts` passes without a raise.

## For the next worker (011-356)

- `#cutTiers` and `#recheckTiers` remain; the step replaces them. `yieldReach`'s `check` rows become the in-turn rule, `adopt-then-check` the queued one; the hold can join the switch once the step reads it in the same turn as the events.
- The five new event kinds are never posted to `#events`; the step posts them.
