# 004-16 notes: the slow end to end, and the slot under `XDG_RUNTIME_DIR`

For whoever continues (004-17 declares `test/e2e` slow; the coordinator rebuilds the bundles).

- The e2e runs the committed `plugins/*/dist`, not `src`. `slowSlotDir` (commit `fix(slow): 004-16 ...`) reaches the inner daemons only after `npm run build`; until then they take `/tmp/squeal-<uid>/slow.lock`, the slot a real daemon of the same user holds while it runs a slow file. The e2e passed without the rebuild because no outer daemon ran it as a slow file; under 004-17 it would wait on that slot.
- Scenario code is shared: `test/e2e/slow-shape.ts` (`fastFirstThenSlow`, `inheritsOnlyWithTheArtifactEqual`); each shape file only declares its `Shape`. Harness additions are additive options of `FixtureOptions` (`overlay`, `files`, `amendPolicy`) and `E2E.writeAt`, `E2E.settleFast` (settles the fast tier, slow files may stay pending through `slowPending`).
- The slow files spawn the built CLI rather than import it, so only the declared input keys them; with `inputs` removed the scenarios fail (checked once: the slow-tier line names no artifact, and the second worktree runs the slow file instead of inheriting it).
- The artifact is committed in the fixture, so `git worktree add` gives an equal artifact; the third worktree rewrites it (same behavior, new bytes) before its daemon starts.
- `slow.maxLoadPerCpu` is 1000 in both shapes: at the load this host had (57 to 130), the default 1.0 defers each file up to `slow.maxDeferMs`.
- `test/e2e/harness.ts` was already over 300 lines (349) and is 402 now.
