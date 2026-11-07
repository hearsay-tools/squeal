# Wave 29: `squeal reach`, the edit-reach report (D11)

Approved by the human 2026-11-07 (task f3b0d84b): design D11, name `squeal reach`, coverage-off option A, rows dispatched. Coordinator f3b0d84b. 015-108 and 015-109 run in parallel on disjoint files. 015-114 runs after both are integrated and after wave 28 (coordinator 1f84ab15, the barrel refactor) lands. 015-115 reviews the candidate.

**For every row.** Read `docs/specifications/015-coverage-complexity/spec.md` D11, and `research/edit-reach.md` sections 2 and 5. Wave 28 (015-110) removes this repository's own barrels, and Biome then forbids them. So import from the defining module, never from an `index.ts` barrel. The coordinator rebases this wave onto wave 28 at integration. Use no full suite and no `pnpm run build` in a worker tree. Before finishing, read `squeal status --wait 60000 <changed paths>`, and run lint (`pnpm run lint`) and typecheck (`pnpm run typecheck`).

## 015-108 store the import edges and the Vitest environment file list

Use /worker. Shape: slice.

**Outcome.** When the Vitest adapter walks a closure, Squeal stores two things:
- each visited file's direct import targets, static and dynamic kept apart, by the file's content;
- each Vitest project's environment files.

It also exposes a reader for both. No key, `KEY_FORMAT_VERSION`, stored result or main-store `user_version` changes.

**Seam.**
- `src/runners/vitest/graph.ts` `importClosure`: keep `hop.targets` per visited file beside `bare.set`. Keep `transformed.deps` and `dynamicDeps` apart in `importTargets` before they are joined.
- Carry an optional field on `RunnerClosure` (`src/core/types/runner.ts`) from `adapter.ts` `closure()`. Persist it where `storeClosures` (`src/core/scheduler/revision.ts`) stores the closure.
- Store the edges in an additive main-store table that older daemons ignore. The code store's additive tables (`src/core/code/store/schema.ts`) are the pattern.
- Store the environment files (`environment.ts` `environmentFiles`) per project and environment hash.
- Key the edges by the content identity Squeal's keys already use. Settle which one; a stale edge set must never read as current.

**Contract that 015-109 codes against.** Put it in a new file you own, `src/core/store/import-graph.ts`:

```ts
export interface ImportGraph {
  /** Direct targets of `path` at its current bytes in this worktree; undefined when not recorded at those bytes. */
  targets(path: RelativePath): { readonly static: readonly RelativePath[]; readonly dynamic: readonly RelativePath[] } | undefined;
  /** The project's environment files for its current environment hash; undefined when not recorded. */
  environment(project: string): readonly RelativePath[] | undefined;
}
export function readImportGraph(store: Store, root: string, worktreeId: string): ImportGraph;
```

If the signature must change, message the coordinator before you commit it.

**Owns:**
- `src/runners/vitest/{graph,adapter,environment}.ts`
- `src/core/types/runner.ts`
- `src/core/scheduler/revision.ts` (only the store call)
- `src/core/store/schema.ts`
- new files under `src/core/store/`, including `import-graph.ts`
- tests under `test/runners/vitest/` and `test/store/`

**Leave alone:** everything 015-109 owns.

