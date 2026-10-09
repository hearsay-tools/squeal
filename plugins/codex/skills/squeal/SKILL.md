---
name: squeal
description: Use when about to run tests (vitest, npm test) or to check whether a change broke something, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the Vitest tests, and the node:test tests where squeal.config.json lists nodeTest projects; this says how to read its reports and when to wait for one.
---

# Squeal

Under Codex `squeal` is not on the PATH: wherever this skill and its references say `squeal`, run the command the SQUEAL primer names, `node --disable-warning=ExperimentalWarning "<plugin root>/dist/cli/squeal.mjs"`, the plugin root being the directory that holds `skills/squeal/`. The last line of a FAIL report names it too.

Squeal runs this repository's Vitest tests in the background after every edit, and its node:test tests too where `squeal.config.json` lists `nodeTest` projects. It reports only changes, in messages that start with `SQUEAL ·`: a check that went `PASS -> FAIL`, `FAIL -> PASS`, or failed differently.

## Steps

1. **Keep working; read the reports instead of running Vitest, or node:test where `nodeTest` projects are listed.** Results arrive with your next tool call, as SQUEAL messages. No message means nothing changed, not that everything passes. Done when you have read every FAIL in every SQUEAL message that arrived.
2. **On a FAIL**, read its first error line and location. When they are not enough, run the message's last line, `Full output: squeal why "<name>"`, for the full output and history. After your fix the recovery arrives as `FAIL -> PASS`. Done when each FAIL is fixed or you can say why it stays.
3. **Wait only when you need a result before your next step**, for example before saying the task is done. By default results arrive with your next tool call, so keep working. When you need them now, run `squeal status --wait 60000`, or `--wait 120000` on a busy host (at load 100 to 170 on 24 CPUs, an edited file's result took up to 51 s): it returns as soon as the test files your edits re-keyed have their results, or one of their checks changed. Done when its first line says `Returned on quiet` or `Returned on news`; on `Returned on timeout`, wait again.
4. **Before saying the task is done**, claim only what the latest header or `squeal status` shows. `Known failures: 0` with checks pending means "no known failures yet"; say what is still pending, and whether a full-suite checkpoint completed at the current revision. Done when every claim about tests matches a line of `squeal status`.
5. **Run tests yourself only** when a header says no daemon is validating, a result is unknown, or the repository's own gate (CI, a pre-commit hook, the task) requires a run. Squeal covers the Vitest tests, the node:test tests of the `nodeTest` projects `squeal.config.json` lists, and the slow test files its `slow` key marks: run typecheck, build and other suites as the repository says. Running the test files beside your edit to learn sooner duplicates what Squeal is already running, so wait instead (step 3); a gate the repository requires is still yours to run.

## Red/green: checking that a test catches the bug

To show that a test fails without your fix and passes with it, let Squeal run it rather than running it yourself. Results would arrive with your next tool call anyway; here each step needs its result before the next, so wait after each edit:
```sh
# 1. Revert the fix, then:
squeal status --wait 60000   # Returned on news: the test's PASS -> FAIL
# 2. Restore the fix, then:
squeal status --wait 60000   # Returned on news: FAIL -> PASS
```
Each edit is its own revision, so the first wait reports the revert, not the fix: the result is the FAIL the test had before your fix, often looked up from the store at once since the reverted files are the same bytes, so that wait may return on quiet instead of news. Quiet says no result your edits owe is outstanding, not that it passed: read the outcome in the snapshot the wait prints. The test catches the bug when it is listed under `Known failures` after the revert and gone from it after the restore; listed as passing after the revert, it does not.

## Reading a header

Every SQUEAL message starts with a header such as `Revision 21 (changed src/math.ts): 40 current, 3 pending, 0 stale, 0 unknown.` The files in parentheses are the files changed since your last report. They say what changed, not what caused a failure: a failure can come from any earlier edit, or from none of yours.

Where `squeal.config.json` marks slow test files, a second line starts `Slow tier:` and says whether they are current, against which build output and at which revision, running, pending and why, or not run at this revision. Slow files run when you pause between turns or on `squeal run --slow`, never during Stop's wait. A slow failure wakes you when you are idle in an interactive Claude Code session; under Codex and in `-p` sessions it arrives with your next prompt or tool call.

## Reference

- `references/reports.md`: when reports arrive (after tool calls, at Stop, waking you when idle, with the next prompt) and what every header count and sentence means: pending, stale, unknown, inherited, test files without checks, no daemon validating. Read it when a header says something the steps do not cover.
- `references/commands.md`: what `squeal status`, `squeal why` and `squeal run --all` print, and what to do when a wait returns on timeout or without a daemon. Read it when a command's output is not what step 3 or 4 expects.
- `references/policy.md`: an edit denied after a regression, a Stop kept going by policy, and every key of `squeal.config.json`. Read it when Squeal denies an edit or blocks a stop, or before changing the config.
