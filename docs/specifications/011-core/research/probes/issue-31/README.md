# Probe: issue 31 (edited fast test behind broad dependent suites)

Throwaway. Not product code, not a test the suite runs.

`order.mjs` loads the real `src/core/scheduler/queue.ts` and `src/core/scheduler/sharing.ts`
through Node's type stripping, with `hooks.mjs` mapping `.js` imports to `.ts` and stubbing the
two leaf imports `queue.ts` needs (`compare` from `src/core/fs`, `testFileId` from `src/core/keys`,
copied verbatim). It builds the queue an edit to a shared source file leaves, orders it as
`Ledger.ordered` does (`durationOf` = last-known `durationMs`), and greedily packs edit tiers the way
`selectTier` does for a non-backlog tier (`runner.tierSize` 4, `joinSpan`). Lanes, claims, lookups,
the runner part and capacity are not modelled.

Run (no install needed; Node 24):

    node --import ./docs/specifications/011-core/research/probes/issue-31/register.mjs \
      docs/specifications/011-core/research/probes/issue-31/order.mjs [path/to/src]

Default `src` is this checkout's `src/`. Pass an extracted 0.1.199 tree's `src` to compare.
