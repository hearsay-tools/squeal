# 018-67 notes: the hashing limit also bounds the `ci record` process

Review `reviews/0.1.585.md` S1; spec D30, D20.2; row 018-61 before it (`tasks/018-61/notes.md`, "What remains").

## What changed

Each end of `ci record`'s endpoint hashing (before the command, after it) runs in a child process: `squeal ci endpoints-child`, a hidden subcommand, started through `CliIo.relaunch` (Node, its flags, the CLI script). The parent sends the end's work as one IPC message. The child sends `begin` with the number of paths, `hashed` counts (one message per event-loop turn), then the result or an error. The limit (row 018-61) stays in `ci record`'s process and is fed by those messages. Past the limit, the parent kills the child with SIGKILL, disconnects the IPC channel, destroys the stderr pipe and unrefs the child. Nothing of the child then keeps `ci record`'s process alive. A child stuck in an uninterruptible read dies when the read ends; nothing waits for it.

Code: `src/core/ci/endpoints.ts` (API, limit, comparison of the two ends), `src/core/ci/endpoints-hash.ts` (the work of one end: `HEAD`, `git ls-tree`, the hashes; plain data in and out), `src/core/ci/endpoints-child.ts` (the process boundary, both sides), `src/cli/ci.ts` (dispatch of the hidden subcommand; `relaunch` from `deps.endpoints.relaunch` or `io.relaunch`).

Now the whole end runs in the child, also `gitHead`, which reads `.git/HEAD` synchronously. A stuck synchronous read in `ci record`'s own process would block the limit's timer itself.

## Why not a worker thread

Measured on Node 26 here: a worker whose `fs.read` waits on a fifo forever. `worker.terminate()` never resolves, and the process never exits (killed by `timeout` after 10 s). The same read in a child process: kill, `disconnect`, `unref`, and the parent exits in 0.3 s.

## Decisions the brief did not settle

- **Without `relaunch`, each end hashes in this process, as before.** `ciCommand` called in-process (most tests) has no `relaunch`; `EndpointsOptions.hashFile` (a test's stalled read) works only there. The CLI's process entry always gives `relaunch`, so a user's `ci record` always uses the child.
- **One child per end**, not one child for both ends: the child does not stay alive during the user's command, and its lifecycle is one request and one answer.
- **Cost.** The bundled CLI starts in about 0.17 s here (`node dist/cli/squeal.mjs --version`, three runs: 0.15, 0.17, 0.19 s, load about 8). Each end now pays that once, about 0.35 s per `ci record`, inside `endpointsMs`. D30 measured about 1 s per end for cezar. A single child for both ends would save one start; not done (see above).
- **The child's env and cwd.** The child inherits `ci record`'s own environment (not the command's, which holds the recording's hooks) and runs in the worktree root. Its stdout is ignored; its stderr is piped and its last 2,000 characters name a crash ("its process ended with exit code N without a result: ..."), which `ci record` prints as `no endpoint hashes: hashing the checkout failed (...)`.
- **`squeal ci endpoints-child` run by hand** (no IPC channel) exits 2 with one line. It is not in the usage text.
- **The child exits when its parent goes** (`disconnect`), so a killed `ci record` leaves no hashing child, except one stuck in a read.

## Tests

- `test/ci/record-exit.test.ts`: `ci record` as a real process (`record-exit-entry.ts`, ended like `src/cli/index.ts`: `process.exitCode`, no `process.exit`), with a preload (`stall-read.mjs`) that makes the open of `stall.txt` wait forever on a fifo in Node's thread pool. The process exits with the command's code (1, a failing node:test test) about 3 s after it starts, with the note `passed its limit of 3.0 s (5 of 6 paths)` and a part without endpoint hashes. With hashing in-process (relaunch removed by hand), the same test holds the process until its 30 s kill: red.
- Same file: the normal case through the CLI's own entry (`src/cli/index.ts`), the part holds `stable` with `./`.
- The test's entry starts `endpoints-child-entry.ts` as the child, not the whole CLI: under tsx the CLI takes about 3 s to start, longer than a short test floor; the small entry starts in about 0.2 s.

## What remains

- The four bundle tests fail until the coordinator runs `pnpm run build`: `cli/squeal.mjs` changes.
- The spec's D30 text says what happens past the limit; it could add that the hashing runs in a child that is killed, so the process exits (the coordinator's `status.md` line).