**Done when** tests prove each of these:
- edges are recorded with static and dynamic apart, and shared by content across two worktrees;
- a changed file reads `undefined` until its next walk;
- the environment list is recorded and read back;
- an older schema opens unchanged;
- `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass unchanged.

Report the store growth on a fixture, with the bytes per file.

## 015-109 `squeal reach`

Use /worker. Shape: slice.

**Outcome.** The command D11 describes, in full:
- the two ranked lists, the path kinds and the coverage split;
- the suggestions;
- the details shown when paths are named;
- `--limit` and `--json`;
- exit codes 0, 1 and 2;
- the no-history proposal (`squeal warmup`, the test file count and the cost);
- the coverage-off proposal (option A).

It runs no test, needs no daemon and writes nothing.

**Seam.**
- `src/cli/code.ts` is the model for the command's shape.
- `withStatusStore` (`src/core/status/open.ts`) with `codeSource` and `withCode` (`src/core/delivery/code-source.ts`).
- Trusted closures: `closureFor` and `closureTrust` (`src/core/delivery/closure.ts`).
- Seconds: `durationOf` with `results.byKey(key, 0)`, as `durations()` in `src/cli/warmup.ts` does.
- Coverage: `code.coverage.get` with `decodeRecord` at the current key. A source counts as called when a function other than the module's top level was hit.
- Observed paths: the `observed.`, `observedDirect.` and `observedModules.` meta maps.
- Declared inputs: `createDeclaredInputs` from `readPolicy(root).inputs`.
- Edits: `watch` revisions in which `HEAD` did not move, over every worktree.
- Manual groups are left out of the suite.

Put the analysis in `src/core/reach/` as pure functions over a snapshot type you define. Take the edges and environment files through a port with the shape of 015-108's `ImportGraph`, and use a fake in your tests. Without the port the pairs read `import`, unsplit, and environment pairs are absent. The coordinator resumes you to wire in 015-108's reader once it lands. Settle these against both research repositories' cases:
- which modules count as test helpers;
- when a module counts as "imports many siblings".

Use no fixed second or file limits.

**Owns:**
- `src/core/reach/**`
- `src/cli/reach*.ts`
- the `reach` entry and the HELP lines in `src/cli/main.ts`
- a new read method in `src/core/store/repos/` for revisions, if one is needed
- the three `plugins/*/skills/squeal/references/commands.md` (not `dist/`)
- `test/reach/**`

**Leave alone:** 015-108's files.

**Done when** fixture tests cover:
- each path kind and its suggestion;
- the coverage split, including `unread`, `no record`, `outside the test's process` and `unknown` for pytest and for coverage off;
- the test-file list;
- grouping by gateway;
- the no-history proposal;
- partial seconds;
- the coverage-off proposal;
- `--limit`, `--json` and the exit codes.

Then run the report from source against this repository's store, read-only, and give its wall time and the load at the time.

## 015-114 proof on squeal and cezar

Use /worker. Shape: finish (proof). This row is dispatched after 015-108, 015-109 and wave 28 are on the candidate.

**Outcome.** Run the candidate's `squeal reach` on squeal and on cezar, then write `lessons.md` "Edit reach, round 1". Copy each store with its `-wal` and `-shm` first, and keep both checkouts read-only.

The report must name what `research/edit-reach.md` found by hand, or explain each miss:
- squeal: the global teardown path (now gone after 015-106) and the barrels and `test/scheduler/helpers.ts` (changed by wave 28);
- cezar: `harness-parity.testkit.ts`, `runner-factory.ts`, `vitest.setup.ts` to `contract/src/waits.ts`, and the config's reporters. Cezar has coverage records (about 204,000 since 2026-10-28; correction from task 7d611fc4, 2026-11-07: `edit-reach.md` said it had none). So its run also answers the research's open question: what share of the engine's reach calls the edited file. Test the coverage-off proposal on a scratch clone whose `squeal.config.json` sets `"coverage": { "enabled": false }`.

Edges exist only after the candidate's daemon walks the closures. Use a scratch clone with a store copy, and state the load at the time.

**Owns:** `lessons.md` and `research/probes/reach-proof/`.

**Done when** `lessons.md` holds the following, and each defect becomes a proposed row in the final message:
- the comparison;
- the read time with the load at the time;
- the defects;
- whether the suggestions read as actionable.

## 015-115 review

Use /reviewer. Codex gpt-6.1-sol, effort high. Pin the review to the candidate SHA.

Check that no key changes and that the report writes nothing. Check the honesty of "unknown" and "outside the test's process". Check that the suggestions never call child-process or runtime-read seconds avoidable.

**Done when** `reviews/<version>.md` is committed with a verdict.
