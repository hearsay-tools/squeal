---
name: squeal
description: Use when about to run tests (vitest, npm test) or to check whether a change broke something, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the suites its primer lists as covered; this says when to wait for their results and how to read its reports.
---

# Squeal

Under Pi `squeal` is not on the PATH: wherever this skill and its references say `squeal`, run the command the SQUEAL primer names, the Node that runs Pi with `--disable-warning=ExperimentalWarning "<package root>/dist/cli/squeal.mjs"`, the package root being the directory that holds `skills/squeal/`. The last line of a FAIL report names it too.

Squeal runs this repository's tests in the background after every edit. It reports only changes, in messages that start with `SQUEAL ·`: a check that went `PASS -> FAIL`, `FAIL -> PASS`, or failed differently. It covers what the SQUEAL primer lists from `squeal.config.json`: the Vitest tests, the node:test tests of the `nodeTest` projects, the pytest tests of the `pytest` projects, and the slow test files `slow` marks; a test file you add that matches them is picked up too. Typecheck, build and anything else the repository checks are yours to run.

## Steps

1. **Keep working, and read the reports.** Results arrive with your next tool call, as SQUEAL messages. No message means nothing changed, not that everything passes. Running the test files beside your edit to learn sooner duplicates what Squeal is already running. Done when you have read every FAIL in every SQUEAL message that arrived.
2. **On a FAIL**, read its first error line and location. When they are not enough, run the message's last line, `Full output: squeal why '<name>'`, for the full output and history. Squeal re-runs a new failure once on its own, but not one from a forced run (`squeal run --all --force`, `squeal warmup`, a re-run), one already re-run at the same inputs, a slow file's, nor any when more than eight eligible test files fail anew in one tier; a re-run that passes arrives as a PASS with the line `Flaky: FAIL -> PASS under the same inputs`. So rather than re-running such a failure yourself to see whether it is flaky, let that re-run answer. After your fix the recovery arrives as `FAIL -> PASS`. Done when each FAIL is fixed or you can say why it stays.
3. **Wait only when you need a result before your next step**; otherwise results arrive with your next tool call. For files you just changed, `squeal status --wait 60000 <path>...` gives the verdict of the test files they select. Before saying the task is done, run `squeal status --wait 60000`, or `--wait 120000` on a busy host: it returns once the test files your edits re-keyed have results, or one of their checks changed, but not for slow files (step 4); `squeal run --all --wait` is a full-suite checkpoint. Done when the last line gives a verdict, `Returned on quiet` or `Returned on news`; on a timeout, wait again.
4. **Before you say the task is done, make the evidence current.** Where `squeal.config.json` marks slow test files, the header's second line starts `Slow tier:`. If the last one says `Stop waits`, they are required once you edit: while one is not current, run `squeal run --slow --wait 60000`. Without `Stop waits`, say how many are not current. Claim slow tests pass only once it says every slow file is current. Done when no check of your edits is pending, the slow tier is current or counted, and every claim about tests matches a line of `squeal status`. When a check stays pending after you waited again, say it is pending: `Known failures: 0; not current: …` means "no known failures yet".
5. **Run tests yourself only** when a header says no daemon is validating, a result is unknown, or the repository's own gate (CI, a pre-commit hook, the task) requires a run. A SQUEAL line `No result for <path>: no test Squeal runs reads it` means the same for that file: run whatever tests it yourself. Done when the suites the primer does not list have run as the repository says; a gate the repository requires is still yours to run.

## Reading a header

The registration and Stop's report start with a header like `Revision 21 (changed src/math.ts): 40 current (34 tests, 6 test files loaded), 3 pending (3 tests), 0 stale, 0 unknown.`, naming the files changed since your last report: what changed, not what caused a failure, which may be any earlier edit or none of yours. Other SQUEAL messages carry the news, non-zero counts only: `Revision 21: 3 pending (3 tests).`

## Reference

- `references/reports.md`: when reports arrive and what every header count and line means: pending, stale, unknown, inherited, the slow tier, no daemon validating. Read it when a header says something the steps do not cover.
- `references/commands.md`: what `squeal status`, `squeal why`, `squeal run --all` and `squeal run --slow` print, what the last line of each wait means, what a path selects, and red/green through the wait. Read it when a command's output is not what step 3 or 4 expects, or before a red/green check.
- `references/policy.md`: an edit denied after a regression, a Stop that keeps you going or waits for the slow tier, and every key of `squeal.config.json`. Read it when Squeal denies an edit or blocks a stop, or before changing the config.
