# Review: wave 9, 001-72 (task 001-78)

Reviewer task 001-78 for spec 001, 2026-10-07. Range `53771a4..53c0598`, 001-72 commits only: `8988094` (cherry-pick of `c968a73`, the survey and the table) and `5dc13db` (cherry-pick of `c8b5261`, the keep, its test, D3, `status.md`). I read them against D3 as amended, the 001-72 board row and brief, `src/core/keys/resolution.ts`, its call in `src/core/scheduler/refinement.ts`, and `src/runners/vitest/stale.ts` as far as the add, delete and change of a `package.json` reach it. I did not re-check what `wave-7.5.md`, `wave-7.6.md` and `wave-7.7.md` list under "What fits".

## Verdict

**PASS at `53c0598`.** Counts: 0 blockers, 2 should-fix, 4 nits.

**Keeping `closuresToReresolve` is right.** I re-ran the 001-72 survey from `c968a73` and it reproduces the table row for row. An added or deleted `package.json` moves the importer's closure, and only the heuristic reports that importer. The new runner test discriminates: with the directory rule disabled, both of its cases fail, along with five unit rows.

**The table is not complete.** It covers every row it was asked to cover, but two `package.json` cases move a closure that no rule reports. Both are missed re-runs, so Squeal keeps showing the old result as current, against goal 3:

- **S1.** A `package.json` is deleted, and its `main` names a file or directory below its own directory (`lib/entry.ts`, `lib`). The heuristic misses this case. The new D3 sentence says it covers it. One line fixes it.
- **S2.** A `package.json` `main` is edited. This is the open `wave-7.5.md` N1. The worker recorded it as not addressed. It needs a fix on both sides of the seam: in the runner and in the heuristic.

Neither case is a blocker. The missed cases already existed before this range, and the row's done-when is met: the table covers the rows the row named, a test names the case, and the suite is green. The 001-72 commits changed only a comment in `resolution.ts`. They did not change its code.

With two Vitest projects, the heuristic, the runner and a fresh instance agree, both for one root and for a `packages/a`, `packages/b` monorepo.

## Verification

The branch HEAD is `24e82d9`, one commit past the candidate. That commit changes only `docs/board.md` and `tasks/wave-9.md` (N4), so the code under test is the candidate's. I ran everything in this worktree at `24e82d9`.

```
$ git rev-parse HEAD
24e82d910ade406ef5d8ce3dc4ad0502fe8c0851
$ git diff --stat 53c0598 24e82d9
 docs/board.md                                     | 12 +++++++-----
 docs/specifications/001-core-loop/tasks/wave-9.md | 20 ++++++++++++++++++++
$ npm ci
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
$ npm run lint
Checked 348 files in 131ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run
 Test Files  115 passed (115)
      Tests  873 passed | 7 skipped (880)
   Duration  97.98s
```

Re-run of `c968a73:test/runners/vitest/reresolution-survey.test.ts`: 17 passed. Its 19 `SURVEY` rows match the committed table in every column (heuristic, rekeyed, affected, heuristic-only, moved, missed). The only missed rows are S8 and S8b (an added or deleted `package.json`), and the heuristic picks both.

Mutation: with `pick(index.inDirectory(dir))` commented out, both cases of `reresolution.test.ts` fail, and so do five rows of `test/keys/resolution.test.ts`.

## Probes

All probes were in one throwaway test under `test/runners/vitest/`, deleted before this commit. Each probe set up a fixture, ran every test file, fetched every closure and built a `ReverseIndex`. It then made one change, called `invalidate`, and recorded these columns:

- **Heuristic:** what `closuresToReresolve` picks.
- **Rekey:** `index.referencing([path])`.
- **Affected:** `affected([path])`, called as `fetchRunnerPart` calls it.
- **Moved (warm):** test files whose closure, fetched again on the warm instance, moved.
- **Moved (fresh):** the same against a fresh adapter on the same root.
- **Run, warm / fresh:** the run outcome on each.

Each fixture's test asserts the value a fresh instance should read, so a stale result shows as `fail` on the warm instance and `pass` on the fresh one.

