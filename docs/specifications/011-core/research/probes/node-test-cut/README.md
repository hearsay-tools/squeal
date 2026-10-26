# Probes: node:test after a cut's SIGTERM (row 011-230)

Throwaway probes behind `tasks/011-230/notes.md`. They start real `node --test` processes in a scratch directory and signal only those processes. They start no daemon and touch no HOME.

Set up a fixture once, in a scratch directory outside the repository:

```sh
mkdir -p fx/test
echo '{ "name": "kit", "private": true, "type": "module" }' > fx/package.json
cp held.mjs fx/test/cut.test.mjs   # K8's held file as the node:test pack writes it
```

- `order.mjs <reporter.mjs> <fx> <mode> [n] [delayMs]`: runs `node --test` with Squeal's reporter, waits for the held test's marker and signals. Mode `group` sends SIGTERM to the process group, as the runner does. Mode `stopped` sends SIGSTOP to the parent, SIGTERM to the group, then SIGCONT after `delayMs`, as a descheduled parent on a loaded host. Mode `child` sends SIGTERM to the test child, then to the group after `delayMs`. It counts each stream's shape: whether the file's wrapper `test:complete` and the final `test:summary` are there.
- `runner-cut.mts <worktree> <fx> [n]`: the same race through `runNodeTest`: SIGSTOP the parent, abort the run's `signal`, SIGCONT after 200 ms. It counts `run.json`'s `completed` (the stream is whole, which the rule before the fix counted) beside the report's completed files and file errors. Run it with the worktree's `node_modules/.bin/tsx`.

The reporter is `src/runners/node-test/runtime/reporter.mjs`.
