# Review: wave 9, 001-81 (task 001-82)

Reviewer task 001-82 for spec 001, 2026-10-07. Range `351ef21..34d88dc`, the 001-81 commits:

- `4597b5d`: the root `package.json` picks every closure (S2).
- `72d2f00`: Vite's package data is dropped, and unmoved manifest edits are skipped (S1, S3).
- `8e95d59` and `b8bbebd`: the S3 tests.
- `5df03bd`: D3, D4 and `status.md`.
- `34d88dc`: the dist rebuild, version 0.1.5.

I read them against `reviews/wave-9b.md` S1 to S3, N1 and N2, the 001-81 brief, D3 and D4 as amended, and Vite's package cache in the installed Vite (8.3.2) and in the other versions Vitest 5 accepts (`^6.4.0 || ^7.0.0 || ^8.0.0`). This is the second and last round on the 001-79 slice. I did not re-check what `wave-9.md` and `wave-9b.md` list under "What fits".

## Verdict

**FAIL at `34d88dc`.** Counts: 1 blocker, 2 should-fix, 5 nits.

- **`wave-9b.md` S1 is closed.** An edited, added or deleted `imports` map moves the warm closure and the warm run. That covers a workspace package (E5), the root (E6), and a nested manifest that shadows the root's.
- **S2 is closed with option (b).** The root manifest picks every test file. E6 and E7 are runner cases with the run outcome asserted.
- **N1 and N2 are closed.**
- **S3 is closed for the edit it names**, a `scripts`-only edit. But the filter behind it introduces a regression (B1). It compares six fixed fields, and Vite resolves through any field in `resolve.mainFields`. A project that configures one gets an edit of that field skipped. The warm instance then keeps the old entry, and Squeal keeps the old result as current.
- **The read of `packageCache` is sound in every Vite that Vitest 5 accepts.** The fallback when it is missing is silent (S1).
- **The importer rule is sound and needed.** It is the only rule that catches an added nested manifest whose `#x` target lies outside its directory.

## Verification

The branch HEAD is `73c7a91`, one commit past the candidate. That commit changes only `docs/board.md` and `tasks/wave-9.md` (N4), so the code under test is the candidate's. I ran everything in this worktree at `73c7a91`.

```
$ git rev-parse HEAD
73c7a91532c17f125fff767a4900da09f2b525b0
$ git show --stat 73c7a91
 docs/board.md                                     | 3 ++-
 docs/specifications/001-core-loop/tasks/wave-9.md | 4 ++++
$ npm ci
npm warn install-scripts ... (exit 0)
$ npm run lint
Checked 349 files in 84ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
 Test Files  118 passed (118)
      Tests  895 passed | 7 skipped (902)
   Duration  49.52s
```

Mutations. I ran `reresolution.test.ts` and `test/keys/resolution.test.ts` for each one, and reverted it before the next:

| Mutation | Fails |
|---|---|
| M1: no `pluginContainer.watchChange` call (`stale.ts:80`) | 3: the workspace `imports` edit (E5), the root `imports` edit (E6), the nested `imports` manifest deleted |
| M2: no `fnpd_` scan, which is what a missing `packageCache` does (`stale.ts:82`) | 1: the nested `imports` manifest added |
| M3: no importer rule (`stale.ts:191`) | 1: the nested `imports` manifest added |
| M5: no root branch in core (`resolution.ts:59`) | 3: the unit row, E6, E7 |
| M6: `resolutionMoved` always `true` (`stale.ts:111`) | 0 in these files. The cost guard in `structural-cost.test.ts` pins S3. The B1 probe below passes under M6. |

## Probes

All probes ran in one throwaway test under `test/runners/vitest/`, deleted before this commit. Vitest runs each test twice (two root projects), and both samples are given. The machine was loaded. This round's warm walk of 200 closures took 156 to 228 ms. In `wave-9b.md` it took 128 to 137 ms.

### Cost on the 1,000-module fixture

This is `structural-cost.test.ts`'s graph, with `src/gen/package.json` (`name`, `type`, `scripts`). For each manifest I used a fresh fixture. The steps:

