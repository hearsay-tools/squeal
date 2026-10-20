# Commands

`squeal --help` lists every command and flag. This file says what their output means.

## squeal status

Prints the current state of this worktree, its verdict first. It reads the store and needs no daemon.

```text
Revision: 187
Known failures: 0; not current: 27 of 290 test files (3 running, 24 unknown), 3 tests (3 running)
Affected checks: 47 passed (40 tests, 7 test files loaded), 3 running (3 tests), 0 queued
Full-suite checkpoint: none completed since revision 170 (the counts are for revision 187; `squeal run --all` requests one)
Outstanding:
  3 test files in the vitest tier of 3 test files running since 12:04:20: test/cart.test.ts, test/money.test.ts, test/tax.test.ts; no command runs them sooner (a running tier is not interrupted)
  24 test files never run at their inputs, nothing queued them (the baseline is lookup-only): test/api.test.ts, test/auth.test.ts, test/billing.test.ts and 21 more; `squeal retry <test file>...` runs each once, `squeal run --all --wait` runs all 27 test files not current here
More: `squeal status --full` adds the worktree and daemon
```

`Known failures: 0` with test files not current means "no known failures yet": the current revision is not fully validated. The skill's step 4 says what to claim from it. When slow files are among the checks running and queued, `Affected checks` names them, a few by path and the rest by count, and `squeal run --slow --wait 60000`, which waits for their results.

`Outstanding:` groups the test files that are not current by what holds them, and each group ends with the command that advances it, or says that none does and why: no daemon validates (`squeal start`), files never run or stale at their inputs (`squeal retry <test file>...`, or `squeal run --all --wait` for all of them), a running tier, a queue, another worktree's run of the same inputs, a pending retry, a checkpoint in progress. It shows at most six groups and three paths a group, and counts the rest. Slow files the `Slow tier:` line counts are not repeated there. Run a group's command only when you need that result now; results still arrive with your next tool call. With every test file current, there is no `Outstanding:` block.

`More:` names what `squeal status --full` adds after it: the worktree and daemon, the results inherited from other worktrees and where from, each test file without a result with its reason, and Squeal's notes. `squeal status --notes` is `--full` with each note listed on its own line.

`squeal status --json` gives the same snapshot as a versioned JSON object; its `outstanding` field holds the groups, each with what holds it (`standing`) and all of its `files`.

In a Codex or Pi shell, status adds a line starting `Codex:` or `Pi:` when no Squeal consumer of this session is registered in this worktree: Squeal's hooks or Pi extension do not run in the session, or have not registered it yet. The line names the step that enables them (trusting the hooks, installing the Pi package); tell the user, and leave the step to them.

## Waiting for pending checks

Results arrive with your next tool call, so by default keep working. Only when you need a result before your next step, for example before saying the task is done, run `squeal status --wait 60000`. It replaces `sleep` and polling.

It returns once the test files your edits re-keyed since Squeal last told you something have their results (a pass, a failure, a skip, or unknown with a reason), or as soon as one of their checks changed (a new failure or a recovery), and at the latest after the given milliseconds; then it prints status as `squeal status` does (`--full` adds the same detail), and last the line saying why it returned. An edit to an environment input (the Vitest config, a setup file, the installed lockfile) re-keys every test file, and a pytest project's config or a sync of its environment every file of that project, so its wait holds for all of them. A baseline, a backlog, slow files and other worktrees' work do not hold it, and other checks' changes do not end it: the line counts them, and the `Outstanding:` block above it says what else is not current. When slow files are not current, a quiet line says so and names `squeal run --slow --wait 60000`, which waits for their results, joining a slow file already running.

Its last line says why it returned, with the revision and the time waited, then the worktree's known failures and its checks running and queued:

- `Returned on quiet`: none of the test files your edits re-keyed is pending; while other test files are not current, it adds `this wait does not hold for the rest of the worktree`. Quiet says no result your edits owe is outstanding, not that they passed: read the outcome in the snapshot it prints.
- `Returned on news`: a check of those files changed; read it as you would a SQUEAL message.
- `Returned on timeout`: some of those files are still pending, and the line says how many. Wait again, or say so; a timeout is no reason to run those files yourself.
- `Returned without a daemon: no daemon has validated since <time>; results are as of revision N`: nothing gets validated, so results are as old as that revision, whatever the files hold now. Run `squeal start` and wait again, or run the tests yourself. The wait starts no daemon.

The exit code is 0 in all four cases. Keep the limit below your shell tool's own timeout. On a busy host give it `120000`: at load 100 to 170 on 24 CPUs, an edited file's result took 1 to 16 s at the median and up to 51 s. A daemon from an older release names no files: the wait then returns when nothing at all is pending, or on any check's change. With `--json`, stdout is the snapshot with a `wait` field (`outcome` is `quiet`, `news`, `no-daemon` or `timeout`; `edit`, when the daemon named the files, holds `since`, the first revision of the window, `testFiles`, `pending` and `otherTransitions`) and the line goes to stderr.

