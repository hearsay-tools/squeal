# 013-10 notes: a project of its own config keeps its coverage payloads

Worker 6b240e54, 2026-10-26, found while repairing 013-08 (`../013-08/notes.md`).

## Defect

The worker reports each coverage batch with `testFiles: files.map((file) => file.name)`. That is Vitest 4.1.10 and 5.0.3 alike (read in both dists; `index.ggMXe2IF.js` in 5.0.3, `index.DXx9Dtk7.js` in 4.1.10). A file's `name` is relative to its project's root. `coveredFiles` (`src/runners/vitest/coverage.ts`) resolved it against the worktree root. For a project of its own config, whose root is another directory, the name therefore pointed at a different file, `wanted` was false, and the payload was dropped. Every Cezar project is such a config (`packages/cezar`, `packages/web`, and so on), so no Cezar file could keep a record.

Before the fix, both regressions failed: the run case kept no payload (`expected [] to deeply equal [a/…, b/…]`), and the unit case read `test/math.test.ts` for both projects.

## Fix

`coveredFiles` resolves the name against the batch's project's `config.root`, read while the instance is live (it is collected only on a clean run, before any close). `resolve` keeps an absolute name as it is. A batch whose project is not found is dropped, as one whose environment is not found already was.

## Regressions (`test/runners/vitest/own-provider-projects.test.ts`)

- A real run of two projects, each of its own config, each with `test/math.test.ts` over its own `src/math.ts`. Both payloads are kept, as `a/test/math.test.ts` in project `a` and `b/test/math.test.ts` in project `b`. Each record's sources are its own project's (`a/src/math.ts`, `a/test/math.test.ts`).
- `coveredFiles` with a fake instance: relative names in two projects with the same name, an absolute name, and the root project.
- `own-provider-client.test.ts` (013-08) now also asserts that a client-environment file keeps its payload, as the root project and as a project of its own config.
