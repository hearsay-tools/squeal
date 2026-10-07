# Review: wave 9, 001-79 (task 001-80)

Reviewer task 001-80 for spec 001, 2026-10-07. Range `eae3f46..48182dc`, 001-79 commits only: `db26f26` (quality slice 7, the split of `structural.test.ts`), `8cdcad6` (the core side: `closuresToReresolve`), `71d1ec6` (the runner side: `staleTransforms` and `reresolution.test.ts`) and `b8d517d` (D3, D4, `status.md`, the 001-72 table). I read them against `reviews/wave-9.md` S1, S2, N1 and N2, the 001-79 brief and board row, D3 and D4 as amended, and the seam into `refinement.ts` and `ledger.ts`. I did not re-check what `wave-9.md` and earlier reviews list under "What fits".

## Verdict

**PASS at `48182dc`.** Counts: 0 blockers, 3 should-fix, 3 nits.

**`wave-9.md` S1 is closed.** A deleted manifest whose entry lies below its directory (`lib/entry.ts`, `lib`) now re-resolves its importer. The runner test asserts the run outcome. With `inDirectory` restored in the `package.json` branch, 5 tests fail.

**`wave-9.md` S2 is closed for `main` and `exports`.** It is closed on both sides of the seam. An edited `main` re-resolves, both for a local directory and for a workspace package imported by name. So does an `exports` map: `"."`, a subpath, or a conditional. So does a nested workspace (`packages/group/a`). Edits repeated back and forth (b, a, b) re-resolve every time. With the runner rule removed, the P1 and P3c tests fail.

**S2 is not closed for an `imports` field (S1 below).** Core picks the test, and the runner stales the importer. But the warm Vite instance still resolves `#x` to the old target, while a fresh instance moves.

**Does `below(dir)` re-run too much? It re-runs nothing extra.** A `scripts`-only edit moves no closure, so no key moves and nothing is queued: `Ledger.settle` compares keys (`ledger.ts:119-134`). It costs runner work instead (S3). Every transform under the manifest's directory is re-done, about 0.5 s on the 1,000-module fixture against 14 to 16 ms warm. A nested manifest adds re-fetching the closure of every test file below it. For the root `package.json`, that cost buys nothing, because core picks no closure below the root (S2).

## Verification

The branch HEAD is `ede877f`, one commit past the candidate. That commit changes only `docs/board.md` and `tasks/wave-9.md` (N3), so the code under test is the candidate's. I ran everything in this worktree at `ede877f`.

```
$ git rev-parse HEAD
ede877fb44d077c8f3cb936ff7a0f12422ae6a66
$ git show --stat ede877f
 docs/board.md                                     |  7 ++++---
 docs/specifications/001-core-loop/tasks/wave-9.md | 12 ++++++++++++
$ npm ci
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
Checked 348 files in 127ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
 Test Files  118 passed (118)
      Tests  887 passed | 7 skipped (894)
   Duration  107.37s
```

A first full run had 1 failure out of 118 files. My probe file was created in `test/runners/vitest/` while that run was going, so I cannot say what failed. The run above came after I moved the probe out, and it is clean.

Mutations, each reverted before the next step:

- `pick(index.inDirectory(dir))` in place of `below(dir)` in the `package.json` branch: 5 tests fail. Two are unit rows (deleted, edited). Three are runner rows (P2a, P2a2, P3c). P1 still passes, because its entry `lib.ts` lies directly in the directory.
- `staleTransforms` without manifest edits (`p.kind !== "change"` alone, `stale.ts:29`): 2 runner rows fail, P1 and P3c.

## Probes

All probes were in two throwaway tests under `test/runners/vitest/`, deleted before this commit. Vitest ran each one twice (two root projects), and the numbers below are both samples.

### Cost on the 1,000-module fixture

The fixture is `structural-cost.test.ts`'s graph: 1,000 modules and 200 test files, plus `src/gen/package.json` (`{ "name": "gen" }`). Every closure was fetched into a `ReverseIndex`. Then each manifest got a `scripts`-only edit, followed by `invalidate` (kind `change`).

| Measure | Root `package.json` | `src/gen/package.json` |
|---|---|---|
| Baseline: cold `affected` | 1,164 / 1,251 ms | same instance |
| Baseline: warm, and after a plain edit | 14 to 16 ms, and 18.6 / 19.9 ms | same instance |
| Baseline: warm walk of all 200 closures | 128 / 137 ms | same instance |
| `invalidate` (no recreate) | 8 / 12 ms | 10 / 10 ms |
| `closuresToReresolve` picks | **0** | **200** (every test file) |
| `affected([manifest])` result | none | none |
| First `affected` after it | **508 / 579 ms** | **587 / 622 ms** |
| Re-fetching the picked closures (stale transforms) | 0 ms (none picked) | **936 / 945 ms** |
| All 200 closures after the edit | 991 / 1,003 ms | 864 / 878 ms |
| Closures that moved | 0 | 0 |
| Re-runs | 0 | 0 |

How to read the table:

