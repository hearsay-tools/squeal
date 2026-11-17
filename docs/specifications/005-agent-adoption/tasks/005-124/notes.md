# 005-124: Stop lists the known states once

Wave 25 W2 (brief `tasks/wave-25.md`), from `research/boundary-hook-cost.md` section 3 and rank 3.

## What changed

`stopTurn` (`src/harness/shared/stop.ts`) calls `keepStates(context.store)` (`src/harness/shared/stop-states.ts`) once the hook has its store. That replaces the store's `knownStates` repo, for this hook call only, with one that keeps its last full list together with the worktree's states marker (`statesMark`, rows 011-44 and 011-45). A later full list reads the marker and returns the kept list while the marker is unchanged; else it lists again. A list for some files only, `untold` and `get` pass through.

It replaces the repo in place because the hook's delivery (`createDelivery` in `context.ts`) holds the same store object and reads `store.knownStates` at each call. So no file outside this row changes: `delivery.ts` (row 005-113), `context.ts`, `hook.ts` and `turn.ts` stay as they are. A new store object would lose the connection lookup (`connectionOf` is a `WeakMap` on the store), and the marker would then read `null`.

No type change. No text or decision change.

## The reads of one Stop, and why one list serves them

On main, a full `knownStates.list` of one Stop:

| Read | Where | Quiet | News | Block |
|---|---|---|---|---|
| The news | `delivery.onToolBoundary` (`deliver`, in its write transaction) | 1 | 1 | 1 |
| The failure line | `newsText` (`stop.ts`) | | 1 | 1 if news |
| The decision | `decide` (`readRequired`, in a read transaction); `holdsNow` too with required checks; `stoppedText` while the daemon is stopped by request | 1 | 1 | 1 |
| The turn end | `delivery.endTurn` (in its write transaction) | 1 | | |

Measured on main: quiet 3, news 3, block 3 when it has news and 2 without.

Can the states change between the reads inside one Stop? Yes. Only the daemon writes `known_states` (`state/sink.ts`), and it can commit between the hook's transactions: Stop waits up to `stop.waitMs` for pending checks before the news, waits for the waiting entry's record (`STOP_RECORD_WAIT_MS`) before the news or between two decisions, and decides up to `STOP_DECISIONS` times. So one list cannot serve all reads unconditionally. The marker makes it safe:

- The triggers move the marker in the writing transaction, on every insert, update and delete of the worktree's `known_states` rows, whoever writes. Equal marker means the same rows.
- The marker is read before the rows. Outside a transaction a write between the two can only pair an old marker with newer rows; the next read sees another marker and lists again. A new marker is never paired with old rows.
- Inside a read or write transaction (the news, the decision, the turn end) the marker and the rows are of one snapshot. The hook writes no `known_states` row; its own writes (views, turn state, holds) do not move the marker. If it did write one, the trigger would move the marker in its own transaction, so the next read would list again; the wrapper also drops its kept list on its own `upsertMany` and `removeMany`.
- Served (`SendingConnection`, spec 021 D15): the marker is a `meta` row the hook never writes, so the pending-meta overlay leaves it as the database has it.
- No triggers (a store no daemon with the write markers opened) or no marker row yet: every list reads in full, as on main.

Per read: the news reads first and lists. The failure line, the decision and the turn end get the same list while no state commit came in between, which is the case in which a fresh list would return the same rows; after a commit they list again and see it, as on main.

## Tests

`test/harness/stop-states.test.ts` counts the full lists through the real repo factory (a `vi.mock` of `createKnownStateRepo`):

- a quiet Stop, a Stop with news and a Stop that blocks (`stop.blockOnKnownFailures`, with news): 1 list each; on main 3, 3, 3 (red at revision 3 of this worktree);
- a write past the hook's repo (as the daemon's) moves the marker and the next list reads again and returns the new outcome; before it, the kept array itself is returned;
- without the triggers every list reads.

## Timing

`measure.probe.ts` (run: `timeout 900 node_modules/.bin/vitest run --config docs/specifications/005-agent-adoption/tasks/005-124/vitest.probe.config.ts`, `ROUNDS=9`): the real `runHook("stop")` on a worktree of 30,000 synthetic known states (300 files of 100 checks) plus one keyed file, triggers made. Quiet: nothing new. News: one file of 100 checks goes to fail before the Stop. Block: `blockOnKnownFailures` with one current failure, repeated (the first block with news, later ones without). Before = the same probe on a copy of `33d14059b` (`git archive`, `node_modules` linked). Two passes, interleaved before/after. The host was heavily loaded at the time: load average 34 to 42 on 24 vCPUs (other coordinators' work), so absolute times are high and noisy; compare within a pass.

| Pass, build | Quiet median (min to max) | News median | Block median | Lists (quiet/news/block) |
|---|---|---|---|---|
| 1, before | 1,108 ms (929 to 1,581) | 1,192 ms (1,099 to 2,968) | 476 ms (372 to 1,519) | 3 / 3 / 3 then 2 |
| 1, after | 434 ms (350 to 655) | 550 ms (434 to 777) | 386 ms (285 to 819) | 1 / 1 / 1 |
| 2, before | 1,012 ms (704 to 1,438) | 1,068 ms (881 to 1,738) | 651 ms (505 to 1,279) | 3 / 3 / 3 then 2 |
| 2, after | 410 ms (384 to 445) | 572 ms (508 to 673) | 368 ms (285 to 999) | 1 / 1 / 1 |

The quiet Stop gains most: its turn-end list also ran `plan` on all states (`endTurn`); with a kept list the plan still runs, the list does not. The block gains least because a repeated block without news listed twice, not three times.

## Left alone, for whoever continues

- Code states (spec 015): `tellCode` in the news and `codeStopReason` in `decide` (once per decision; a second decision after the waiting entry's record runs it again) read the code store. Row 015-127 (worker 5cff10f3) owns the code reads; not touched here, as the coordinator directed.
- `testFileKeys.list` is moved by the same marker and is read at the decision and in `stoppedText`; keeping it too would be the same few lines. Not asked by the row; not measured.
- The waiting entry (`stop-slow.ts`, its own hook) lists the states in its own process; it is not wrapped.
- `readLiveHeader` calls in the stop files: row 005-115.
