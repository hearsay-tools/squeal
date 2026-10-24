# 015-39 notes: a too-big edit's provenance

Worker f0ed5308, 2026-10-24. Brief: `tasks/wave-3.md` W1. Review `reviews/0.1.297-r2.md` N1.

## As built

- Code meta `tooBigEdits:<worktreeId>` (`src/core/code/pass/too-big.ts`): `[path, revision]` pairs, each file too big to count with the revision of its last edit. It replaces B5's `RecountRecord.tooBigEdits`, which the next recount overwrote.
- The pass writes it in its first transaction, before the files rows (`writeTooBigEdits`). A too-big entry whose path a revision after the cursor changed, and whose blob is not its stored row's, gets that revision. A path of the work set that is not too big leaves the record. A first count (`reason === "first"`, or no cursor) clears it: its revisions can be another main store's, and no row before it is an edit.
- The revision is the change's own, from `PassSource.lastChanges(after, upTo)`, new (`source.ts` over `revisions.range`; the fake in `test/code/pass/helpers.ts`). So an edit before a registration that a later pass finds is not the session's, whether that pass is an edit pass or a recount.
- Delivery (`newTooBig`, `code-deliver.ts`) tells a too-big row whose recorded revision is in the session's bound (`isOwn`), once per session as before; it no longer reads the row's revision or the latest recount.

## Tests

`test/code/delivery/too-big.test.ts`: the review's two probes, with sessions on both sides of the edit; they failed before the change as the review reports. `test/code/pass/source.test.ts`: `lastChanges` from the main store. `test/code/delivery/delivery.test.ts`'s too-big test writes the record as the pass does.

## Type changes

`PassSource.lastChanges` (required; two implementers, both owned). `RecountRecord.tooBigEdits` removed; a stored record that has it is read as before, the field ignored.

## Limits

- An edit that a pass's revisions made and undid (same blob as the stored row) is not recorded. Before, an edit pass told it.
- A store from 0.1.297 has no record: a too-big edit counted before the upgrade and not yet told is not told after it.