- Whichever call comes first after a manifest edit re-transforms every module under its directory. That is about 0.5 to 0.9 s here, or 40 to 75 percent of the cold walk.
- In `fetchRunnerPart`, `affected(paths)` pays it, and then the closures are warm. The real cost is therefore about 0.5 s for the root and about 0.75 s for the nested manifest (inferred from the measured parts).
- `lessons.md` defect 11 measured whole-graph invalidation at 5 to 6 s on a 516-file repository. A `scripts`-only edit there would plausibly cost the same (inferred, not measured).
- `afterEdit` is unchanged, so the row's done-when holds.

### Edges

Each case: run the test once (it fails, because it expects the new value), fetch the closure, edit the manifest, `invalidate`, then record what core picks, `affected`, the closure fetched again on the warm instance, the warm run, and a fresh adapter on the same root.

| Probe | Change | Core picks | `affected` | Closure (warm) | Run (warm) | Fresh closure / run |
|---|---|---|---|---|---|---|
| E1 workspace `exports` `"."` | `./src/one.ts` → `./src/two.ts` | pkg | none | two | pass | two / pass |
| E2 workspace `exports` subpath | `"./feat"`: one → two, imports `a/feat` | pkg | none | two | pass | two / pass |
| E3 conditional `exports` | `{ import, default }`, `import`: one → two | pkg | none | two | pass | two / pass |
| E4 nested workspace | `packages/group/a` `main`: one → two | pkg | none | two | pass | two / pass |
| E5 **workspace `imports`** | `packages/a`: `"#x"` one → two, entry imports `#x` | pkg | none | **one** | **fail** | two / pass |
| E6 **root `imports`** | root `"#lib"`: `src/pa.ts` → `src/pb.ts` | **none** | none | **pa** | **fail** | pb / pass |
| E7 **root self-reference** | root `exports` `"."`: `pa` → `pb`, imported by its own name | **none** | none | pb | pass | pb / pass |
| E8 repeated edits | local `main`, workspace `main`, workspace `exports`, each b → a → b | n/a | n/a | follows every edit | pass ×3 | n/a |

E5 is S1. E6 and E7 are S2. E7's warm run passes because the probe runs it; Squeal never schedules that run, since no rule picks the file and its key does not move.

## Blockers

None.

## Should-fix

### S1. An edited `imports` field keeps the old resolution on the warm instance (proven: E5, E6)

Take a workspace package `a` whose entry imports `#x`. Edit its `imports` map from `./src/one.ts` to `./src/two.ts`. Core picks the importer (`below("packages/a")`), and `staleTransforms` stales `entry.ts`. The closure fetched again still holds `one.ts`, and the warm run still fails. A fresh adapter resolves `two.ts` and passes. So Squeal keeps the old closure and the old result as current, against goal 3. The row's outcome ("editing a `package.json` re-runs every test whose closure resolution it changes") is not met for this field. Its done-when is met (P1, P2a, P2a2, P3c), and the miss existed before the range, so this is not a blocker.

The mechanism was read in source and not verified by experiment. Vite caches package data per directory (`packageCache`, through `findNearestPackageData`, `node_modules/vite/dist/node/chunks/node.js:3216`). It drops an entry only in the `vite:watch-package-data` plugin's `watchChange` hook (`node.js:3295-3322`), which Vite's own watcher calls. Squeal never starts that watcher. `vitest.invalidateFile` only invalidates module nodes and Vitest's fs cache (`vitest/dist/chunks/index.DpLw24bj.js:21442`). Subpath imports resolve through that cached package data, so a re-transform still sees the old `imports`. `main` and `exports` take a path that re-reads the manifest (E1 to E4, E8).

Fix (one worker, `src/runners/vitest/stale.ts`, `test/runners/vitest/reresolution.test.ts`, one D4 sentence): for every added, deleted or edited manifest, make each project's Vite drop its package data before the importers are re-transformed. For example, call the hook Vite's watcher would call, `pluginContainer.watchChange(abs, { event })`, for each environment. Which call is public in this Vite is unverified. Add E5 as a `reresolution.test.ts` case with the run outcome asserted. It fails today. An added or deleted manifest with `imports` plausibly has the same gap (unverified). Add a delete case if the fix covers it.

### S2. A root `package.json`: the two sides of the seam disagree, and D3 states the wider rule (proven: E6, E7)

- **Core:** `closuresToReresolve` picks `index.below("")`. The prefix there is `"/"`, which no relative directory starts with (`reverse-index.ts:81-85`), so it covers root files only. `test/keys/resolution.test.ts` pins this, and the comment at `resolution.ts:29-30` and the `status.md` line say so.
- **Runner:** `staleTransforms` adds the worktree root to `directories` (`stale.ts:89-91`), so it stales every transform (the root column of the cost table).
- **D3 (`spec.md:69`):** "It re-resolves every closure with a path below that directory", with no root exception. The exception the code documents names only "a package importing itself by name", not a root `imports` map. In a single-package repository, the root manifest is where an `imports` map lives.

E7 shows that the runner already does its part for a root self-reference: the warm closure moves. Only the core pick is missing. E6 misses on both sides (S1 too). So a root manifest edit pays a whole-graph re-transform and re-resolves no closure.

