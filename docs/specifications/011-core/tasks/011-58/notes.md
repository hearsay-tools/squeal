# 011-58 and 011-57: worker notes (2026-10-21)

Brief W2 of `../wave-8.md`; spec 011 C6 and C15, 004 D2 and D8; `../../research/issue-61.md`, `../../../004-slow-suites/research/issue-58.md`. Base `f5ae8567`. The two `StatusSnapshot` fields in `src/core/types/status.ts` are by the coordinator's agreement of 2026-10-21 (option a); every other changed file is inside the brief's ownership.

## Seam map

- `src/core/status/phase-files.ts`: `pendingTestFilesOf`, the running and queued test files by the rule `countNotCurrent` (`src/core/state/file-class.ts`, guarded by the key-format seams, so not touched) counts them: pending by `fileClassOf`, running while an open run holds the file, its row says running or a check runs. `phaseLines` prints them.
- `src/core/slow/slot.ts`: `heldPermits` tests each of this repository's `slow.maxParallel` permits as `slowSlotHeld` does (a momentary `BEGIN EXCLUSIVE`) and reads a held one's `holder` row through SQLite's `immutable=1` URI. A plain read of a held permit fails with `database is locked`: `takePermit` keeps `locking_mode = EXCLUSIVE`. The URI reads without a lock on Node 22.23 and 24.21 (checked by hand); a Node whose `DatabaseSync` rejects a URL path would read every record as `unreadable`. Not checked on 22.13, the engines floor.
- `src/core/status/slot-holders.ts`: `slowSlotOf` reads the slot only while the live daemon's published slow activity is `waiting for slot` and slow files are pending, so no other status read touches the slot's directory. It groups permits by record (pid and worktree), so an idle tier holding several permits reads once with its count. `pidRuns` (`kill(pid, 0)`) marks a record whose pid does not run as `stale`. For a live holder this store records, the holder's own `readSlowTier` (slow keys and states only) gives its running files and pending count.
- `src/core/status/standing.ts`: a `slow` standing carries `slot` when `slowSlotOf` finds one; the snapshot passes its own result through `WorktreeReads.slowSlot` so it is read once. `next-step.ts` appends `; slow slot: ...` to the slow reason, not to `short`.
- `src/core/status/standing-groups.ts`: `groupId` reads a queued or unlisted standing's `yields`; `outstanding.ts` adds the revision's own unlisted line only when no group of its queued files says it.

## Decisions the spec did not settle

1. Placement: `Running:` and `Queued:` lines follow the full-suite checkpoint, owed checkpoint, `Slow tier:` and `Slow slot:` lines, just before `Outstanding:`. Between `Affected checks:` and the checkpoint they broke the vision example's four lines (C6: "reproduces the vision's example"; `status.test.ts` pins them).
2. The lists duplicate part of `Outstanding:`'s running and queued groups, by design: a group names three files, the 6-group cut can hide the running group, and slow files are in no group. The text names up to 10 running files and 5 queued; `--json` lists up to 100 of each phase in path order with `omitted`. `outstanding` in `--json` still lists every file of every group.
3. The holder line shows only while the daemon says it waits for the slot, read live; with every permit free it says the daemon takes one on its next pass. Time held is `now - since` of the earliest permit of the record (`heldMs`, also in `--json` beside `since`).
4. A holder of another repository (its worktree id not in this store) is named by its id; its running files and count are not known here and are not claimed.
5. `schemaVersion` stays 1: `pendingTestFiles`, `slowSlot` and the slow standing's `slot` are additive optional fields.

## For whoever continues

- The daemon's own note ("the slow slot ... has been held by another daemon of this user for over a minute") does not name the holder: it is written in `src/core/scheduler/slow-tier.ts`, outside this brief. `heldPermits` is what it would call.
- `standingsOf` still reads a file re-keyed while its run is open as queued behind its own tier, while the counts and `pendingTestFiles` read it as running (C15's "status counts the checks of a file whose run is open as running"). Not changed here.
- Tests that read status while the daemon waits for the slot must stub `XDG_RUNTIME_DIR` to a temporary directory (`test/status/slot-holders.test.ts`, `slow-tier.test.ts`), or the read probes the host's real permits.
