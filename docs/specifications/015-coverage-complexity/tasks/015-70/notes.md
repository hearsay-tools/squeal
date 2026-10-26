# 015-70 notes: a provider the workers cannot load costs coverage, not verdicts

Worker ca9c5119, 2026-10-26. Brief: `tasks/wave-14.md` W1. Shape: repair. Research: `research/issue-102.md`. Issue: gh-102.

## Where the commits sit

The brief said "starts from main 0.1.345" and gave option A of the research as the lead. Option A was already on candidate 0.1.347: row 013-08 (coordinator 0bcb0e92) adds the provider file, by its path and real path, to `server.fs.allow` of every Vite server (`InstanceCoverage.allow`). Its tests `own-provider-client.test.ts` cover a root config and a projects config with the provider outside the project. 013-08 also prints the nested causes in `errorText`. The 0.1.347 review passed.

With the parent's agreement (coordinator 52e58f23, 2026-10-26), this row:

- is based on `origin/cand/0.1.347` at **`ab0ca19b5`** ("fix(release): align installer with 0.1.347");
- does not repeat the lead and leaves 013-08's `allow`, `errorText` and `own-provider-client.test.ts` as they are;
- adds only the fallback, the research's Q4 steps 1 to 3.

So the done-when line "the DOM file passes with coverage on, red first" is 013-08's evidence (`own-provider-client.test.ts`), not new work here.

## The fallback

| Step | Where | What |
|---|---|---|
| Recognise | `coverage.ts` `recordProviderFailure` | An error in the run, unhandled or a file's, whose message is `Failed to load custom CoverageProviderModule from <provider>` for this coverage's provider. Both paths go through `path.resolve`, so the forward slashes that Vitest's `pathe` gives on Windows should still match (not tested on Windows). Another provider path, or any other error, is not recognised. |
| Off for good | `coverage.ts` `failed` (a `WeakSet<VitestCoverage>`), `coverageWanted`, `providerFailed` | The daemon gives one `VitestCoverage` object to the fast adapter and to each slow pass's adapter (`daemon.ts`, `covering`). The failure is kept against that object, so coverage stays off in all of them until the daemon restarts. `#start` and `#invalidate` read `coverageWanted`, which is policy and no failure. |
| Note once | `adapter.ts` `#unloaded` | `noteOnce(root, text)`. The text is `coverage is off until the daemon restarts: a test worker could not load Squeal's coverage provider: <first cause> (<code>) (spec 015 D8)`. The first cause comes from `toCheckError(error).causes`, which is `causeChain` in `results.ts`, and is printed by `causeText` (`core/state/fingerprint.ts`), as `withStartup` does. So the cap, the first line and the relativising stay one rule, and `causeChain` needed no export. |
| Drop the instance | `adapter.ts` `run`, `broken.ts` `closeCrashed` | In the same `hold.exclusive` block as a hung, broken or rejected run. Those keep their order and their own close. Only when none of them applies does the provider failure close the instance with `closeCrashed`. `closeCrashed` is `closeBroken` without its prefix; `closeBroken` now calls it. The run ends `crashed`, and its failure's first line is the note's text. 013-08's `unhandled error outside any test file: …` lines follow it. Payloads of such a run are dropped. |

### Re-keying: the step the research did not name

The research's step 3 said "the scheduler's crash handling reruns the files". It does not. Spec 001 D12 (`scheduler/files.ts`, `unknownKey`) keeps a file that crashed unknown at that key, and queues it again only when its key moves. With coverage on, every Vitest key holds `{ provider: "squeal", version }` (D8 **Keys**). Turning coverage off moves those keys back to the coverage-off form, but only when the scheduler reads `environment()` again. It does that only for projects that `invalidate` or `recheck` report recreated.

If the adapter told the scheduler nothing, each file that the crashed run held would stay unknown until an edit or `run --all` re-keyed it. That breaks the row's outcome. So:

