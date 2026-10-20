# 001-431: a run without a recorder gets none from a Squeal around it

Use /worker. Shape: repair.

**Outcome.** `test/runners/vitest/observe-fidelity.test.ts` "names the recorder in a failure with its signature, and only under it" and `test/runners/node-test/run-reads-fidelity.test.ts` "names the recorder ... while it is in NODE_OPTIONS" pass under Squeal's daemon as they do under plain Vitest. Read 001 D11 (Fidelity: a verdict the project's own runner would not give, caused by Squeal's additions, is a defect to fix at its source) and the diagnosis on board row 001-431.

**Reproduce first.** Both fail under plain `npx vitest run -t "names the recorder" <both files>` with `NODE_OPTIONS="--import file://$PWD/plugins/claude-code/dist/observe/recorder.cjs"` and `SQUEAL_OBSERVE='{"out":"<tmp dir>","root":"<worktree>","skip":[]}'`. With `NODE_OPTIONS` alone, only the Vitest one fails. Rebuild that `dist` only in a scratch copy, never in your tree.

**Seams and leads.**
- `src/runners/vitest/observe.ts`, `adapter.ts`: when `observe` is off, the workers still inherit another Squeal's recorder and `SQUEAL_OBSERVE`. node:test's `projectEnv` (`src/runners/node-test/recorders.ts`) strips both. Do the same here.
- `src/runners/observe/spawn.cjs` `injected` / `foreign`: the outer recorder stands back only for another Squeal's `SQUEAL_OBSERVE` with an `out`. A Squeal run with `observe` off sets none, so its children get the outer recorder. One lead: such a run marks its subtree as its own, and the outer one stands back. Weigh it against D11's "chosen at every spawn".
- If the honest answer is the test's premise, change the test and say why in the handoff. Don't exclude it silently.

**Ownership.** You own `src/runners/observe/*`, `src/runners/vitest/observe.ts` and `adapter.ts` (env only), `src/runners/node-test/recorders.ts`, and those tests. These sources are key-format guarded: leave `KEY_FORMAT_VERSION`, its pin, versions, bundles, `docs/board.md`, `spec.md` and `status.md` alone. Name the guard failure in the handoff; the coordinator bundles the raise.

**Done when.** Both tests pass under the reproduction above and under `squeal run --all --wait`, and a test pins each path you changed. Every existing observe and fidelity test passes. The handoff names the source of each path and any D11 sentence that needs amending.
