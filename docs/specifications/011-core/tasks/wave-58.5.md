# Wave 58.5: repair of row 011-265 (review 0.1.377 B1)

Coordinator 32184dd1, 2026-10-29. One repair on the candidate `cand/0.1.377`. Host policy as wave 58: no full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private fixtures; controlled clock. Not yours: the board, spec text, `status.md`, bundles, version. Bundle-drift failures in your tree are expected.

## R1: a promoted-only tier runs on for an edit only while a file of it has an open wait

Use /worker. Shape: repair.

Outcome: a queued edit no longer hides a later wait's yield, and a tier's published reason is true after its promotion expires.

Read: `reviews/0.1.377.md` B1 and S1 (with its reproductions); `tasks/011-265/notes.md`; spec 011 C4 step 5 and C15 Rank as amended 2026-10-28.

Rule (coordinator): the edit exemption's reason, "the cut files would go back promoted and run first", holds only while an unfinished file of the tier has an open promotion (`Beat.files` rank not null). So:
1. In `waitedFor` (`src/core/scheduler/yields.ts`), for `tier.promoted === true` with such a file, queued edit work does not return `edit`; the promoted, focused and runner checks run as for any tier. If nothing else counts, return `named`. Remove the override at `yields.ts:292`.
2. With no such file, the tier is an ordinary backlog tier: `cancelsBacklog` applies (an edit cancels it). Pass what it needs; keep the exemption in `backlog.ts` under the same condition.
3. The tier is decided again when the last open promotion of its files reaches its deadline (reuse `Beat.until`).
If `named`'s text is still not true in some case, ask me before adding a standing kind.

Owns: `yields.ts`, `backlog.ts`, `promoted-tier.ts`, `test/scheduler/promoted-tier*.test.ts`, a new status test if needed, `tasks/011-265/notes.md` (add a "Repair R1" section with the spec sentence to change).

Done when: B1's paired test (expired promotion, later wait B099, with and without an unrelated edit) yields both times; after expiry with an edit alone, the tier is cancelled and its standing is not `named`; with an open promotion and an edit alone it runs on and stands `named`; S1's 4-slot case is a test, and the notes state the next-tier claim's precondition; existing scheduler tests pass; lint and typecheck pass.
