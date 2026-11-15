# 011-361: the yield check's claim bookkeeping, read after the decision

Verdict: **proven**, in one narrow case, and fixed. The apply now records the claim facts the decision read.

## The question

Review `reviews/0.1.514-r2.md` N1. `TierYields.check` calls `decideYields`, then replays the bookkeeping list: for each claim note it called `Claims.holds(key, at)`, which queries `test_file_keys` again. The scheduler's lock does not hold another process's SQLite writer. A commit from another worktree between the decision's query and the replay's query can make the replay record a different claim fact than the decision used.

## What changes, case by case

`holds` records two things: the claim's first sight (`#seen`, where the waiter's bound starts) and the `waiting` flag. Only the store's `claimed` answer can differ between the two reads; `at`, the liveness window and `#seen` are the same. Let `P` be the first sight before the check, `c0` the decision's fact and `c1` the replay's.

| `c0` | `c1` | Replay before the fix | Same commit after the check | Visible? |
|---|---|---|---|---|
| held | gone | first sight dropped, `waiting` not set | `waiting` set; the next read drops the first sight | No: the claim ended; the decision's one-second recheck stands. The flag only opens a one-second claim wait. |
| gone | held, `P` absent | first sight `at`, `waiting` set | first sight at the next read | No: `at` is the time of the decision, at most the commit time; the claim exists. |
| gone | held, `P` present | **first sight `P` kept** | first sight dropped, then the next read's time | **Yes**, below. |

The third row: claim A was first seen at `T`. A ends with no result (its tier was cancelled, or its daemon's heartbeat lapsed), so the decision at `T + 500 s` reads no claim. Claim B, of the same key, commits before the replay. The replay keeps `T`, A's first sight, as B's. B's waiter bound then ends at `T + 606 s` (the default `runner.timeoutMs` plus `CLAIM_GRACE_MS`), not at about `T + 1,106 s`. From `T + 606,001 ms` the yield check reads the promoted file as free and the tier yields to it, and tier selection runs the file here while B still runs it: a duplicate run about 500 s earlier than the claim rule allows. The decision itself saw the claim gone, so a later claim must start a new bound (`Claims.taken`'s rule, and `holds` drops the first sight of an unclaimed key).

Before row 011-354 the decision's own `holds` call recorded what it read, so this case did not exist. It needs an exact interleaving: a claim with no result ends, and a new claim on the same key commits inside one synchronous turn of microseconds. It is rare. The effect, when it comes, is one duplicate run.

## The test

`test/scheduler/yield-replay-race.test.ts`. A `vi.mock` passthrough of `decideYields` runs a hook after the decision returns and before `TierYields.check` applies it. Two other worktrees, `wt-a` and `wt-b`, are registered on one fresh store with live heartbeats; their claims are real `test_file_keys` rows, `pending = 'running'`, so the real `claimed` query and its liveness filter answer.

1. The third row above: at `T + 606,001 ms` the decision must be `recheck` and `holds` must be `true`. Before the fix: the decision is `yield` (FAIL).
2. The same commits after the check: `recheck`. It passes before and after the fix; it is the serialization the fix must match.
3. The first row: the decision read a's claim held, the claim ends before the apply. The apply records the decision's fact, so `waiting` is set; the next read sees the claim gone and drops the first sight; a later claim gets a new bound. Before the fix: `waiting` is `false` (FAIL).

4. `Claims.record` over the fact a read took is `Claims.holds`: one script of claim facts (a claims, a ends, b claims, b at its waiter bound and 1 s past it, b ends), applied to two ledgers on two stores. One calls `holds`; the other takes the yield check's path, `readClaim` then `record` of its `claimed`. At each step the answers, the `waiting` flags and `peek` one millisecond on are equal, and the answers match the expected column (b's bound starts at its own first sight, `T + 300 s`, not a's).

Rows 1 and 3 were red without the fix (`git checkout src`, then the test) and green with it.

A real two-scheduler case was not added. The window is one synchronous turn, so two daemons can only meet in it by chance; the hook is the only way to place the commit there. The test uses the real shared store and the real query.

## The fix

- `Claims.claimed(key, at)` (new, read-only): the store's fact.
- `Claims.record(key, claimed, at)` (new): `holds`'s recording over a given fact. `holds` is now `record(key, claimed(key, at), at)`, the same behaviour.
- `Claims.peek(key, at, claimed = claimed(key, at))`: gains an optional fact.
- `readClaim` returns `claimed`, the fact it read (`false` without `asked`).
- `Bookkeeping`'s claim note carries `claimed`; `waitedFor` passes it.
- `TierYields.check` replays a claim note with `ledger.claims.record(note.key, note.claimed, at)`. No second query.

Each decision read now has one query, and its replay records that query's answer. Two notes for one key in one decision (the decision's read and the history's second read) keep their own facts, in order, as the inline `holds` calls did before row 011-354.

## Type changes (all additive)

- `Bookkeeping` claim note: `claimed: boolean` (required; only `waitedFor` builds one).
- `readClaim`'s result: `claimed: boolean`.
- `Claims.claimed`, `Claims.record`; `Claims.peek`'s optional third parameter.

The `TierYields` constructor and `check`'s signature are unchanged (W1's).

## The new write path

`Claims.record(key, claimed, at)` is the one place that writes a claim's first sight (`#seen`) and the `waiting` flag. Two callers reach it: `Claims.holds` (tier selection, slow slots, `claimOf`), which reads the store's fact first, and `TierYields.check`'s replay, which passes the fact the decision read. `Claims.claimed` and `Claims.peek` write nothing.

## Decision the brief did not settle

`Claims.record` is a method that writes, in `claims.ts`, where the brief gave this row read-only helpers only. I asked the coordinator (request `001d2218`). The coordinator answered: keep it in `claims.ts`, with `Claims.claimed` and `peek`'s optional parameter; `holds` keeps its behaviour through `record`; add a test that both paths give the same state for the same facts (test 4).
