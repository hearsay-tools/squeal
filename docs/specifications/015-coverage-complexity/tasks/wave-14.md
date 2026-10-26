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

## 015-71: review of candidate 0.1.349 (wave 14)

Use /reviewer. Candidate `cand/0.1.349`, pinned to the SHA in the spawn, on main 0.1.347: four 015-70 commits and the version and bundles. 0.1.347 already carries the load fix (row 013-08), so 015-70 is the fallback alone. Write `reviews/0.1.349.md` in this spec and commit it on your branch.

Read row 015-70, W1 above, `tasks/015-70/notes.md`, `research/issue-102.md` (Q4), spec 015 D8 and D12, and 013 row 013-08.

Check, with proof where you can:
1. **Narrow.** Only the recognised provider-load error for this instance's provider turns coverage off. No other retry or restart path changes.
2. **Verdicts.** After that error, the next run gives verdicts with coverage off. One note names the first cause.
3. **Re-key.** `recheck()` re-keys only the projects whose keys held coverage, and only after a provider failure (D12).
4. **Keys.** The validity case reads "the candidate stores more", and keys and outputs equal the last release.
5. **With 013-08.** A DOM file that loads the provider never reaches the fallback.

Checks (`docs/process.md`): lint, typecheck, Squeal's affected results or targeted `npx vitest run` of files you name. No full suite. Name the candidate's CI result or say it is pending. Label findings proven, plausible or unverified. Verdict PASS or FAIL; only a proven break blocks.
