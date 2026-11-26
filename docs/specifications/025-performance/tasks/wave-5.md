# Wave 5: Vite 8.4.0 breaks Squeal's Vitest runs (rows 025-23, 025-24)

Approved by the human 2026-11-26 ("Fix and release"): urgent. Read `research/bench-provider.md` (025-22) first:
Vite 8.4.0 (published 2026-11-26 10:59Z, now `latest`) calls `pluginContainer.load(id, { withMetadata: true })`
and reads `.code`; Squeal's wrapper in `src/runners/vitest/sources.ts` (`SourceStamps.attach`) passes only `id`, so
Vitest cannot start and a project on Vite 8.4.0 gets no result at all. The two rows run in parallel on disjoint
files. Neither edits `docs/board.md` or runs `pnpm run build` in its tree. Any direct `vitest` run gets
`timeout 600`; verify with `squeal status --wait 60000 <changed-path>...`. Final message: decisions the brief did
not settle and the evidence for each done-when.

## 025-23: the `load` wrapper forwards every argument, and the daemon log keeps the cause (repair; opus high)

1. In `SourceStamps.attach`, forward every argument (`async (id, ...rest) => { ...; return load(id, ...rest); }`),
   typed so that both of Vite 8.4.0's `load` overloads hold. Search `src/` for other wrappers of Vite or Vitest
   methods that drop arguments the same way, and fix them alike.
2. A test that runs Squeal's Vitest path on Vite 8.4.0 and fails on the old wrapper. Lead: move the repository to
   Vite 8.4.0 (`pnpm-lock.yaml`, through Vitest's peer or a `vite` devDependency) so CI and typecheck run on it;
   if that is not sound, a fixture project with Vite 8.4.0. Say which and why. Older Vite (8.3.x) must keep
   working: keep or add one check on it.
3. `messageOf` (`src/core/daemon/runner.ts`) and the runner host's `errorOf` (`src/core/runner-host/protocol.ts`)
   carry the `cause` chain's messages, so the log reads `... could not start: Failed to load ...: Cannot read
   properties of null (reading 'code')`. Keep it short and bounded.
Owns those three source files, their tests, `package.json` and `pnpm-lock.yaml`. Done when: the new test fails
without the fix and passes with it; typecheck passes against Vite 8.4.0; affected tests pass; the key-format and
version-sensitive tests pass (`test/keys/key-format.test.ts`, `test/version-sensitive.test.ts`).

## 025-24: the benchmark pins Vite and records what it installed (slice; opus medium)

`bench/gen-project.mjs` pins `vite` exactly beside `vitest` and `@vitest/coverage-v8` (use 8.4.0, so the benchmark
exercises the fixed path; note that 0.1.641 and older then fail correctness, as they should). `bench/run-all.mjs`
writes the installed `vitest`, `vite` and `@vitest/coverage-v8` versions into each run's `meta.json`, and
`bench/summarize.mjs` prints them in the scorecard's header line. Update `bench/README.md` where it names the
project's dependencies. Owns `bench/*.mjs` and `bench/README.md`, not `bench/results/`. Done when: the bench
tests (`test/bench/` if present, else a dry run of `gen-project.mjs` into a temp directory) show the pin and the
recorded versions; lint passes.

Use /worker.