1. A cold `affected`, then a walk of all 200 closures.
2. A plain edit of `src/gen/m999.ts`.
3. Four `scripts`-only edits of the manifest. Each one was followed by `invalidate`, `affected([manifest])`, and a re-fetch of all 200 closures, which is what core picks for both manifests.

| Measure | Root `package.json` | `src/gen/package.json` |
|---|---|---|
| Cold `affected` | 2,618 / 2,482 ms | 2,632 / 2,340 ms |
| Warm walk of 200 closures | 180 / 228 ms | 156 / 175 ms |
| `affected` after a plain edit | 55 / 45 ms | 26 / 45 ms |
| **First edit after a start**: `affected` | **978 / 1,072 ms** | **785 / 598 ms** |
| First edit: closures re-fetched | 201 / 188 ms | 169 / 146 ms |
| First edit: total | **1,189 / 1,269 ms** | **964 / 775 ms** |
| Later edits: `affected` | 20 to 37 ms | 13 to 23 ms |
| Later edits: closures re-fetched | 174 to 261 ms | 134 to 155 ms |
| Later edits: total | **201 to 321 ms** | **153 to 215 ms** |

How to read it:

- **The root `scripts`-only edit costs one warm walk of every closure.** That is about 0.2 s here, and about 130 ms at `wave-9b.md`'s load, which matches the worker's estimate. Core pays it, not the runner: `affected` stays near a plain edit.
- **The first edit of each manifest after a start** re-transforms every module with an import under its directory. That is 0.6 to 1.1 s here, or 25 to 45 percent of the cold `affected`. For the root, it is the whole graph. D4 states the nested figure (0.73 to 1.03 s) but not the root one. "A start" includes every recreated instance (a config or lockfile change), because the record is kept per instance. See S2.

### Edges

| Probe | Steps | Outcome |
|---|---|---|
| A1: add at an ancestor of a cached lookup | The root `imports` maps `#x` to `./src/two.ts`. `src/a/b/c/index.ts` and `src/sib/index.ts` import `#x`. Run both tests, so the lookups for `src/a/b/c`, `src/a/b`, `src/a` and `src` are cached. Then add `src/a/package.json`, which maps `#x` to `./one.ts`. | The warm closure moves to `src/a/one.ts`. The warm run passes. The sibling stays on `src/two.ts` and passes. |
| A2: add at the middle directory | The same, but `src/a/b/package.json` is added. | The closure moves to `src/a/b/one.ts`. Both runs pass. |
| B1: an edited `mainFields` field | The config sets `environments.{ssr,client}.resolve.mainFields: ["source"]`. `src/uses.ts` imports `./pkg`, whose manifest names `source: lib.ts`, and the test expects `other.ts`. Run (fail). Do a `scripts` edit, which records the fields. Then edit `source` to `other.ts`. | The warm closure stays on `lib.ts`, and the warm run fails. Under M6, the closure moves to `other.ts` and the run passes. |
| `packageCache` across versions | I read the `dist` of Vite 6.4.0, 7.0.0, 7.3.1 and 8.3.2 (`npm pack`, read only). | All four have the same `getFnpdCacheKey` (`fnpd_${basedir}`) and the same `watchPackageDataPlugin(config.packageCache)`. `environment.config` is a proxy that falls through to the top-level config, so every environment sees the one shared `Map`. `pluginContainer.watchChange(id, change)` exists in all four. In 6.4.0 and 7.0.0 it calls every plugin in every environment. In 7.3.1 and 8.3.2, only `client` calls every plugin; other environments call only plugins flagged per environment. `packageCache` is in no public type: `ResolvePluginOptions.packageCache?` is the only typed mention. |

A note on A1. `findNearestPackageData` caches a key for every directory between the importer's directory and the manifest it found (`traverseBetweenDirs`, `node_modules/vite/dist/node/chunks/node.js:3358-3372`). So every cached lookup that passes through the added manifest's directory has a key equal to `fnpd_<dir>` or starting with `fnpd_<dir>/`. The scan at `stale.ts:83-86` finds them all. The probe agrees.

## Blockers

### B1. The S3 filter skips an edit of a field that `resolve.mainFields` names (proven: probe B1, with the counterfactual under M6)

