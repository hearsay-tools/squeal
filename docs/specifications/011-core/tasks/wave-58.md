# Wave 58: row 011-265 (gh-79, gh-121)

Coordinator 32184dd1, 2026-10-28. One row. The human chose "Larger groups" (decision card, 2026-10-28) after `research/issue-79-gate.md`. Host policy (2026-10-25): no local full suite, no `squeal run --all`; affected results through `squeal status --wait 60000 <paths>`; every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; private `/tmp` fixtures only; never make CPU load on purpose; no real parity or cezar tests. No `pnpm run build`. Not yours: the board, spec text, `status.md`, bundles, version.

## W1: row 011-265 (a tier of promoted files only is sized as the backlog's)

Use /worker. Shape: slice.

Outcome: when the queue holds promoted files and no edit's work, the next tier takes them at the backlog's size (wall budget at the grant), not 4 at a time, so a 56-file named wait ends in about a third of today's time.

Read: the board row; `research/issue-79-gate.md` (Method's option B, Findings, Recommendation 1); spec 011 C4 steps 4–5, C10, C15 Rank; `status.md` 2026-10-28 lines.

Seam and lead: `selectTier` (`src/core/scheduler/tiers.ts:205`) sizes a tier as the backlog's only when `hasFirstGroup` is false. The probe's B (`research/probes/issue-79/gate.probe.ts:46`) makes promoted-only work read as no first group during selection and orders promoted files only. Build that rule in the product, as the probe measured it: the tier takes a grant and waits on the pool, an edit cancels it as it cancels a backlog tier, and it does not count toward the four first-group tiers before the backlog's turn. If a rule must differ from the probe, ask me first with the reason.

Owns: `src/core/scheduler/tiers.ts`, `queue.ts`, `backlog.ts` and a new helper beside them, their `test/scheduler/` tests, and `tasks/011-265/notes.md`. Also the comment at `test/scheduler/tier-yields-next-tier.test.ts:23`: state the amended time rule (review `reviews/0.1.375.md` N1). Leave `yields.ts` and `yield-sooner.ts` alone unless you ask.

Done when: a scheduler-fixture test of 56 promoted files beside a backlog shows one wide promoted tier where today forms tiers of 4; an edit's work queued still gets tiers of `runner.tierSize`; a test shows an edit cancelling a promoted-only tier; existing scheduler tests pass or each setup change is named in the notes; the notes give the C4 step 5 sentence to amend; lint and typecheck pass.