Results for particular files also arrive with your next tool call; when you need them first, name them: `squeal status --wait 60000 <path>...`. Name the files you just changed when the wait above would hold for many more (after an edit to an environment input, or other edits that re-keyed most of the suite), or a test file your edits did not re-key, which the wait above does not hold for. A test file's path selects only that test file, even when other test files import it or read it; any other path, such as a source file, selects every test file that imports or reads it, as far as Squeal's record for this worktree knows. The wait returns when every selected file has a result at the current revision, or at the deadline. A selected slow file is held for like any file, since it runs after the fast tests; under `slow.trigger: "idle"` one that waits for a pause or `squeal run --slow` is not held for: the verdict line names it, and a wait that selects only such files returns at once without a verdict (exit 3). It prints the revision line, then the files it selected and their failures in full, and last their verdict, `Named test files at revision N: no known failures; ...` or `Named test files have no verdict: ...`, which counts the files still pending by what holds them, then the worktree's known failures and what in it is not current; `--full` prints the worktree's status first. Without a verdict, one line per class comes before it (`Pending:`, `Current:`, `Stale:`, `Unknown:`), and each pending file says what holds it, with a bound when one is known: its run in a lane, a tier running before it, another worktree's run of its key, the slow tier, or a revision not listed yet. It exits 0 with every selected file current and passing, 1 with a known failure among them, and 3 without a verdict (a file pending at the deadline or unknown, no daemon). A path that selects nothing exits 3 with `No verdict: no test file's closure holds <path>`; name the test file itself instead. Other files' work and changes do not affect it.

`squeal status <path>...` without `--wait` answers the same question now, without waiting for pending files, whose results arrive with your next tool call. It asks the daemon whether its pass over your edits is stored, for at most 750 ms, then prints the same lines, its last `Named test files at revision N: ...` with a verdict or `Named test files have no verdict at revision N: ...` without one. When the daemon has not stored that pass in time, the line says `results are as of revision N; the daemon has not stored its pass over the latest edits` and gives no verdict, since an older result may not hold your edits; a daemon that cannot answer at all gives none either (`the daemon did not answer its sync`): wait with `squeal status --wait 60000 <path>...`. It exits as the wait does, 0, 1 or 3. Unlike the wait, it does not move a named test file ahead of other queued work. With `--json`, stdout is the snapshot with a `named` field whose `outcome` is `snapshot`, and the lines go to stderr.

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

When the result shown ran at a revision older than the current one, a `Changed since revision N:` line lists each path changed after it, with the revisions that changed it (at most 20 of each). Those changes are what the result has not seen; at the current revision the line is absent.

Its `Run log:` line names the `vitest.log` of the run that produced the result shown, from the worktree it was inherited from when it was. That file holds the run's `console` output, but it covers every test file of that run, not only this check. To see only this check's test file's lines, add `--include-logs`:

```sh
squeal why "src/math.test.ts > math > adds" --include-logs
```

It prints at most 200 of them and says how many there were. A log Squeal has pruned is reported as pruned; the result's errors are still in the store.

## squeal run --all

Queues every test file that has no result for the current files (`--force` queues all of them). Completion shows in the full header (at registration and Stop) and `squeal status` as `Full-suite checkpoint: completed at revision <current>`. Policy `stop.requireFullSuite` can require one before you stop.

`--wait [<ms>]` waits until the checkpoint ends, or at most `<ms>`, and gives its verdict as its first line, then the start line and status. Exit 0: it completed with every test file current, no known failures, and the worktree still at its revision (`Checkpoint <id> completed at revision 9: no known failures; 290 test files, 284 already current, 6 run now`). Exit 1: it completed with known failures, tests and test files that did not load counted apart. Exit 3: Squeal has no verdict (`Checkpoint <id> has no verdict: ...` or `No verdict: ...`): no daemon, the checkpoint abandoned, the deadline passed with files pending (the checkpoint goes on in the daemon), a test file without a current result, or an edit recorded a newer revision. On 3, wait again, or run the test command yourself.

## squeal run --slow

Asks the daemon to run the repository's slow files (`slow` in `squeal.config.json`: end-to-end and other suites too slow to run after every edit) as soon as no fast work of an edit is pending (background work such as a baseline does not hold them back). They also run on their own after the fast tests (under `slow.trigger: "idle"`, only while you are idle), and when your last session ends the daemon runs them before it exits; ask when you need their result now, for example before saying slow tests pass. It prints how many slow files it queued at which revision, or that there are none to run (none declared, or all current at this revision). Their results arrive with your next tool call, so by default keep working; `--wait <ms>` waits after the request as `squeal status --wait` does, and also until every slow file it queued has its result (one already running counts: the wait joins its run instead of starting another), then prints status, and last the line saying why it returned. Whether it is needed before saying the task is done is the repository's policy, read off the end of the `Slow tier:` line (the skill's step 4): `Stop waits up to … for them or holds the agent once` means it is, once you change a file; any other ending means it is not, and a claim that slow tests pass still needs the line to say every slow file is current. That last line says `the N slow files run --slow queued have their results`; on timeout it says how many of them are still pending and their paths, so say so, or wait again. A change of one of their checks (a slow failure) ends it early, as news. Exit 1 means no daemon runs, or the daemon predates `run --slow` (restart it with `squeal stop` then `squeal start`). With `--wait`, exit 3 means it has no verdict: the wait returned without a daemon, or timed out with a slow file it queued still pending; say so, or wait again.

## squeal remove

Takes Squeal out of the repository: stops the daemon of every worktree, then deletes the store and the daemons' temp directories. `--config` also deletes `squeal.config.json`. Run it only when the user asks to remove Squeal. Exit 1 means a daemon did not stop and nothing was deleted; its output names the worktree. Exit 3 means it deleted what it could, and the paths it could not delete are listed under "Still there" with their error codes: tell the user. It prints what remains: the plugin, the config when kept, and the `squeal.config.json` of every other worktree, where the next session starts Squeal again. A deleted config that git tracks is a change to commit.

## squeal init

Sets Squeal up in a repository; the user runs it, or asks you to. `squeal init --harness codex --trust` shows the Squeal hooks Codex has not trusted and asks the user whether Codex should trust them. Never answer that question for the user, and never add `--yes` unless the user asked for it: trusting hooks lets them run code in every Codex session.
