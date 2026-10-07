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

- **Known failures: 0** with pending checks means "no known failures yet". Say that, not "all tests pass".
- Pending checks mean the current revision is not fully validated yet: say what is still pending.
- No full-suite checkpoint at the current revision: say so; `squeal run --all` requests one.

`squeal status --json` gives the same snapshot as a versioned JSON object.

## Waiting for pending checks

Results arrive with your next tool call, so by default keep working. Only when you need a result before your next step, for example before saying the task is done, run `squeal status --wait 60000`. It replaces `sleep` and polling.

It returns as soon as nothing is pending at the current revision, or as soon as a check changed (a new failure or a recovery), and at the latest after the given milliseconds; then it prints status. Its first line says why it returned, with the revision and the time waited:

- `Returned on quiet`: nothing is pending at the current revision.
- `Returned on news`: a check changed; read it as you would a SQUEAL message.
- `Returned on timeout`: checks are still pending. Say so, or wait again.
- `Returned without a daemon: no daemon has validated since <time>; results are as of revision N`: nothing gets validated, so results are as old as that revision, whatever the files hold now. Run `squeal start` and wait again, or run the tests yourself.

The exit code is 0 in all four cases. Keep the limit below your shell tool's own timeout. It returns no sooner than 750 ms after it starts, so a revision for an edit you just made is recorded first. It starts no daemon. With `--json`, stdout is the snapshot with a `wait` field (`outcome` is `quiet`, `news`, `no-daemon` or `timeout`) and the line goes to stderr.

## squeal why

`squeal why "<check name>"` prints the history and provenance of one check and the path to its last run log, which holds the full output; SQUEAL messages carry only the first error line and its location. A FAIL report ends with the command for its first failure:

```text
Full output: squeal why "src/math.test.ts > math > adds"
```

Use a name exactly as a SQUEAL message or `squeal status` printed it. Any unique part of the name also works.

## squeal run --all

Queues every test file that has no result for the current files (`--force` queues all of them). Completion shows in headers and `squeal status` as `Full-suite checkpoint: completed at revision <current>`. Policy `stop.requireFullSuite` can require one before you stop.

## squeal remove

Takes Squeal out of the repository: stops the daemon of every worktree, then deletes the store and the daemons' temp directories. `--config` also deletes `squeal.config.json`. Run it only when the user asks to remove Squeal. Exit 1 means a daemon did not stop and nothing was deleted; its output names the worktree. Exit 3 means it deleted what it could, and the paths it could not delete are listed under "Still there" with their error codes: tell the user. It prints what remains: the plugin, the config when kept, and the `squeal.config.json` of every other worktree, where the next session starts Squeal again. A deleted config that git tracks is a change to commit.