`resolutionMoved` (`stale.ts:97-112`) compares only `RESOLUTION_FIELDS` (`stale.ts:24`): `name`, `main`, `module`, `browser`, `exports` and `imports`. Vite resolves a directory or a package entry through every field in the environment's `resolve.mainFields`, and then through `main` (`resolvePackageEntry`, reached from `tryCleanFsResolve`, `node.js:29133-29137`). Vitest 5 defaults the list to `[]` (`vitest/dist/chunks/index.DpLw24bj.js:7876`). A project that sets it, for example a monorepo resolving `"source"` to TypeScript, gets this failure:

1. The first manifest edit after a start records the fields.
2. A later edit that changes only the configured field is skipped: nothing is staled.
3. The warm instance keeps the old entry, so the closure, the key and the result stay put.
4. A fresh instance resolves the new entry, and the test passes.

This breaks goal 3 ("Everything the agent is told is true at the moment it is told"). It is a regression in this range. Before `72d2f00`, every manifest edit staled its directory, and probe B1 passes there (M6). D4 as amended encodes the fixed list, so the spec text matches the code, but not the goal.

The same allowlist shape leaves any other field that a plugin or Vite reads unguarded. `type`, for example, feeds `isFilePathESM` in import analysis (`node.js:26451`). That one is plausible, and I did not probe it.

Fix (one worker, `src/runners/vitest/stale.ts`, `test/runners/vitest/reresolution.test.ts`, one D4 sentence):

- Invert the filter. Compare the whole manifest with a short list of fields removed, fields that no resolver reads: `scripts`, `version`, `description`, `keywords`, `author`, `contributors`, `license`, `repository`, `bugs`, `homepage`, `funding`, `private`. An unknown or new field then stales, which is the honest default.
- The narrower alternative is to add every environment's `config.resolve.mainFields` to `RESOLUTION_FIELDS`. That still misses `type` and plugin-read fields.
- Done when:
  - Probe B1 is a `reresolution.test.ts` case with the run outcome asserted. It fails today. The config sets `mainFields` per environment: a top-level `resolve.mainFields` did not take effect in the probe, so the import stayed unresolved.
  - The `scripts`-only test and the cost guard still pass.
  - D4 names the ignored fields instead of the compared ones.

## Should-fix

### S1. A missing `packageCache` falls back silently (plausible; unreachable in Vite 6.4 to 8.3.2)

`dropPackageData` reads `environment.config.packageCache` as an internal field. When it is not a `Map`, the add case `continue`s with no note (`stale.ts:81-82`). M2 shows the effect: an added nested manifest with `imports` keeps the ancestor's map on the warm instance, and the result stays as it was. Every Vite that Vitest 5 accepts has the field (probe table). A future Vite that renames it would make this silent, unlike `invalidationState`, which is checked once per instance and falls back with one note (D4).

If `pluginContainer.watchChange` were missing, `invalidate` would reject instead, with a `TypeError` thrown into the adapter's queue.

Fix (one worker, the same files as B1):

- Check `packageCache instanceof Map` and `typeof pluginContainer.watchChange === "function"` once per instance, as for `invalidationState`.
- When either is absent, treat a manifest add, delete or edit like a config change: recreate the instance (about 50 to 200 ms, D4). Say so in one note.
- Add a unit test that stubs the field away.

### S2. The first edit of each manifest after a start pays the old cost (proven cost, no wrong result)

On the fixture, the first `scripts`-only edit costs 0.6 to 1.1 s of `affected`, against 13 to 37 ms for later edits. For the root, that means re-transforming the whole graph. Defect 11 measured that class at 5 to 6 s on a 516-file repository (inferred for this case, not measured). Each manifest pays it once after every daemon start and every recreated instance.

D4 gives the nested figure only. Add the root figure (about 1.0 s of `affected` plus the 200-closure walk on the fixture).

Fix (optional, one worker, `stale.ts`):

- Before `dropPackageData` drops it, seed the missing record from the `packageCache` entry whose `dir` is the manifest's directory. That entry's `.data` is the manifest as Vite last read it.
- With no entry, stale as today. Vite reads a directory's manifest uncached for a directory import (`node.js:29133-29137`), so a missing entry does not mean Vite never read it.
- Whether this pays off depends on how often a manifest has a cache entry at its first edit. For a project's own manifests that is plausibly most of the time, but I did not measure it.