- `environment()` remembers the projects of its last answer that held coverage (`#keyedCoverage`).
- After a provider failure, `recheck()` and `#invalidate` report those projects as recreated (`#coverageGone`). The scheduler then re-reads the environment, as at a policy change of `coverage.enabled` (row 015-11). The answer has no coverage, so the report stops.
- `recheck` is new on `VitestAdapter`. The scheduler calls it at each quiet reconciliation pass (task 007-26). It compares two fields and costs next to nothing. The daemon's wrappers (`runner.ts`, `escaped.ts`, `slow-instance.ts`, `composite-runner.ts`) already pass it through.
- `#instance` also replaces a live instance that still has coverage on after another adapter on the same coverage recorded the failure (the slow pass first, then the fast one). The next fast run then does not crash once more.

No store, key-format or policy code changed. The keys move only as they already do when coverage turns off.

## Tests

`test/runners/vitest/own-provider-failed.test.ts` (real Vitest, client-env fixture). The forced failure is the gh-102 mechanism. The provider file is allowed (013-08). It imports a sibling in the same directory outside `fs.allow` through a computed `import()`. So Vite's client environment refuses the sibling (`ERR_MODULE_NOT_FOUND`), and the main process, on `ssr`, loads it. Two simpler forms do not fail, and the test's comments say why:

- A static import of the sibling loads: Vite's import analysis adds every import of an allowed module to `safeModulePaths` (`vite/dist/node/chunks/node.js:26495`).
- `new URL("./sibling.mjs", import.meta.url)` is rewritten by Vite's client transform to use `self`. The fixture environment has no `self`, so the cause was "self is not defined".

Cases:

1. `turns coverage off once, names the cause, and the next run gives verdicts`, for the root project and for a project of its own config (`web`, as cezarion's `packages/web`). The first run is `crashed` with no results. Its failure's first line starts `coverage is off until the daemon restarts:` and holds `Cannot find module 'file://…/sibling.mjs'` and `(ERR_MODULE_NOT_FOUND)`. Exactly one note is written, equal to that line. `recheck()` reports the project as recreated. `environment()` then gives a different `resolvedConfig`, and the next `recheck()` reports nothing. The second run passes with no coverage run collected, and no second note is written.
2. `keeps coverage off in a later adapter on the same coverage, as a slow pass's`. A second adapter on the same coverage object passes at its first run, with no new note.
3. `stays off when a config change recreates the instance`. An edit of `vitest.config.ts` recreates the instance (`recreatedProjects: [""]`), and the run passes with coverage still off.

`test/runners/vitest/provider-failure.test.ts` (no Vitest): the exact note text with the first cause and code; the error's own message when it has no cause; another provider's path and any other error leave coverage on.

**Red first.** Before the fix, all four cases of `own-provider-failed.test.ts` failed at revision 3 (`squeal status --wait`). With the first forced provider, a static import, the first run was `completed` (see above). With the computed import, at revision 6, the first line was `unhandled error outside any test file: Error: Failed to load custom CoverageProviderModule from …/provider.mjs`, the later adapters had no note, and the config-recreate run crashed again. After the fix, all four pass (revision 12).

## Checks run

See the final report. `npm run lint` and `npm run typecheck` pass. The affected verdict comes from `squeal status --wait`. Four bundle tests fail, as expected, because `cli/squeal.mjs` differs from the build and this row does not build bundles: `test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`. The version owner rebuilds them.

## Left open, for the coordinator

- **Spec text.** D8 does not say what happens when the provider fails in the workers. A proposed amendment under **The provider**: "A run whose workers cannot load the provider (Vitest's `Failed to load custom CoverageProviderModule from <provider>`) crashes once. Coverage then stays off for every Vitest instance of the daemon until it restarts, with one note that names the first cause. The projects whose keys held coverage re-key as at a policy change (row 015-70)."
- **One wasted run.** The research also offered a pre-check (Q4 step 4), and a rerun in the same call. I did neither: the brief asked for steps 1 to 3. The cost is one crashed run, and one restart, per daemon life.
- **Different forms of the cause.** gh-102's real cause is `Cannot find module '/@fs/…/provider.mjs'`. The forced one is `Cannot find module 'file://…/sibling.mjs' imported from …`. Both are the same rule, and both are recognised by the outer message, not by the cause.
- **Note wording.** "until the daemon restarts" is literal: the failure is kept against the daemon's coverage object. A policy change does not turn coverage back on until a restart.
