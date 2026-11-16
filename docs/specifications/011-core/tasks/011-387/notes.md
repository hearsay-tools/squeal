# 011-387: `backlog-tiers` cancel case, trigger and bound from one source

Worker bdd420d0, wave 117 W3, 2026-11-16. Base main 2ca6a943c (0.1.526). Test-only.

## Change

`test/scheduler/backlog-tiers.test.ts`, case "cancels a backlog tier for an edit, keeps its completed files and runs the edit in the next small tier".

Before: the edit started once 20 test files had appended a line to a mark file, and the check was `completedFiles.length >= 20`. A test writes its mark inside the test, before its module ends. The report counts a file as completed only when its module ended before the cancel (`endedInTime`, `src/runners/vitest/reporter.ts`). So a cancel between the mark and the module end gives 19 (cand/0.1.526 CI 43939351910).

After: the test wraps `h.runner.run` for the 200-file backlog tier and records every file the runner passes to `RunOptions.fileEnded`. The collector calls `fileEnded` exactly when `endedInTime` holds (`reporter.ts:155`), and `buildReport` keeps every such module in `completedFiles` (`run.ts:218`). The edit starts at 20 told files. The check is: at least 20 told, and `completedFiles` contains every told file. No host-tuned number. The mark file is gone from this case; `suite(200, 300)` without a mark.

The check is stronger than before: it names the files, not only a count.

## Evidence

- Squeal: `squeal status --wait` on the test file, revision 2: no known failures, current result.
- 3 of 3 direct runs, `timeout 600 env -u PLUGIN_ROOT -u PLUGIN_DATA pnpm exec vitest run test/scheduler/backlog-tiers.test.ts -t "cancels a backlog tier"`, load 37, 31, 28 (24 vCPUs): 1 passed, 2 skipped each.
- Mutation, reverted: in `buildReport`, `.slice(execution.failure === null ? 0 : 1)` after the sort, so a cancelled run drops one completed file. Load 28. The case fails at `backlog-tiers.test.ts:139`: `expected [ 'test/f001.test.ts', …(21) ] to deeply equal ArrayContaining{…}`. The old `>= 20` bound passes with these 22 files.
- A first mutation keyed on `execution.end === "completed"` did not bite: a cancelled backlog tier keeps the run's own end, `completed`; the cancel shows in `failure` only (as `RunOptions.signal` documents).
- `pnpm run typecheck` clean; `biome check` on the file clean.

## For the next worker

`h.runner.run` can be wrapped (not replaced) to observe `fileEnded` while keeping the recorder's `runs` and `beforeRun`. The third case ("lets a backlog tier finish through an edit no test file reaches") still triggers on marks; it checks no lower bound from them, so it has no such race.
