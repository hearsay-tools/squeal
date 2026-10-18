# 011-18r worker notes: one key snapshot per registration

Date: 2026-10-18. Worker residue, not a spec. Supersedes the first bullet of `tasks/011-18/notes.md` on the row's shape.

- `registered-keys:<wt>` now reads `{ "snapshots": [ {testFileId: key} ], "slots": { "<session>\n<agent>": index } }`. A slot is `slot()` from `delivery/slots.ts`; `state/before-edits.ts` takes it as a string, since `state` does not import `delivery`.
- `recordRegisteredKeys(store, wt, slot, { resumed, kept })`: a fresh registration (or one whose parked slot expired) takes the worktree's keys now; a resumed one keeps its slot's snapshot, or has none (keys taken on return may hold its own edits). Every write keeps only slots in `kept` and re-indexes snapshots, sharing one per identical content.
- `kept` is `registeredSlots` in `delivery/registered.ts`: the registered row's slots (already pruned to live consumers by `writeSlot`) plus parked slots whose `leftTime` is within `CONSUMER_EXPIRY_MS` of the registration (S1).
- `beforeEditsFor(store, wt, slot, since)`: no snapshot for the slot, including a 0.1.217 by-revision row, reads `none` naming `since`'s head.
- Tests: `test/delivery/registered-keys.test.ts` (B1 two-consumer rekey, dedup, S1 fresh and resume, legacy row).