| Probe | Change | Heuristic | Rekey | Affected | Moved (warm) | Moved (fresh) | Run, warm / fresh |
|---|---|---|---|---|---|---|---|
| P1 `main` edit | `src/pkg/package.json` `main` `lib.ts` → `other.ts` | none | none | none | none | pkg | **fail / pass** |
| P1b nested `main` edit | `main` `lib/a.ts` → `lib/b.ts` | none | none | none | none | pkg | **fail / pass** |
| P2a nested entry, manifest deleted | `main: "lib/entry.ts"`, delete `src/pkg/package.json` | **none** | none | none | pkg | pkg | pass / pass |
| P2a2 entry directory, manifest deleted | `main: "lib"` (`lib/index.ts`), delete it | **none** | none | none | pkg | pkg | pass / pass |
| P2b nested entry, manifest added | add `src/pkg/package.json` `main: "lib/entry.ts"` | pkg | none | none | pkg | pkg | pass / pass |
| P2c manifest in a nested imported directory | `./pkg/sub`, add `src/pkg/sub/package.json` | pkg | none | none | pkg | pkg | pass / pass |
| P2d manifest below the resolved directory | `./pkg` → `src/pkg/index.ts`, add `src/pkg/inner/package.json` | none | none | none | none | none | pass / pass |
| P3a two projects, one root | `projects` fixture, `unit` and `setup`, add `src/pkg/package.json` | `setup:both`, `unit:both`, `unit:pkg.unit` | none | none | same three | same three | pass / pass |
| P3b monorepo, two project roots | `packages/a`, `packages/b`; b imports `../../a/src/pkg`; delete `packages/a/src/pkg/package.json` | `a:a.test`, `b:b.test` | none | none | both | both | pass / pass |
| P3c monorepo, workspace package by name | `node_modules/a` → `packages/a`; b imports `"a"`; `packages/a/package.json` `main` `src/one.ts` → `src/two.ts` | none | none | none | none | `b:b.test` | **fail / pass** |

How to read the table:

- **P2a and P2a2 are S1.** The warm run passes because the probe's own run re-reads the module. Squeal never schedules that run, because no rule picks the file and its key does not move.
- **P1, P1b and P3c are S2.** No rule fires, and even the warm instance keeps the old resolution.
- **P2d shows that a manifest below the resolved directory moves nothing.**
- **P3a and P3b fit.**

A `package.json` is not an environment input either: `isEnvironmentInput` covers config, setup files, lockfiles and patches (`keying.ts:218`). So no other path re-keys these test files.

## Blockers

None.

## Should-fix

### S1. A deleted `package.json` whose entry lies below its directory re-resolves nothing (proven)

`closuresToReresolve` picks the importers of `dir/package.json` through `index.inDirectory(dir)` (`resolution.ts:50`), which holds only closure paths directly in `dir`. When `main` names `lib/entry.ts` or `lib`, the importer's closure holds `dir/lib/entry.ts` or `dir/lib/index.ts`, not a path in `dir`. Delete the manifest and the directory falls back to `dir/index.ts`. Every closure, warm or fresh, moves (P2a, P2a2). But the heuristic, `rekey` and `affected` all pick nothing. The test keeps its old result as current until something else touches its closure.

Two places in the range state the opposite:

- D3 (`spec.md:69`): "the directory rule alone reports the importers of a directory whose `package.json` was added or deleted".
- The doc comment at `resolution.ts:17-21`.

The add direction works, because the closure before the add holds `dir/index.ts` (P2b).

Fix (one worker, `resolution.ts`, `test/keys/resolution.test.ts`, `test/runners/vitest/reresolution.test.ts`, the D3 sentence): when the basename is `package.json`, pick `index.below(dir)` instead of `index.inDirectory(dir)`.

I ran that one-line change against the probes:

- P2a, P2a2, P2b and P2c all pick `test/pkg.test.ts`.
- P2d picks nothing.
- P3a and P3b are unchanged.
- `test/keys`, `test/scheduler` and `reresolution.test.ts` pass (26 files, 166 tests).

Then add a unit row (closure `src/foo/lib/entry.ts`, delete `src/foo/package.json`) and a `delete` case with `main: "lib/entry.ts"` to `reresolution.test.ts`. In D3 and the comment, write "below the directory" instead of "in". The cost is one `below` walk, and only on an add or delete of a manifest.

### S2. An edited `package.json` `main` re-resolves nothing, on either side of the seam (proven, pre-existing: `wave-7.5.md` N1)

P1, P1b and P3c show it. The monorepo case P3c is the likely way to hit it: the workspace package `a` is imported by name, and its `main` is edited. In the warm instance the test fails, while a fresh instance passes. No key moves, so Squeal reports the old result as current.

`status.md` records this as "not addressed here", which is honest. What the range adds is that `wave-7.5.md` N1's proposed fix is only half of the fix:

- **Runner side:** `staleTransforms` only sees `structural` paths (`adapter.ts:158`). So a manifest `change` never stales the importer, and even a closure fetched again is the old one (P1: moved warm = none).
- **Core side:** `closuresToReresolve` skips every content change (`resolution.ts:44`). `affected([manifest])` returns `[]` even when the runner has staled the importer: `reresolution.test.ts` asserts exactly that for the add and delete cases, where `staleTransforms` does stale it. So with only `stale.ts` fixed, nothing would fetch the closure again.

