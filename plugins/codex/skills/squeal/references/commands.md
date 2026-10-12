# Commands

`squeal --help` lists every command and flag. This file says what their output means.

## squeal status

Prints the current state of this worktree. It reads the store and needs no daemon.

```text
Revision: 187
Known failures: 0
Affected checks: 47 passed, 3 running, 12 queued
Full-suite checkpoint: none completed at revision 187; last completed at revision 170
```

`Known failures: 0` with pending checks means "no known failures yet": the current revision is not fully validated. The skill's step 4 says what to claim from it.

`squeal status --json` gives the same snapshot as a versioned JSON object.

## Waiting for pending checks

Results arrive with your next tool call, so by default keep working. Only when you need a result before your next step, for example before saying the task is done, run `squeal status --wait 60000`. It replaces `sleep` and polling.

It returns once the test files your edits re-keyed since Squeal last told you something have their results (a pass, a failure, a skip, or unknown with a reason), or as soon as one of their checks changed (a new failure or a recovery), and at the latest after the given milliseconds; then it prints status. An edit to an environment input (the Vitest config, a setup file, the installed lockfile) re-keys every test file, so its wait holds for all of them. A baseline, a backlog, slow files and other worktrees' work do not hold it, and other checks' changes do not end it: the line names them and what else is pending. When slow files are not current, a quiet line says so and names `squeal run --slow --wait 60000`, which waits for them.

Its first line says why it returned, with the revision and the time waited:

- `Returned on quiet`: none of the test files your edits re-keyed is pending. Quiet says no result your edits owe is outstanding, not that they passed: read the outcome in the snapshot it prints.
- `Returned on news`: a check of those files changed; read it as you would a SQUEAL message.
- `Returned on timeout`: some of those files are still pending, and the line says how many. Wait again, or say so; a timeout is no reason to run those files yourself.
- `Returned without a daemon: no daemon has validated since <time>; results are as of revision N`: nothing gets validated, so results are as old as that revision, whatever the files hold now. Run `squeal start` and wait again, or run the tests yourself. The wait starts no daemon.

The exit code is 0 in all four cases. Keep the limit below your shell tool's own timeout. On a busy host give it `120000`: at load 100 to 170 on 24 CPUs, an edited file's result took 1 to 16 s at the median and up to 51 s. A daemon from an older release names no files: the wait then returns when nothing at all is pending, or on any check's change. With `--json`, stdout is the snapshot with a `wait` field (`outcome` is `quiet`, `news`, `no-daemon` or `timeout`; `edit`, when the daemon named the files, holds `since`, the first revision of the window, `testFiles`, `pending` and `otherTransitions`) and the line goes to stderr.

## Red/green: checking that a test catches the bug

To show that a test fails without your fix and passes with it, let Squeal run it rather than running it yourself. Results would arrive with your next tool call anyway; here each step needs its result before the next, so wait after each edit:
```sh
# 1. Revert the fix, then:
squeal status --wait 60000   # Returned on news: the test's PASS -> FAIL
# 2. Restore the fix, then:
squeal status --wait 60000   # Returned on news: FAIL -> PASS
```
Each edit is its own revision, so the first wait reports the revert, not the fix: the result is the FAIL the test had before your fix, often looked up from the store at once since the reverted files are the same bytes, so that wait may return on quiet instead of news. Quiet says no result your edits owe is outstanding, not that it passed: read the outcome in the snapshot the wait prints. The test catches the bug when it is listed under `Known failures` after the revert and gone from it after the restore; listed as passing after the revert, it does not.

## squeal why

`squeal why "<check name>"` prints the history and provenance of one check and the path to its last run log, which holds the full output; SQUEAL messages carry only the first error line and its location. A FAIL report ends with the command for its first failure:

```text
Full output: squeal why "src/math.test.ts > math > adds"
```

Use a name exactly as a SQUEAL message or `squeal status` printed it. Any unique part of the name also works.

Its `Run log:` line names the `vitest.log` of the run that produced the result shown, from the worktree it was inherited from when it was. That file holds the run's `console` output, but it covers every test file of that run, not only this check. To see only this check's test file's lines, add `--include-logs`:

```sh
squeal why "src/math.test.ts > math > adds" --include-logs
```

It prints at most 200 of them and says how many there were. A log Squeal has pruned is reported as pruned; the result's errors are still in the store.

## squeal run --all

Queues every test file that has no result for the current files (`--force` queues all of them). Completion shows in headers and `squeal status` as `Full-suite checkpoint: completed at revision <current>`. Policy `stop.requireFullSuite` can require one before you stop.

`--wait [<ms>]` waits until the checkpoint ends, or at most `<ms>`, and gives its verdict as its first line, then the start line and status. Exit 0: it completed with every test file current, no known failures, and the worktree still at its revision (`Checkpoint <id> completed at revision 9: no known failures; 290 test files, 284 already current, 6 run now`). Exit 1: it completed with known failures, tests and test files that did not load counted apart. Exit 3: Squeal has no verdict (`Checkpoint <id> has no verdict: ...` or `No verdict: ...`): no daemon, the checkpoint abandoned, the deadline passed with files pending (the checkpoint goes on in the daemon), a test file without a current result, or an edit recorded a newer revision. On 3, wait again, or run the test command yourself.

## squeal run --slow

Asks the daemon to run the repository's slow files (`slow` in `squeal.config.json`: end-to-end and other suites too slow to run after every edit) as soon as no fast work of an edit is pending (background work such as a baseline does not hold them back). They also run on their own while you are idle, and when your last session ends the daemon runs them before it exits; ask when you need their result now, for example before saying the task is done. It prints how many slow files it queued at which revision, or that there are none to run (none declared, or all current at this revision). Their results arrive with your next tool call, so by default keep working; `--wait <ms>` waits after the request as `squeal status --wait` does, and also until every slow file it queued has its result, then prints status. It is the skill's step 4 before saying the task is done. Its first line ends with `the N slow files run --slow queued have their results`; on timeout it ends with how many of them are still pending and their paths, so say so, or wait again. A change of one of their checks (a slow failure) ends it early, as news. Exit 1 means no daemon runs, or the daemon predates `run --slow` (restart it with `squeal stop` then `squeal start`).

## squeal remove

Takes Squeal out of the repository: stops the daemon of every worktree, then deletes the store and the daemons' temp directories. `--config` also deletes `squeal.config.json`. Run it only when the user asks to remove Squeal. Exit 1 means a daemon did not stop and nothing was deleted; its output names the worktree. Exit 3 means it deleted what it could, and the paths it could not delete are listed under "Still there" with their error codes: tell the user. It prints what remains: the plugin, the config when kept, and the `squeal.config.json` of every other worktree, where the next session starts Squeal again. A deleted config that git tracks is a change to commit.

## squeal init

Sets Squeal up in a repository; the user runs it, or asks you to. `squeal init --harness codex --trust` shows the Squeal hooks Codex has not trusted and asks the user whether Codex should trust them. Never answer that question for the user, and never add `--yes` unless the user asked for it: trusting hooks lets them run code in every Codex session.
