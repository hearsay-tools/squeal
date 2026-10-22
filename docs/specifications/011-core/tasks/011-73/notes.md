# 011-73: status, the hooks and the waits say a hold (notes)

Board row 011-73, R2 of `tasks/011-61/design.md` (section 4), spec 011 C6, C8, C9 and C15 as amended 2026-10-21. Brief: `tasks/wave-16.md`, W1. Baseline `009ccbb49` (0.1.268). Sibling: W2 (011-74, the hold command), in parallel.

## Seam map

| File | What it does now |
| --- | --- |
| `src/core/status/holds.ts` (new) | `readHolds(store, worktree, daemon, now)`: the merge hold from the live daemon's `merge-hold:` row (`readMergeHold` at the record's `startedAt`), then each `command-hold:` entry by start, as written. A command holder is `gone` when every process it recorded is gone (`harnessGone`, C8), `expired` when `until` passed. All the words: `holdLine` (status's `On hold:`), `holdVerdictLine` (a wait's), `onHoldText` (C15's reason), `holdStartText` and `holdEndText` (the hook lines). |
| `src/core/types/standing.ts` | `StatusHold`, `HoldChange`, and the `on-hold` kind of `Standing`. |
| `src/core/types/status.ts` | `StatusHeader.holds?` (so `StatusSnapshot`, `status --json` and the delivered header have it). |
| `src/core/status/snapshot.ts`, `standing.ts`, `outstanding.ts`, `next-step.ts`, `format-status.ts` | The snapshot reads the holds once and passes them to the standings. A `queued` or `slow` pending file reads `on-hold` while a hold holds (the first hold). Its group is printed after `unlisted`. `On hold:` lines follow the revision line. |
| `src/cli/verdict.ts` | `holdOfWait(store, id, keys, now)`: the first hold when one of the wait's rows is `queued`. It reads the hold rows first and the file rows only while on hold, so an idle poll stays cheap (C6, 011-42). |
| `src/cli/status-wait.ts`, `status-wait-paths.ts`, `status-paths.ts`, `run.ts` | The outcome `on-hold`, exit 3. `status --wait` decides it only at a read that holds its sync pass (the window's revision, or `isSynced` on the fallback path). The pass reads the index first (R1's `#handleBatch`), so `git add && status --wait` waits for the importers. The named wait and `status <path>` decide it at a `ready` read. `run --all --wait` decides it in `pollCheckpoint` while the checkpoint is open. |
| `src/core/delivery/hold-told.ts` (new) | The per-consumer `hold-told:<worktree>` slot (`WORKTREE_META_ROWS.holdTold`): one label per hold, `merge` or `command:<text>`. `holdsChange` judges only while the daemon is alive. |
| `src/core/delivery/delivery.ts`, `format.ts`, `header.ts`, `liveness.ts`, `expiry.ts` | At a tool boundary (`liveness: true`), a change of the labels is news: `Delta.hold`. `formatDelta` makes it the title when nothing else is delivered, else one line after the header. The registration and Stop (the full form) carry each `On hold:` line; the news form does not, so a hold is not said twice. Registration tells the holds; expiry forgets them. |
| `src/harness/shared/stop.ts` | Stop's wait returns at once while any hold holds. |

## Decisions the design did not settle, and the choice

1. **`holds` on `StatusHeader`, not only `StatusSnapshot`.** The registration header and Stop must carry the line. `StatusSnapshot extends StatusHeader`, so `--json` is the same. The coordinator agreed (requests 6cb411f5, ce184fd8).
2. **Which files a wait holds for "on hold".** A file is on hold when its row is `queued`. A file running in a tier that began before the hold is waited for (C9: that tier runs to its end). A slow file `run --slow --wait` holds for counts too.
3. **The order of outcomes.** news, then no daemon, then quiet, then on hold, then timeout. A wait whose files are all current ends quiet or settled even while on hold.
4. **The named file's reason names the first hold.** With a merge hold and a command hold, files read `on hold for the unresolved merge (...)`. Status lists both `On hold:` lines.
5. **The hook line and its labels.** The told state is the list of labels. Any change while the daemon is alive is one delivery: the first hold now (`on-hold`), or `resumed` with the last told cause and the queued and running counts from the header. A daemon going down is liveness's news, so holds are not judged then. Otherwise the merge row, trusted only from a live daemon, would read as "validating again".
6. **`expired`, not a clock in the words.** `readHolds` takes `now` and marks a command hold past `until`, so the formatters stay pure. `status --json` carries `gone` and `expired` beside the design's fields. Both are additive.
7. **`run --all --wait` on hold.** Its line is `Checkpoint <id> is queued and runs when the hold ends. On hold: ...`, exit 3. Its record wait needs no change: `requestFullSuite` queues the checkpoint at once while on hold.
8. **New files in `src/core/delivery/`.** `liveness.ts` was already 338 lines, so the told slot is `hold-told.ts`, beside `slow-told.ts`. The coordinator gave the whole directory to this row (request ce184fd8).

## Tests (R2's done-when)

| R2 test | Where |
| --- | --- |
| 1 (`On hold:` after the revision line, three paths and `and N more`, `holds` up to 50 with `pathCount`, no importer FAIL, the `Outstanding:` group) | `test/status/merge-hold.test.ts` (a real merge; 55 add/add conflicts for the cut) |
| 2 (the command, its pid and `until`, `squeal start`; `its command is gone`; a wrapper gone while the command lives still holds; C15's reason) | `test/status/command-hold.test.ts` (the row written by the test, as W2's writer will write it) |
| 3 (one line at the start, no FAIL; nothing next; one `validating again`; passes deliver nothing; the registration carries the line) | `test/delivery/hold-told.test.ts` |
| 4 (`status --wait`, `--json`, a named wait, `status <path>`, `run --all --wait`, each exit 3 on hold; `git add && status --wait` waits for the importers) | `test/cli/hold-wait.test.ts` (a real scheduler; a stand-in daemon whose `sync` runs the scheduler's pass) |
| 5 (Stop's wait returns at once; the control waits) | `test/harness/stop-hold.test.ts` |
| 6 (a dead daemon's row, a predecessor's row) | `test/status/merge-hold.test.ts` |
| 7 (every hook plugin, one line on hold, no FAIL) | `test/e2e/merge-hold.test.ts`: written and typechecked, not run here (it runs the committed bundle) |

## For the next worker and the coordinator

- **The e2e test runs the committed bundle.** Run `test/e2e/merge-hold.test.ts` on the candidate after `npm run build`. It conflicts `src/math.ts` on its counter comment line, so each side passes and only the markers would fail.
- **W2's command gate.** Until 011-74 lands, a command hold's row is shown but gates nothing. The hook line and the waits read the row as written, so after 011-74 a wait on a command hold returns at once with exit 3, as a merge hold's does. `test/status/command-hold.test.ts` writes the row in `CommandHoldEntry`'s shape (`hold-rows.ts`). If W2 changes that shape, `readHolds` follows the reader.
- **The hold line names `squeal hold` by the CLI command** (`SQUEAL_COMMAND` or Codex's path), as other lines name `squeal start`.
- **Not covered:** a command hold whose processes live in another PID namespace is never `gone` here (C8). Only `until` ends it, and status says `expired` then.
