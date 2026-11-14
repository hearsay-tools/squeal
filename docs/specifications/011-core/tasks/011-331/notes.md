# 011-331: the status waits join the wait module, behaviour preserved

Worker e28cc221, 2026-11-14. Brief: `tasks/wave-85.md` W1. Record: `research/waits.md` (decisions 1 and 3, the coordinator's calls, "Not in scope"). Starts from rows 011-326 and 011-327 (`tasks/011-326/notes.md`, `tasks/011-327/notes.md`).

## Commits, one per step

| Step | Commit | What |
|---|---|---|
| 1, the table | `b2a252fd2` | The status waits' rows (`STATUS_WAITS`) beside `RUN_WAITS`; one chain walk in `decide.ts` for both tables; pure rows for every outcome of every status wait (`test/cli/wait/status-table.test.ts`), red first. |
| 2, one synced rule | `0c03b807a` | `passReached` (`wait/synced.ts`) replaces the copies of "has the daemon's pass reached this read" in the three waits, in place; pure rows (`test/cli/wait/synced.test.ts`). |
| 2, `unsynced` | `b1bac0e47` | `verdict.ts` `unsynced` delegates to `passReached`. Its own commit: the coordinator's answer to request bec0b099 gave me this one edit in `verdict.ts`. |
| 3, the loops | `e8b1ce72d` | The edit, named and snapshot waits' loops and reads move into `src/cli/wait/`; loop rows over a real store lock (`test/cli/wait/status-loop.test.ts`). |
| 3, listing | `982a5f702` | `status-wait-listing.ts` becomes `wait/listing.ts`, its SQL unchanged; `anyPending` moves beside it, still a copy of `isPending`. |
| 4, deleted cases | `11874737b` | The two decision cases the rows replace (below). |

## What moved

`src/cli/wait/`, still one entry file (`wait.ts`) and no barrel:

| File | What it holds now |
|---|---|
| `wait.ts` (entry) | Beside `runWait` and `untilTaken`: `statusWait(ask)`, a status wait by name (`edit`, `named`, `snapshot`); `pollStatus`, the one polling loop of the edit and named waits; `StatusPoll`, `PollStep`, `UnavailableEnd`. |
| `status-table.ts` (new) | The status waits' rows (`STATUS_WAITS`), their record (`StatusRecord`), conditions, outcome kinds (`StatusWaitOutcome`, `NamedWaitOutcome`, moved here), `STATUS_POLL_MS` and `SETTLE_MS`. |
| `decide.ts` | One chain walk (`walk`) over a vocabulary (the field each condition reads, and its predicate). `decideRunWait` and the new `decideStatusWait` both walk with it. |
| `synced.ts` (new) | `passReached`, `holdsPass`, `fallbackOf`, `selectionReady`: the one rule and its two gates. |
| `status.ts` (new) | The edit wait's read (`editPoll`) and types (`StatusWaitOptions`, `StatusWait`, `StatusWaitEdit`, `StatusWaitSlow`, `StatusWaitEnded`), from `status-wait.ts`. |
| `edit-window.ts` (new) | The edit wait's window reads (`readWindow`, `newsOf`, `heldAt`), split out of the read to keep the file under 300 lines; the statements are the old ones in the old order. |
| `named.ts` (new) | The named wait's read (`namedPoll`), `readiness`, `livenessOf`, `decidedOutcome`, `ownNamedFiles`, from `status-wait-paths.ts`. |
| `named-types.ts` (new) | `NamedWait`, `NamedWaitEnded`, `NamedWaitOptions`, `NamedSnapshotOptions`, unchanged. |
| `snapshot.ts` (new) | The snapshot (`namedSnapshot`): its sync wait, then its one read, from `status-paths.ts`. |
| `listing.ts` (moved) | `testFilesListed` (the raw SQL) and `anyPending`, unchanged. |
| `presence.ts` | New `judgeWait`: the daemon check of one read, which `presenceOf` and the edit and named reads all call. |
| `socket.ts` | New `watchOf`: the watch every wait but the snapshot builds; `REAL_PORTS.watch` calls it. |
| `stopped.ts` (new) | `stoppedText`, moved out of `presence.ts` (decision 8 below). |

The commands keep their names: `waitForStatus` (`status-wait.ts`), `waitForNamed` (`status-wait-paths.ts`) and `readNamedSnapshot` (`status-paths.ts`) are each one call of `statusWait`. `grep -n "for (;;)\|pollPause\|withStatusStore\|while (" src/cli/status-wait*.ts src/cli/status-paths.ts src/cli/named-print.ts` finds nothing.

The sync's own poll (`syncDaemon`, `status-sync.ts`) stays where it is. It asks the daemon for its pass, and the brief keeps that request as the waits read it. `squeal code` (`code.ts`, out of scope) calls it too. The module calls it through the waits' `sync` option, as before.

## The table

### Status waits (`STATUS_WAITS`)

The first rule whose conditions all hold ends the wait; with none, it goes on. A read fills every field of its record as before the move, except the hold, which the chain asks for when it reaches `held`.

| Cell | edit (`status --wait`, `run --slow --wait`'s file wait) | named (`status <path> --wait`) | snapshot (`status <path>`) |
|---|---|---|---|
| chain | store unread ∧ first read → unavailable; store unread ∧ late → unavailable; store unread → go on; news → news; settled ∧ daemon down → no-daemon; quiet → quiet; held → on-hold; late → timeout | the same three store rules; settled ∧ daemon down → no-daemon; decided settled / focused / unmatched / slow → that outcome; held → on-hold; late → timeout | store unread → unavailable; daemon down → no-daemon; decided settled / unmatched / slow → that outcome; held → on-hold; (always) → timeout |
| outcome order | news > no daemon > quiet > on hold > timeout | no daemon > decided > on hold > timeout | no daemon > decided > on hold > timeout, at its one read |
| `daemon` | wait view (`watchDaemon`) | wait view | heartbeat (`daemonLiveness`): alive or not |
| `unsupported` (a daemon that cannot sync) | after settle | after settle | never |

### Every difference between the six waits

| Difference | Status waits | Run waits | Where it is named |
|---|---|---|---|
| The settle time before "no daemon" | edit, named: 750 ms (`SETTLE_MS`); snapshot: none, it reads after its sync or the settle time | none (row 011-327, decision 4) | the chains: `settled ∧ daemon down` (edit, named), `daemon down` (snapshot); `SETTLE_MS` |
| The daemon reading | edit, named: wait view; snapshot: the raw heartbeat | wait view (row 011-327) | `STATUS_WAITS.*.daemon`; `judgeWait` for every wait but the snapshot |
| A daemon that cannot sync | edit, named: decides after the settle time; snapshot: never decides | the run waits do not sync | `STATUS_WAITS.*.unsupported`, read by `fallbackOf` into `passReached` |
| A read that does not read the store | edit, named: the first read and the deadline's end the wait as `unavailable` (exit 1); any failure between them is skipped; snapshot: either read ends it | a busy read goes on, and at the deadline's read ends as `unopened` (exit 3); any other failure ends at once (exit 3) | `SKIP_STORE` (`status-table.ts`) against `STORE` (`table.ts`); the exit codes stay in the commands |
| What "first read" means | edit: no read took the start view; named: no read went on (a read that asked runs keeps it first) | (none) | `StatusPoll.first`: the edit poll gives its own, the named poll takes the loop's |
| The pause | `pollPause`: ends at the sync's answer; no pause when nothing is left before the deadline | `ports.pause(min(1000, left))`, also 0 ms | the two loops, `pollStatus` and `runWait` |
| The deadline's clock | `performance.now()` since the start | epoch ms (`ports.now`) | the two loops |
| A sync before deciding | yes: the daemon's pass over the edits made before the wait (lessons, defect 30) | no (decision 5; row 011-332 reproduces it) | the reads |
| A newer revision ends it | no | checkpoint only | `RUN_WAITS` chains |
| A focused outcome | named only | no | the named chain |
| A lapse covered by the wait's own pass (row 011-286) | named only; edit: a lapse keeps it from quiet; snapshot: its heartbeat has no lapse | no | `readiness` (`named.ts`) |
| "Unavailable" | exit 1, the store's reason | `unopened`, exit 3 | the commands |

Common to all six, so not a cell: a read every 1 s (`STATUS_POLL_MS`; `STORE_POLL_MS` is now the same constant; the status waits' `pollMs` option is a test seam), and each read's busy timeout bounded by `readBound`.

## Copies made one rule

| Rule | The copies it replaced | One rule now |
|---|---|---|
| Has the daemon's pass reached this read | (1) `status-wait.ts` `isSynced` at quiet; (2) `isSynced` at the hold; (3) the window's `seen.header.revision >= window.revision` at quiet; (4) the same at the hold; (5) `status-wait-paths.ts` `readiness`; (6) `status-paths.ts` the snapshot's `ready`; (7) `verdict.ts` `unsynced` | `passReached(sync, revision, fallback)` and its comparison `holdsPass`; `selectionReady` adds the listing gate of a selection; `fallbackOf(row, settled)` reads the `unsupported` cell. `test/cli/wait/synced.test.ts` pins `unsynced` = `!passReached(…, !snapshot)` over every sync state. |
| A read's busy timeout | `status-wait.ts:244-249`, `status-wait-paths.ts:240-244`, `wait/presence.ts` `readBound` | `readBound`, in `pollStatus` |
| The daemon check of a read | `waitForStatus`, `waitForNamed`, `presenceOf`: the record, the clock, the stopping reading, `watch.judge` | `judgeWait` |
| The watch of a wait | `waitForStatus`, `waitForNamed`, `REAL_PORTS.watch` | `watchOf` |
| The chain walk | `decideRunWait`'s loop | `walk`, for both tables |
| The store poll | `STATUS_WAIT_POLL_MS` and `wait.ts` `STORE_POLL_MS`, both 1 s | `STATUS_POLL_MS`; `STATUS_WAIT_POLL_MS` stays exported as the same value |
| "Unavailable" | the unavailable member of `StatusWait` and of `NamedWait` | `UnavailableEnd` |

Moved unchanged, as the brief asks: the raw SQL of `testFilesListed` and `anyPending`'s copy of `isPending` (`wait/listing.ts`). `anyPending` reads a snapshot, `isPending` a header; it stays a copy.

## How the reads stay as they were

- Each read is the old callback, statement for statement, in the old order. Its outcome ternary became a record and `decideStatusWait`.
- The hold: the old code read it before the outcome, but only under a gate. The chain asks for it only when it reaches `held`. That happens exactly where the old gate read it:
  - Edit: the gate was `seen ≠ null ∧ ¬naming ∧ ¬quiet ∧ transitions = 0 ∧ daemon alive`. The chain reaches `held` only when news, `settled ∧ down` and quiet all fail. With a daemon that is down or lapsed, the read applies the old gate, which returns `null` with no store read.
  - Named and snapshot: the gate was `ready ∧ decided = null`. `ready` implies a daemon that is not down, so the chain always reaches `held` there; reached with `¬ready`, the read gives `null` with no store read.
- The end payloads are built after the decision, by the same statements, with their keys in the same order. Objects that go into `--json` are byte for byte the same.
- The edit read was split into `startSlow`, `readWindow`, `newsOf`, `heldAt` and `endOf`. Pure steps (`splitNews`, `windowRefined`, `heldPending`) keep their order. The start view is still set before the moves' commit and the slow files are read, so a read that throws after the start view still counts as not first.

## Deleted cases, each mapped to its rows

| Deleted case | File | Decision rows that replace it | Line rows |
|---|---|---|---|
| exits 3 while the daemon's pass is still pending, not 0 on the old result | `test/cli/status-wait-deadline.test.ts` | `synced.test.ts` "pending: never, even at the deadline", `selectionReady` "pending: never"; `status-table.test.ts` named "timeout: the deadline's read, its selection not decided"; `selection-result.test.ts` "the pass not stored, every file current (gh-88)" (exit 3) | `wait-again.test.ts` (the named wait's "has not stored its pass over the edits made before the wait" line) |
| exits 3 when the pass names a revision the store has not reached | same | `synced.test.ts` "synced, the read before it", `selectionReady` "synced, before the pass's revision"; the named timeout row; `selection-result.test.ts` "the pass past the results' revision" | `wait-again.test.ts` ("the daemon's pass is at revision 5") |

Not deleted, with the reason. Each also tests a read, a timing or a line that no pure row covers:

- `status-wait-deadline.test.ts` "keeps the settle-time fallback …": the read's `settled = final ∨ …` at the deadline is not in the table.
- `status-wait.test.ts` "times out rather than say quiet while the pass is not stored": quiet is false there through `naming` (a pending sync names no files), a read.
- `status-wait.test.ts` "is not quiet at the revision before the pass …", "waits the settle time …", "waits as usual for a daemon that comes alive …", "returns before the settle time …": the timing of the settle time and of the sync's answer.
- `status-paths.test.ts`: each case pins the snapshot's own line (the "pass is at revision 5" line has no other pin), its sync's timing, or `syncDaemon`'s reading of a missing socket.
- `hold-wait.test.ts` and the lapse, handoff and listing tests: the presence view, the hold reads, and their lines and JSON.

New loop rows (`test/cli/wait/status-loop.test.ts`, edit and named, a second connection's exclusive lock on the store, real time, about 1.3 s each):

- a first read that cannot read the store ends the wait at once;
- a later one is skipped, and the next read decides;
- the deadline's read waits the full busy timeout, then ends as `unavailable`.

I found no earlier test of the skip.

## Decisions the record did not settle, and my choice

1. **The entries keep their names.** `waitForStatus`, `waitForNamed` and `readNamedSnapshot` call `statusWait`; about 60 test files and the commands import them. Their types are re-exported as types from the old files: lint (`noBarrelFile`) forbids a value re-export. `STATUS_WAIT_SETTLE_MS` and `STATUS_WAIT_POLL_MS` stay values there, set from the table's constants.
2. **A status outcome is a kind, not an object.** The read that ends the wait builds what it returns, as before. The run waits' outcomes carry their fields because their commands word them from the fields alone.
3. **The options keep their seams.** The ask is plain data (the wait's name, `cwd`, paths, the deadline, the consumer). The functions in the options (`sync`, `now`, `promote`, `focus`, `ask`) stay where tests already set them; they are the status waits' ports. No stepped clock was added: `pollPause` and `performance.now()` stay as they were, so the loop rows run in real time.
4. **One loop for the edit and named waits.** The snapshot keeps its short sequence (its sync wait, then one read) in `snapshot.ts`, inside the module. A read's acts (`named`: ask runs, or a `--check` usage error) run after the read's transaction, with no pause, as before.
5. **`readBound` for the status waits.** It reads the clock once per read; the old code read it twice (`final`, then `left`). The effect is the same except when the deadline falls between those two reads, nanoseconds apart.
6. **The named wait's clock order.** The deadline (`options.now() + timeoutMs`) is read when the poll is built, just before the loop's start (`performance.now()`). It was read just after. These are two different clocks, and nothing compares them.
7. **`first` stays each wait's own** (the table above): an accidental difference, kept and named.
8. **`stoppedText` moved to `wait/stopped.ts`.** `presence.ts` imported `status-wait-lines.ts` for it. Once `status-wait-paths.ts` called the module, that import made a new import cycle (wait → named → presence → status-wait-lines → status-wait-paths → wait). The run commands change only their import line. The value-import cycles in `src/` are 9 before and after. The one through `store-writes.ts` existed before and now passes through `wait/named.ts`.
9. **The edit read split.** Its complexity was 67 inside `waitForStatus`. It is now 33 (`editPoll.read`), and the named read is 37 (`namedPoll.read`). Both are still over 20. Splitting them further means more read helpers, which a row that keeps reads unchanged should not take on.

## Calls of the record that did not hold as written

- **"Five copies" of the synced rule.** I found seven places, listed above. All have the same effect, so all became one rule.
- **The status rows join `RUN_WAITS`' table.** They are a second table (`STATUS_WAITS`) beside it, decided by the same walk. One record type would mix the run waits' fields (the end, the classes, the counts) with the status waits' (news, quiet, decided).
- **The table names every difference.** Some differences live in the loops, not in cells: the pause, the deadline's clock, the sync. The table above names them and where they live. Cells exist only where a read or the chain consults them.

## Type changes

- New in `wait/status-table.ts`: `StatusWaitName`, `StatusField`, `StatusCondition`, `STATUS_FIELD_OF`, `Decided`, `StatusRecord`, `StatusOutcomeOf`, `StatusOutcome`, `StatusRule`, `StatusRow`, `STATUS_WAITS`, `STATUS_POLL_MS`, `SETTLE_MS`.
- New in `wait/decide.ts`: `StatusStep`, `decideStatusWait`. Private: `Vocabulary`, `Walked`, `walk`. `GO_ON` is now `as const`.
- New in `wait/synced.ts`: `passReached`, `holdsPass`, `fallbackOf`, `selectionReady`.
- New in `wait/wait.ts`: `StatusWaitAsk`, `statusWait`, `PollStep`, `StatusPoll`, `UnavailableEnd`, `pollStatus`.
- New elsewhere in the module: `judgeWait` (`presence.ts`); `watchOf` (`socket.ts`); `StatusWaitEnded`, `EditConfig`, `editPoll` (`status.ts`); `Syncing`, `News`, `readWindow`, `newsOf`, `heldAt` (`edit-window.ts`); `NamedWaitEnded` (`named-types.ts`); `namedPoll` (`named.ts`); `namedSnapshot` (`snapshot.ts`).
- Moved, re-exported as types from the old file:
  - `StatusWaitOptions`, `StatusWait`, `StatusWaitEdit`, `StatusWaitSlow`: `status-wait.ts` → `wait/status.ts`.
  - `StatusWaitOutcome`, `NamedWaitOutcome` → `wait/status-table.ts`.
  - `NamedWait`, `NamedWaitOptions`: `status-wait-paths.ts` → `wait/named-types.ts`.
  - `NamedSnapshotOptions`: `status-paths.ts` → `wait/named-types.ts`.
- Moved, no re-export (no importer outside):
  - `decidedOutcome`, `ownNamedFiles` → `wait/named.ts`;
  - `testFilesListed`: `status-wait-listing.ts` → `wait/listing.ts`, with `anyPending` (it was private in `status-wait-lines.ts`, now exported);
  - `stoppedText`: `wait/presence.ts` → `wait/stopped.ts`.
- Changed:
  - The unavailable members of `StatusWait` and `NamedWait` are `UnavailableEnd`, the same shape.
  - `waitForStatus`, `waitForNamed` and `readNamedSnapshot` are no longer `async` and return the same promise types.
  - `STATUS_WAIT_POLL_MS` and `STATUS_WAIT_SETTLE_MS` are the table's constants, with the same values.
  - `verdict.ts` `unsynced`: same signature, its body delegates.
- Removed: `isSynced` (`status-wait.ts`).

## For the next worker

- **011-44** (fewer closure reads) and **011-45** (fewer state reads): the reads are now `wait/named.ts` `namedPoll.read` and `wait/status.ts` `editPoll.read` with `wait/edit-window.ts`. **011-49** (the snapshot's end time) is in `wait/snapshot.ts`. They stay planned (decision 7).
- **011-328** works in `wait/reads.ts` (`WaitFiles`). This row does not touch `reads.ts`. `wait.ts` gained imports and the status loop at its end, so a rebase meets at most an import line.
- **Group-wait edits (011-332):** the status waits' sync before deciding is the edit and named reads' `sync ??= …` at the first read. If 011-332 reproduces the missed edit, `passReached` is the rule a group wait would take.
- **Bundles:** this row changes CLI code, so the committed plugin bundles differ from the build. The coordinator rebuilds them on the candidate.
