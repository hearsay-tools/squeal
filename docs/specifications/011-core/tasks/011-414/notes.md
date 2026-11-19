# 011-414: choosing affected tests caches its repeated path checks

Wave 124 W4, worker 9abded0e, 2026-11-19. Shape: slice (performance, same output). Commit `3bf7a89ff` (code and tests); this notes file in the next commit.

## What changed

- `src/core/fs/worktree-paths.ts`: `WorktreePaths` keeps the answers of `toRelative` and `isProjectFile` per absolute path. Each answer depends only on the path and `root`, which is `readonly`, so a kept answer is always the one computed fresh. Each memo holds at most `PATH_MEMO_LIMIT` (50,000) paths; when it is full it clears and starts again, so a long-lived runner host stays bounded. This repository's full closure loop asks about some thousands of distinct paths, well below the limit.
- `src/runners/vitest/graph.ts` `fileImports`: an entry of `shared` is reused without converting its targets again when the file, its sha1, its absolute static and dynamic targets (same order) and the `WorktreePaths` object are all the same as those it was made from. A module-level `WeakMap` (`MADE_FROM`) records, for each kept entry, the absolute edges and the paths object it was last converted from. When anything differs, the entry is computed as before and compared with the held one as before (`sameImports`), so a file whose bytes stay the same but whose targets move (a missing `./x.js` now resolves to `./x.ts`) gets a fresh entry.
- `src/runners/vitest/adapter.ts`: not changed. Its `closure` method already calls `this.paths.isProjectFile` and `toRelative` over every closure file; the memo covers those calls, and the calls in `closurePackages`, `resolutionInputs` and `moduleGlobs`, without an edit there.

## Decisions

- The brief says "by path and content hash". The key here is path + sha1 + the absolute targets. Path and sha1 alone are not enough: the transform's targets can change while the file's bytes stay the same (an added file resolves a missing import; review B1 and spec 001 D3). The comparison of absolute targets is plain string equality and is much cheaper than `path.relative`.
- The memo sits in `WorktreePaths` (the brief allows it), not in the adapter. Every user of `WorktreePaths` gets it; all of them use one root for the object's life. The other constructors (`src/cli/ci.ts`, the node-test and pytest runs) are short-lived.
- I did not cache `importTargets` by Vite's transform result. A relative `require` is resolved with `statSync` (`requireTarget`), so its result depends on files other than the importer. That would need its own invalidation; it is outside this row.

## Type changes

None. `fileImports` keeps its signature (`environment.ts`, not owned here, also calls it). New export: `PATH_MEMO_LIMIT` in `worktree-paths.ts`.

## Can a key differ?

No. Closures are the same values as before, and the tests and the benchmark below show it. `fileImports` entries are not read by any key (spec 015 D11). No key-format case is needed.

One pre-existing observation, not caused by this row: on a cold walk (the first `closure` calls of a new instance), the order of `imports` entries and of `packages.imports` follows the order in which Vite's transforms end, so it can differ from a warm walk. Keys are not affected: `identities()` in both `packages.ts` and `pnpm-graph.ts` sorts, and no key reads `imports`. The order is the same before and after this change.

## Per-file time, before and after

Probe: a script run with `tsx` in task scratch. It opens `createVitestAdapter` on a `git archive HEAD` copy of this repository (node_modules symlinked), lists its test files (2,055), then calls `closure` once per file in three rounds. Round 1 is cold (new instance); rounds 2 and 3 are warm. "before" runs `src/` of the HEAD copy (`7d02e6671`); "after" runs this branch's `src/`. Runs alternate before, after, before, after. Process CPU (user + system) per file is the main number; wall time follows host load. Nice 10.

| Run | Host load (1 min) at start → end | Round 1 cold: CPU / wall ms a file | Round 2 warm | Round 3 warm |
|---|---|---|---|---|
| before 1 | 101.6 → 89.5 | 66.7 / 351.3 | 38.0 / 143.9 | 33.6 / 90.0 |
| after 1 | 89.5 → 58.6 | 36.6 / 81.3 | 11.9 / 17.7 | 11.7 / 17.6 |
| before 2 | 58.6 → 68.0 | 51.6 / 127.2 | 27.1 / 40.1 | 27.2 / 42.3 |
| after 2 | 68.0 → 55.3 | 31.1 / 64.5 | 10.4 / 13.0 | 9.6 / 10.1 |

