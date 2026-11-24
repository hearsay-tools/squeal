# Wave 25: `squeal ci export` across disjoint sharded Vitest project sets (#276)

Human instruction, 2026-11-24: fix GitHub issue #276 (`squeal ci export refuses combining two sharded Vitest suites (shardRefusal ignores project)`).

Every row: test first; read `squeal status --wait 60000 <changed-path>...` before finishing; no full suite; no `pnpm run build` in a worker tree; any direct vitest run gets `timeout 600`. Final message: commits, the tests that prove the row, decisions the spec did not settle, type changes.

## 018-78 `squeal ci export` validates Vitest shards per disjoint project set (#276)

Shape: slice. Spec 018 D9.

Today `shardRefusal` in `src/core/ci/export-check.ts` checks all Vitest parts as one shard sequence, so passing parts from two independent sharded Vitest suites (for example `1/8..8/8` for `server`, `web`, `contract`, `api-client` plus `1/8..8/8` or `1/1` for `e2e`) fails with duplicate shards or mixed shard counts.

Update `shardRefusal` so `squeal ci export` accepts Vitest parts from pairwise-disjoint project sets, each with its own complete, duplicate-free shard sequence `1/N..N/N`:
1. Each part's project set is the sorted unique `descriptor.project` names of `part.projects` (use `Map`/`Set` and `JSON.stringify` of the sorted names so arbitrary names like `""`, commas, or `__proto__` never collide).
2. With one project-set group, keep today's checks and refusal texts unchanged (including a single `projects: []` part as tested by `test/code/gate/parts-environment.test.ts`).
3. With multiple groups:
   - Refuse (`kind: "shards"`) if any group has no projects (`projects.length === 0`).
   - Refuse (`kind: "shards"`) if any project appears in two distinct groups (catches both overlapping multi-project runs like `[server, web]` + `[web, e2e]` and split-shard mismatches like `[a, b]` `1/2` + `[a]` `2/2` + `[b]` `2/2`), naming the overlapping project and conflicting parts/project sets.
   - Check each group's shard sequence (`1/N..N/N`, single count, no out-of-range index, no duplicate index, no missing shard) in deterministic order, prefixing refusals with the project set name while keeping the existing refusal phrasing inside the message.
4. Keep `duplicateRefusal` and `environmentRefusal` across all Vitest parts unchanged.

Starting seam: `src/core/ci/export-check.ts` (`shardRefusal`), `test/ci/export-check.test.ts`, and a real multi-project Vitest recording + export test in `test/ci/export-multi-project.test.ts` (recording two disjoint sharded Vitest project sets, including equal shard counts, different shard counts, an empty shard, and missing-shard refusal, and asserting the export equals `daemonExport`).

Owns: `src/core/ci/export-check.ts`, `test/ci/export-check.test.ts`, `test/ci/export-multi-project.test.ts`. Leave all other files alone (including `docs/`, `package.json`, `plugins/claude-code/dist`).

Done when:
- Unit tests in `test/ci/export-check.test.ts` fail before the fix and pass after it for disjoint equal-count suites, disjoint mixed-count suites, project-order invariance, missing/duplicate/mixed/out-of-range shard in one of two suites, overlapping project sets, split-shard counterexample (`[a,b] 1/2` + `[a] 2/2` + `[b] 2/2`), empty-project part mixed with named-project part, and `__proto__`/`constructor` project names.
- End-to-end test in `test/ci/export-multi-project.test.ts` records two independent sharded Vitest runs against a multi-project fixture with real `squeal ci record` + `squeal ci export` and proves the combined export matches `daemonExport` (keys, closures, environments, results, and D11 proof) and refuses a missing shard from either suite.
- `test/code/gate/parts-environment.test.ts`, `test/ci/export.test.ts`, `test/cli/ci-export.test.ts`, `pnpm run lint`, and `pnpm run typecheck` pass, and `squeal status --wait 60000` is clean for all changed paths.

Use /worker.