Fix (one worker, `stale.ts`, `adapter.ts` `invalidate`, `resolution.ts`, tests in `structural.test.ts` and `reresolution.test.ts`, D3 and D4 sentences):

- Treat a `package.json` `change` like an add or a delete in `staleTransforms`'s directory rule.
- In `closuresToReresolve`, let a `package.json` content change through to the S1 rule (`below(dir)`).
- Test P1 and P3c with the run outcome asserted against the expected value.

Budget: `afterEdit` on the 1,000-module fixture stays where it is. Only a manifest edit takes the new path.

## Nits

- **N1** (proven). The table cites the survey as its source, but the survey has no scenario for two rows. The "glob in a virtual module, an inlined dependency" row and the "`tsconfig` paths" half of the alias row are not in `c968a73`'s scenarios: S10 is absent, and S9 is the alias only. Both rows are plausibly right, since they match the alias and virtual-module mechanics. They should still say "not measured" or get a scenario.
- **N2** (proven). The table's "Moved" column is the closure fetched again on the warm instance, not a fresh one. P1 shows the two can disagree: warm moves nothing, fresh moves the test. A runner-side miss therefore shows in the table as "moved: none, missed: none". The note under the table already says this for the `main` edit. One sentence naming the ground truth would make the table safe to reuse.
- **N3** (plausible, cost only). The keep is wider than its evidence. In every row except the manifest rows, each heuristic pick either was also made by `rekey` or `affected`, or did not move. For example, an add in `src/` re-fetches `each`, `math` and `strings` for nothing (S1a, S4, R1). If the human wants that cost back, narrow the rule to `package.json` (with S1's `below`) plus declared inputs. Drop the `below(dir/name)` and parent-`index` rules, and amend D3. I did not measure the closure-fetch cost on a large repository. This is not needed for correctness.
- **N4**. The brief's branch HEAD is `24e82d9`, not the candidate `53c0598`. The difference is docs only (`docs/board.md`, `tasks/wave-9.md`).

## What fits (do not re-check)

- **The keep.** S8 and S8b reproduce: an added or deleted `package.json` is reported by the heuristic alone. `reresolution.test.ts` pins it on real Vitest, and it fails with the rule disabled. It also asserts `affected = []`, so it will flag the day the heuristic becomes redundant.
- **The 001-72 table rows as measured.** Every survey row reproduces exactly at `53c0598`.
- **Two Vitest projects.** On one root (`unit`, `setup`, `both.test.ts` in both) and as a `packages/a`, `packages/b` monorepo with per-project roots, the heuristic picks per-project refs, and warm and fresh closures agree (P3a, P3b).
- **A manifest below the resolved directory** moves nothing and is picked by nothing (P2d).
- **Unit test rewrite.** The two plain-directory rows became the `package.json` rows. The `inDirectory` rule keeps unit coverage through the root and ordering rows: five rows fail with it disabled.
- **The D3 sentence**, except "added or deleted" for nested entries (S1). **The `status.md` line.** **The `resolution.ts` comment**, again except S1. The bundle matches the build.

## Inputs for the next wave

1. **S1 fix row, small.** It owns `src/core/keys/resolution.ts`, `test/keys/resolution.test.ts`, `test/runners/vitest/reresolution.test.ts`, the D3 sentence and one `status.md` line.
   - Use `below(dir)` for a `package.json` basename.
   - Add a unit row and a runner `delete` case with `main: "lib/entry.ts"`.
   - Done when the new runner case fails with `inDirectory` restored, and the full suite is green.
2. **S2 fix row, or fold it into S1** if the coordinator buys the larger scope. It also owns `src/runners/vitest/stale.ts`, the `invalidate` branch of `adapter.ts`, `structural.test.ts` and a D4 sentence. Call order:
   1. `invalidate` passes a `package.json` `change` to the directory rule in `staleTransforms`.
   2. `closuresToReresolve` lets the same change through.
   3. `fetchRunnerPart` already unions the result into the closures it fetches again (`refinement.ts:115`), so it needs no change.

   Tests: P1 and P3c from the table, each asserting the run outcome against the value a fresh instance reads. Budget: `afterEdit` unchanged.
3. **Optional.** N3 (narrow the heuristic) only if the human wants the cost back. It needs a coordinator decision and a D3 amendment. N1 and N2 are a docs touch to `tasks/wave-9.md`.
4. **Carried, unchanged.** `wave-7.5.md` N2 (concatenated dynamic imports), N5 (the closure gap at virtual ids and `node_modules`), N4 (waits on 001-54) and N7 are outside this row.