Fix, a coordinator decision between two options:

- **(a) Docs only.** Amend D3 with the root exception, and name a root `imports` map and a self-reference as not modelled. One sentence and one `status.md` line.
- **(b) Recommended, with S3.** When a root manifest's resolution fields changed, pick `index.testFiles()`. That costs one warm closure walk (128 to 137 ms for 200 files) and is rare once S3 filters `scripts`-only edits. The work is a `resolution.ts` branch, the unit row turned around, and a runner case for E7.

### S3. A manifest edit that changes no resolution field re-transforms everything under its directory (proven cost; no extra re-run)

The cost table has the numbers. A `scripts`, `version` or `description` edit moves no closure, so it re-runs nothing. But the first walk after it re-transforms every module under the manifest's directory. For the root, that is the whole graph. For a nested package, the 200 closures core picks are also re-fetched over stale transforms. This is the defect 11 cost class, scoped to manifest edits. An `npm install` also touches the lockfile, which recreates the instance anyway (`adapter.ts:147-153`). So this matters for metadata and `exports` edits, not installs.

Fix (one worker, `src/runners/vitest/stale.ts`, `test/runners/vitest/structural*.test.ts` or `structural-cost.test.ts`, one D4 sentence):

- Keep a per-instance map from each manifest path to the JSON of its resolution fields (`name`, `main`, `module`, `browser`, `exports`, `imports`).
- On a `change`, if the fields equal the recorded ones, skip the directory rule, and record the new fields either way. An unknown previous value stales as today, so the first edit after a start stays sound.
- Core picks then fetch warm closures.

Test: a `scripts`-only edit of `src/gen/package.json` on the cost fixture, after one recorded edit, keeps the next `affected` near `afterEdit`. A `main` edit still passes P1 and P3c. Budget: `afterEdit` unchanged. Do S3 and S1 together, since both sit in `invalidateStructural`.

## Nits

- **N1.** D4 says "Of the edits, only a manifest edit takes this path, so a plain edit costs what it did". That is true, but D4 gives no cost for the manifest edit itself. Add this review's numbers (about 0.5 s on the fixture, or 40 percent of cold) or the post-S3 ones.
- **N2.** In the `staleTransforms` doc comment (`stale.ts:50-52`), the line breaks after "or `null`" mid-sentence where the old text wrapped. Cosmetic.
- **N3.** The brief's branch HEAD is `ede877f`, not the candidate `48182dc`. The difference is docs only (`docs/board.md`, `tasks/wave-9.md`).

## What fits (do not re-check)

- **`wave-9.md` S1:** P2a and P2a2 are runner cases with run outcomes. There are unit rows for a delete and an edit below the directory, and a row for a manifest below the resolved directory. They fail with `inDirectory` restored.
- **`wave-9.md` S2 for `main` and `exports`:** P1 and P3c are runner cases with run outcomes and fail without the runner rule. Core and the runner agree for `exports` `"."`, subpath and conditional (E1 to E3), for a nested workspace (E4), and for repeated edits (E8).
- **The seam:** `revision.ts:10` passes `change` for an edit. `adapter.ts:155-156` passes it on to `invalidateStructural`. `refinement.ts:114-115` unions the picks into the closures fetched again. An unchanged closure queues nothing (`ledger.ts:119-134`).
- **The order change in `closuresToReresolve`:** a declared-input add or delete behaves as before. A declared-input edit never reaches the call (`refinement.ts:114`).
- **Budget:** `afterEdit` is 18.6 and 19.9 ms against 14 to 16 ms warm, and the `structural-cost.test.ts` guard is green in the suite.
- **Quality slice 7 is a move.** The removed and added lines differ only in imports and the two helpers' `export` in `helpers.ts`.
- **The 001-72 table N1 and N2 corrections**, and the `status.md` line, except the root wording (S2).

## Inputs for the next wave

1. **One runner row for S1 and S3.** It owns `src/runners/vitest/stale.ts`, `adapter.ts` (`invalidate` only), `reresolution.test.ts`, the structural cost or unit test, and one D4 sentence. Call order inside `invalidateStructural`:
   1. Read each manifest's resolution fields and compare them with the recorded ones (S3). Skip unchanged edits.
   2. For each manifest left, drop Vite's package data in every project and environment (S1).
   3. Run `staleTransforms` as today.

   Done when: E5 passes as a runner case with the run outcome; a second `scripts`-only edit on the cost fixture keeps `affected` near `afterEdit`; P1, P2a, P2a2 and P3c still pass; the full suite is green.
2. **S2, after the coordinator picks (a) or (b).** (a) is a D3 sentence. (b) owns `src/core/keys/resolution.ts`, `test/keys/resolution.test.ts`, a runner case for E7, and D3. Run (b) after row 1, so that a root `scripts` edit does not pay a whole-graph walk.
3. **Carried, unchanged.** `wave-9.md` N3 (narrowing the heuristic, a human decision). `wave-7.5.md` N2, N4, N5 and N7.