## Nits

- **N1.** D4 gives `affected` after a later `scripts`-only edit (17.6 to 20.4 ms), but not what core then pays. That is a re-fetch of every picked closure: all of them for the root, which is one warm walk (about 0.13 to 0.26 s on the fixture). One clause would cover it. The comment at `resolution.ts:32-33` ("the closures are fetched warm") is true except for the first edit after a start.
- **N2.** The cost guard asserts `afterManifestEdit < firstManifestEdit / 4` (`structural-cost.test.ts:134`). The row's done-when was "near `afterEdit`". A later edit costing 200 ms would still pass. The measured numbers do meet the done-when: 17.6 to 20.4 ms against 28.4 to 38.2 ms, as D4 says.
- **N3.** `pluginContainer.watchChange` runs every plugin's `watchChange` for the manifest path, user plugins included: the `client` environment on Vite 7.3 and later, every environment on 6.4 and 7.0. Vite's own watcher does the same on a real change, so this is plausibly harmless. A plugin whose hook throws would reject `invalidate`. Plausible, not probed.
- **N4.** The branch HEAD is `73c7a91`, not the candidate `34d88dc`. The difference is docs only (`docs/board.md`, `tasks/wave-9.md`).
- **N5.** The core root branch picks every test file for any root manifest change, including a `scripts`-only edit. The coordinator's (b) said "when the root manifest's resolution fields changed". Core cannot see fields, and the runner skip keeps it to one warm walk (N1). So this is a wording gap in the brief, not a defect.

## What fits (do not re-check)

- **`wave-9b.md` S1:**
  - `watchChange` drops the package data of an edited or deleted manifest in every Vite that Vitest 5 accepts.
  - The `fnpd_` scan drops every cached nearest-package lookup that an added manifest shadows. That includes a lookup cached at an ancestor's descendants (A1, A2) and leaves a sibling outside the directory alone.
  - E5, E6, and the nested `imports` add and delete are runner cases with run outcomes. M1 and M2 make them fail.
- **The importer rule** (`deps.length > 0` under a manifest's directory). M3 shows it is the only rule that catches an added nested manifest whose `#x` target lies outside its directory. The edit and delete cases are also caught by the older resolved-import rule.
- **`wave-9b.md` S2 (b):**
  - `resolution.ts:59` picks every test file for a root add, delete or edit.
  - D3 and the code comment agree. E6 and E7 assert the run outcome. M5 fails the unit row, E6 and E7.
- **`wave-9b.md` S3 for `scripts`-only edits:**
  - Later edits cost `affected` near a plain edit (probe, D4).
  - The record follows a `scripts` edit and then a `main` edit (`reresolution.test.ts`, the last case).
  - An unreadable manifest and the first edit stale as before.
- **The async seam:** `invalidateStructural` is awaited inside the adapter's serial queue (`adapter.ts:157`). It has no other caller.
- **N1 and N2 of `wave-9b.md`:** the D4 cost figure is present, and the doc comment is rewrapped.

## Inputs for the next wave

1. **One runner row for B1, with S1.** It owns `src/runners/vitest/stale.ts`, `test/runners/vitest/reresolution.test.ts`, a unit test for the fallback, and the D4 sentences. Order inside `invalidateStructural`:
   1. Check the instance's `packageCache` and `watchChange` once. If either is absent, recreate the instance with a note (S1).
   2. Seed a missing record from `packageCache` if S2 is taken.
   3. Compare each manifest without the inert fields (B1).
   4. Call `dropPackageData`.
   5. Call `staleTransforms` as today.

   Done when:
   - Probe B1 (`mainFields: ["source"]`, set per environment) passes as a runner case with the run outcome asserted.
   - The `scripts`-only case and the `structural-cost.test.ts` guard still pass.
   - E5, E6, E7, P1 and P3c still pass.
   - The full suite is green.

   Budget: a later `scripts`-only edit keeps `affected` near a plain edit.
2. **S2 is optional.** Take it in the same row only if the coordinator wants the first-edit cost down. Otherwise, document the root figure in D4 (N1).
3. **Carried, unchanged:** `wave-9.md` N3 (narrowing the heuristic, a human decision). `wave-7.5.md` N2, N4, N5 and N7.