The host has 24 CPUs; it was loaded far above that by other sessions (no artificial load). The other machine open to agents was loaded too (18 on 12 CPUs), so I measured here. Warm closure loop: about 27–34 ms a file of CPU before, about 10–12 ms after, a cut of about 60–65%. The research's 13 ms a file (warm, `broad-change-throughput-2.md` section 2) was measured at lower load. Its profile put two thirds of the loop in `fileImports` path checks, which matches this cut.

Same output: the sha256 of the round's closures (JSON, in order) is `6adf2fffa2d7bf98` for every warm round, before and after. Cold rounds differ in hash from run to run only by entry order (see above). With `imports` sorted, each round's dump is identical before and after: cold `c5e4e5135a2d`, warm `0f1ccfcc4e3e`, in all four runs.

The remaining warm CPU after this row is in `moduleGlobs`, `resolutionInputs` and `closurePackages` (the research's 1.6, 1.2 and 0.4 s of 16.9 s). I did not profile again. They are in files this row does not own.

## Tests

- `test/fs/worktree-paths-memo.test.ts`: kept answers equal fresh ones across repeated asks, for paths inside, outside, the root itself, `node_modules` (top-level and nested) and `..foo`; the same answers past the limit.
- `test/runners/vitest/file-imports-cache.test.ts`: `fileImports` with a reused `shared` equals a call with an empty one, across a repeated walk (same entries by identity), moved targets with the same bytes, edited bytes, and a changed target outside the project; files without a stamp or outside the project are left out.
- `test/runners/vitest/closure-cache.test.ts`: a warm adapter's closures equal a fresh adapter's, after an add that moves a dynamic target (`src/later.js` → `src/later.ts`, importer bytes unchanged) and after an edit whose edges change.
- Mutation check: with `sameWalk` made to ignore the targets, both comparison tests fail (`AssertionError: expected … to deeply equal …`). Restored afterwards.

## Checks run

- `pnpm exec tsc --noEmit -p .`: clean.
- `pnpm exec biome check` on the five changed files: clean. (A full `pnpm run lint` first found three format/lint errors in my new tests; fixed.)
- Direct, `timeout 900 nice -n 10 pnpm exec vitest run --maxWorkers=2` on `test/fs/helpers.test.ts`, the three new files, and `test/runners/vitest/{imports,closure-packages,closure-globs,resolution-inputs,reresolution,packages}.test.ts`: 10 files, 52 tests passed.
- No file under `test/e2e/` imports `worktree-paths`, `vitest/graph` or `vitest/adapter` (grep).
- `squeal status --wait 60000` on the five changed paths, revision 9 (`3bf7a89f`): no verdict yet. The edits select 788 test files (`worktree-paths.ts` is read by 780). At 23:24Z: 98 current, all pass, 690 pending (686 queued behind a running tier). The host was at load 55–100 throughout.
- Expected drift: `test/harness/pi/package.test.ts` "has the bundles exactly as `npm run build:plugin` produces them" went PASS → FAIL at revision 9 (`cli/squeal.mjs differs from the build`). The committed bundles no longer match `src/`, because the wave rules forbid `pnpm run build` in a worker worktree. Other bundle-drift tests (`plugins/claude-code/dist`, Codex, OpenCode) will fail the same way. The coordinator rebuilds at candidate time.

## Proposed spec amendment (for the coordinator)

Spec 015 D11, or 011 C6 under the runner part: "The runner host keeps each path's project-file and relative-path answer (`WorktreePaths`, bounded), and reuses a walked file's `fileImports` entry while its sha1 and absolute targets are those it was made from (row 011-414). Closures, keys and selections are unchanged."

## For the next worker

- `graph.ts` is 423 lines (it was 394 before this row, already over the 300 guide). A split (for example `fileImports` and its helpers into `file-imports.ts`) would make it easier to read. I did not do it here, to keep this a small change.
- Row 011-415 (fast parser research) should compare against this row's cached loop: about 10–12 ms a file warm CPU at the load above.
