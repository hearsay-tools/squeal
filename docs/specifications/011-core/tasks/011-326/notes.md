# 011-326: one wait module for the run waits, behaviour preserved

Worker 81156091, 2026-11-13. Brief: `tasks/wave-79.md` W1. Record: `research/waits.md`.

## What moved

`src/cli/wait/`, one entry file and no barrel:

| File | What it holds |
|---|---|
| `wait.ts` (entry) | `runWait(ask, ports)`: one polling loop for the three run waits. `untilTaken(ask, ports)`: one loop for the four request loops. |
| `table.ts` | The rule table: `RUN_WAITS` (one row per run wait) and `REQUEST_LOOPS`. Also the read record (`WaitRecord`) and each wait's outcome union. |
| `decide.ts` | The pure decisions `decideRunWait` and `decideRequest`. The table tests call these, never a copy. |
| `reads.ts` | `RunWaitAsk`, `WaitFiles` (lane, group or list), the field readers for each wait, `inStore` (moved from `run-lanes.ts`) and the lint counts (moved from `run-lint-group.ts`). |
| `progress.ts` | The progress reads (card 4's seam): checkpoint end, open checkpoint, latest revision, install wait with its command. They use today's parsers. |
| `socket.ts` | The ports (`WaitPorts`: `now`, `pause`, `ask`) with `REAL_PORTS`. `askWithin`, `socketBound` and `BEFORE_DEADLINE` moved here from `run-group-wait.ts`. |

The commands call the entry with plain data and word the outcome as before. `grep -n "sleep(\|for (;;)" src/cli/run*.ts` finds nothing.

## How the decision keeps today's reads

Within one poll, the old code read some fields only after earlier ones. Example: the checkpoint wait read the hold only while running before the deadline, and the verdict otherwise. One eager record per read would read fields that the wait does not read today, which review `0.1.403.md` B2 failed. So the decision is staged and still pure:

- It walks the row's chain. A condition on a field that the record does not have yet returns `{ kind: "read", field }`.
- The loop reads that field and asks again. The decision restarts on the larger record; the fields already read are not read again.
- Each row's `reads` cell lists the fields every poll starts with, in today's order (checkpoint: end, revision, late). This keeps the order where the chain would ask in another order.
- Conditions in a rule are evaluated left to right and stop at the first that fails. So `running, before deadline, held` reads the hold only when the first two hold, as before.
- The daemon field is read only after the store closed, as before (`inStore` closes it, then the ping).

## The table

Run waits (`RUN_WAITS`). The first rule whose conditions all hold ends the wait. With none, it goes on.

| Cell | checkpoint (`run --all --wait`) | group (`run <group> [<path>] --wait`) | lint group (`run <lint group> --wait`) |
|---|---|---|---|
| store | worktree's (`inStore`, 1 s busy timeout) | worktree's | none: the counts read opens the lint store (`withLint`) |
| reads | end, revision, late | classes, late | counts, late |
| chain | store unopened → stopped; newer revision → moved; abandoned → abandoned; running ∧ before deadline ∧ held → on hold; completed ∧ verdict settled → ended; late → deadline; ping due ∧ no daemon → stopped | store unopened → stopped; files pending ∧ before deadline ∧ held → on hold; files settled → ended; late → deadline (with install); ping due ∧ no daemon → stopped | lint off → off; lint unread → unread; late → deadline; nothing to lint → ended; ping due ∧ no daemon → stopped |
| outcome order | moved > abandoned > on hold > ended > deadline | on hold > ended or deadline | off, unread, then deadline > ended, then stopped |
| newer revision ends it | yes | no | no |
| what an unopened store means | stopped (accidental) | stopped (accidental) | unread (the lint store); off when lint is off or no git dir |
| socket bound (the ping) | unbounded: `askDaemon`'s 2 s, a timeout throws (accidental) | the deadline (`askWithin`): no answer goes on | the deadline |
| deadline payload | verdict | verdict, and the install when the worktree waits for one | counts |

Common to all three, so not a cell: a read every 1 s, and the last pause ends at the deadline (`min(1000, deadline - now)`). The deadline test is `now >= deadline`. The daemon check is a ping on every fifth read (`PING_POLLS`).

Request loops (`REQUEST_LOOPS`). Every loop checks in one order: no daemon (`null`), no answer, a wrong answer, taken, unknown group (`run-group` answers only), an error, then the deadline (`now > deadline`).

| Cell | `run-all` (`run.ts` recorded) | `run-slow` | `run-group` (`run <group>`, its narrow run, a lint group) |
|---|---|---|---|
| status request names | the first answer's id | the last answer's id | the last answer's id |
| a wrong answer (not ok, or another type) | stopped | refused, or unsupported for "unknown request type" | refused or unsupported |
| socket | unbounded: `askDaemon`, a timeout throws (accidental) | unbounded (accidental) | the deadline: `askWithin`; cut short by the deadline = pending |
| pause | 100 ms fixed | 100 ms fixed | at most what is left before the deadline |

`run <group>`, its narrow run and the lint group share one row. No cell differs between them; only their wording does, and the wording stays in the commands.

## Accidental differences and their cells

These stay as they were. Row 011-327 changes them.

| Difference (record, "Gaps open today") | Cell |
|---|---|
| `run.ts` pings and polls with `askDaemon` alone; `run-slow.ts` polls with it. A busy daemon throws a stack (exit 1). | `RUN_WAITS.checkpoint.socket = "unbounded"`; `REQUEST_LOOPS["run-all"].socket` and `["run-slow"].socket = "unbounded"` |
| A store that does not open reads as "the daemon stopped". | the rule `store unopened → stopped` in the checkpoint and group chains |
| A busy store throws out of the read. | `store: "worktree"` (`inStore` with no catch). Loop row "a busy store throws out of the wait" pins it. |
| The lint group gives no verdict at the deadline's read with nothing left to lint. | the lint chain checks `late` before `nothing to lint`. Pure row and loop row "deadline beats ended at the deadline's read". |
| The six outcome orders. | the three run-wait chains, in order. The status waits' three orders stay outside the module, as the record decided. |

## Deleted cases, each mapped to its rows

The table decides each of these cases now. The line and exit code each case pinned stay pinned in `test/cli/wait/lines.test.ts`. That file calls the commands' own `checkpointVerdictLine`, `groupVerdictLine` and `lintGroupVerdictLine`, which this row exports for it.

| Deleted case | File | Decision rows that replace it | Line row |
|---|---|---|---|
| exits 3 when a revision was recorded during the checkpoint | `run-all-verdict.test.ts` | table "moved: a newer revision", "moved beats abandoned and ended"; run-loop "moved: a revision recorded during the wait" | lines "moved" |
| exits 3 at the deadline with files pending, and the checkpoint goes on | `run-all-verdict.test.ts` | table "deadline: running at the deadline"; run-loop "reads once a second, the last read at the deadline" | lines "deadline"; also `run-all-verdict-daemon.test.ts` (Stay) |
| exits 3 when the checkpoint was abandoned | `run-all-verdict.test.ts` | table "abandoned", "abandoned beats deadline" | lines "abandoned"; the kept 001-403 case prints the full line |
| exits 3 and says so when the daemon stopped and the next one owes the checkpoint (001-219) | `run-all-verdict.test.ts` | table "stopped: the fifth read's ping found no daemon"; run-loop "stopped: the fifth read's ping finds no daemon" | lines "stopped, owed to the next daemon (001-219)" |
| exits 3 at the deadline with a file of the group pending | `run-group-wait.test.ts` | table group "deadline: a file pending"; run-loop "deadline at the last read names the install" | lines group "deadline" |
| exits 3 when the daemon goes away before the group's files have results | `run-group-wait.test.ts` | table group "stopped: the fifth read's ping found no daemon"; run-loop group "stopped" | lines group "stopped" |
| the whole group: names the install and its command, no run going on | `run-group-wait.test.ts` | table "deadline names the install the worktree waits for"; run-loop "deadline at the last read names the install" | lines "deadline while the worktree waits for an install" |
| bounds the run-group-status polls by the wait and exits 3 with the pending line | `run-group-stall.test.ts` | request-table "pending: the deadline cut the status request short"; request-loop "a status request the deadline cut short", "pauses end at the deadline" | the pending line stays in `run-group.test.ts`, `run-group-daemon.test.ts` and `group-pending.test.ts`; the lint form in `run-lint-group.test.ts` "bounds the daemon's discovery and the status polls" |
| goes on to the deadline when the wait's ping gets no answer | `run-group-stall.test.ts` | table group "go on: a ping with no answer within the deadline is a busy daemon"; run-loop "a ping with no answer within the deadline is a busy daemon" | lines group "deadline" |

Not deleted, with the reason:

- `run-lint-group.test.ts`: it has no stopped case and no on-hold case. Its deadline cases test which checks count as left to lint (the counts read, 019-26 B1, released checks), not the decision.
- `run-group-stall.test.ts` "bounds the run-group request by the wait" and "without --wait, words the 2 s socket bound": they bound the command's first request, which stays in the command.
- `run-all-verdict.test.ts` "waits out a re-run queued after the checkpoint completed": the record does not list it. It is the only end-to-end case of the go-on after completion.
- The narrow install case in `run-group-wait.test.ts`: it also pins the narrow answer's not-run line.
- `hold-wait.test.ts` (on hold): not a `run-*` file and outside this row.

## Decisions the record did not settle, and my choice

1. **Staged decision.** The decision returns "read this field" and stays pure, so each wait reads only what it read before, in the same order (above). The other choices broke a review rule: an eager record reads more (0.1.403 B2), and a decision that calls the store "reads the store itself" (rejected in decision 3).
2. **Reason.** An ended step carries the conditions of the rule that ended it. The commands do not print it yet. Row 011-327 can use it to name why the daemon stopped (an unopened store or no answer to the ping).
3. **First requests stay in the commands.** `untilTaken` takes the first answer. The lint group's first `askWithin` moved out of its loop function to just before `untilTaken`; the order and the words are the same.
4. **Three request rows, not four.** `run <group>`, the narrow run and the lint group differ only in wording. A cell exists only for a difference.
5. **`askBy` cell.** `run.ts` named the first answer's request id in every status request, the others named the last answer's. A daemon echoes the same id, so nobody can see the difference. It is kept as a cell, because it is a difference in what the loop sends.
6. **`>` and `>=`.** The request loops end on `now > deadline` and the run waits on `now >= deadline`. This is not a cell: it differs between the two kinds of loop, not within one.
7. **Line rows.** The deleted cases were the only tests of several lines (moved, the owed stop, the group stop, the install deadline). `lines.test.ts` keeps them pinned with no socket and no store wait.
8. **Loop row not written.** The unbounded socket's late answer (it throws after 2 s of real time) has no loop row. The table names its cell. 011-327 writes that row with the change.

## Type changes

- New: every type in `src/cli/wait/` (`RunWaitAsk`, `WaitFiles`, `WaitRecord`, `Condition`, `ReadField`, `Rule`, `RunWaitRow`, `RequestRow`, `CheckpointOutcome`, `GroupOutcome`, `LintGroupOutcome`, `OutcomeOf`, `WaitStep`, `RequestRecord`, `RequestOutcome`, `RequestStep`, `RequestAsk`, `WaitPorts`, `Unanswered`, `InstallHold`, `LintCounts`, `StoreField`, `FieldReader`).
- Moved: `askWithin`, `socketBound` and `BEFORE_DEADLINE` (`run-group-wait.ts` → `wait/socket.ts`). `socketBound` takes an optional `now`, and `askWithin` optional `ports`. `inStore` moved (`run-lanes.ts` → `wait/reads.ts`).
- Changed: `laneFiles(store, checkpoint)` → `laneFiles(store, worktreeId, lane | null)`.
- Newly exported: `checkpointVerdictLine` and `Joined` (`run.ts`), `groupVerdictLine` (`run-group-wait.ts`), `lintGroupVerdictLine` (`run-lint-group.ts`). The functions were renamed from the private `verdictLine`.
- Removed, now in the module: `run.ts` `Outcome`, `ended`, `pollCheckpoint`, `openCheckpoint`; `run-group-wait.ts` `Outcome`, `InstallHold`, `ownOf`, `ended`, `pollGroup`, `installOf`; `run-lint-group.ts` `LintCounts`, `LintOutcome`, `linted`, `readGroup`; `run-slow.ts` and `run-group.ts` loop bodies.

## Calls of the record that did not hold as written

- **"Which gone reading applies" as a cell.** All three run waits ping on every fifth read; they differ only in the socket bound. So the gone reading is one rule, `GONE`, in every chain, and the bound is the `socket` cell. Row 011-327 replaces the rule's condition with presence's wait view.
- **"What an unopened store means" as a cell.** It is a rule in the chain (`store unopened → stopped`), with the row's `store` cell saying which store a read opens.
- **The deletions in `run-lint-group.test.ts` and two of the four `run-group-stall.test.ts` cases.** They were not deleted (reasons above).

## For 011-327 and 011-328

- **011-327.** Change the cells above:
  - `socket` to `"deadline"` for the checkpoint, `run-all` and `run-slow`;
  - the `GONE` rule's condition to presence's wait view;
  - the `store unopened` rule's outcome (give the reason, exit 3);
  - a busy-store retry in the worktree store read;
  - the lint chain's order.
  The pinned rows to flip: run-loop "stopped: a store that does not open", "a busy store throws out of the wait", "deadline at the deadline's read, though nothing is left to lint"; table rows marked "accidental, 011-327".
- **011-328.** `WaitFiles` is the seam. The group reader's `ownOf` and the checkpoint reader's `laneFiles` are the two places that guess a request's files.
- **Bundles.** This row changes CLI code, so the committed plugin bundles differ from the build. `test/harness/opencode/package.test.ts` fails here ("cli/squeal.mjs differs from the build"). The other bundle tests may fail the same way. The brief keeps `plugins/*/dist` and `pnpm run build` out of this row, so the coordinator rebuilds them on the candidate.
