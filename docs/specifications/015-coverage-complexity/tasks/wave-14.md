# 015 wave 14: browser-like test files load the coverage provider, and a provider failure costs coverage only

Briefed by coordinator 52e58f23 on 2026-10-26, from issue #102 and `research/issue-102.md`. The human chose a fix with no stopgap the same day. One worker.

## W1: 015-70

Use /worker. Shape: repair. Starts from main 0.1.345. Outcome: with coverage on, a `jsdom` or `happy-dom` test file gets its verdict and its coverage; any later failure to load the provider turns coverage off for the adapter and costs no verdict.
- Read `research/issue-102.md` (all of it), spec 015 D8, and board row 015-70.
- **Lead.** Option A of the research: in `src/runners/vitest/adapter.ts` `#start`, beside `withoutOptimizer`, add the provider path to `server.config.server.fs.allow` of every server (`vitest.vite` and each `project.vite`). Put the helper in `src/runners/vitest/coverage.ts`.
- **Fallback.** The research's Q4 steps 1 to 3: recognise `Failed to load custom CoverageProviderModule from <provider>`, keep coverage off for the adapter's life, note it once, and drop the instance. The run failure's text gives the first cause, and reuses `causeChain` from `results.ts`.
- **Test.** No new dependency if you can avoid it: a custom test environment with `viteEnvironment: "client"` reaches the same rule. Otherwise add `happy-dom` as a dev dependency. Cover a root config and a projects config, with the provider outside the project.
- **Owns.** `src/runners/vitest/**` and its tests. No store, key or policy change.
- **Done when.** The DOM file passes with coverage on, red first. A forced provider failure gives verdicts on the next run, with one note naming the cause. Notes in `tasks/015-70/notes.md`. Lint and typecheck pass, and `squeal status --wait 60000 <changed-path>...` gives the verdict; paste both. No full suite. Do not build bundles or raise the version.
