# 011-277 notes: `squeal stop <root>` after the root is removed

Row 011-277 (gh-126; `tasks/wave-61.md` W4; 011 C1, C9, C14; `research/issue-126.md`). The human approved "Worktrees: As recommended" on 2026-10-30: build the stop from the saved daemon identity. Worker run `922e00f9`, 2026-10-31.

## What changed

`src/cli/stop.ts` no longer refuses every missing explicit root. `stopArgs` sends a named path that `lstat` cannot find to `stopRemoved` (`src/cli/stop-removed.ts`), and refuses it with `--until-start` (below). A path that is there keeps task 011-09's rule as it was: not a worktree's top level, nothing stopped, exit 1.

`stopRemoved`, in order:

1. `formerRoot`: the real path of the nearest ancestor that is there, and the removed names below it. While the root existed, `worktreeIdFor` hashed `realpathSync(root)`, which is this path.
2. `idOf`: the same hash over that path (`worktreeIdFor` throws on a missing root, so the formula is repeated, in one place).
3. `servingDaemon`: ping at `socketPathFor(id)`. An answer that is no ping, or a socket that does not answer: unknown, nothing stopped, exit 1. A ping whose `worktreeId` or `root` is not this path's: "the daemon at <socket> serves <other>, not <root>; nothing stopped", exit 1, and no stop is sent.
   No answer (`ENOENT`, `ECONNREFUSED`): `noDaemon` looks for the worktree's row (id and root) in two stores, of the checkout the path's nearest existing ancestor lies in and of the checkout the CLI runs in. A row there (a daemon that exited clears its record and keeps its row): "No daemon running for <root>, which does not exist; nothing stopped", exit 0. No row: task 011-09's "squeal: <path> does not exist; nothing stopped", exit 1.
4. While the daemon runs: its process start (`statOf`), to tell its pid from a reuse; its marks (`marksOf`): its group, and the token from its store record (`savedToken`).
5. `savedToken`: the removed root names no common dir, so the store is found by the lock file the daemon holds open, `<common-dir>/squeal/locks/<id>.sqlite`, read from `/proc/<pid>/fd` (`createProcSource().fds`, `lockFileParts`), as `squeal ps` does (spec 014 D2). The token is used only when the store's row for the id has this root and its record has the ping's start time (`tokenOf`'s rule). Linux only.
6. Stop request; then the waits: the socket closes (`socketMs`), the daemon's process ends (`lockMs`; with the root gone there is no lock to probe through `resolveCommonDir`, so its process ending is the proof), the processes it started are gone (`leftoversMs`).
7. Result: stopped (exit 0), still running past a bound and named (exit 1), or unknown (exit 1) when its processes cannot be traced: off Linux, or no group and no token.

No stopped mark is left: no hook runs in a root that is gone, and a worktree made later at the same path is a new one. `--until-start` with a missing path is refused before anything is asked: "squeal: <path> does not exist, so there is no worktree to hold; create it first, or drop --until-start to stop the daemon of a removed one; nothing stopped", exit 1. An orchestrator that stops a child before it creates it must not read a hold into exit 0 (row 011-278).

`src/cli/stop-waits.ts` holds what both stops share, moved out of `stop.ts` unchanged in behaviour: `socketClosed`, `leftoversGone`, `leftoversClause`, `seconds`, `processGone`. `stop.ts` went from 299 to 290 lines.

## Texts

```text
Squeal daemon stopped for /tmp/x/wt-a, which does not exist, and no process it started still runs
Stop requested; the daemon for /tmp/x/wt-a stopped, but a process it started still runs after 10 s: pid 123 node -e ...
Stop requested; the daemon for /tmp/x/wt-a (pid 120) still serves after 60 s
Stop requested; the daemon for /tmp/x/wt-a (pid 120) closed its socket but still runs after 30 s
Squeal daemon stopped for /tmp/x/wt-a, which does not exist; whether a process it started still runs is unknown: it leads no process group, and no token of this start was found
No daemon running for /tmp/x/wt-a, which does not exist; nothing stopped
squeal: /tmp/x/wt-typo does not exist; nothing stopped
squeal: /tmp/x/wt-c does not exist, so there is no worktree to hold; create it first, or drop --until-start to stop the daemon of a removed one; nothing stopped
squeal: the daemon at /run/user/1000/squeal-<id>.sock serves /tmp/x/wt-b, not /tmp/x/wt-a; nothing stopped
```

## Decisions the brief did not settle

Settled with the coordinator, request `4c3a5f19` (2026-10-31):

- A missing path with no daemon answering exits 0 only when a store keeps the worktree's row (a worktree that existed and whose daemon exited); with no row (a typo, a path that never was a worktree) it keeps task 011-09's result, exit 1. My first proposal, exit 0 for every missing path, was narrowed to this. Task 011-09's protection, never the checkout around the path, is unchanged: only the socket of the path's own id is asked, and a store row decides only the exit code. `test/cli/stop-root.test.ts` keeps its three missing-path expectations (its fixture has no store).
- `--until-start` with a missing path is refused up front, exit 1, nothing stopped (the coordinator approved my default).

My choices:

- "Unknown" exits 1, as the existing stop's unchecked lock does.
- The stores searched for a kept row: the checkout the removed path lay in (a nested worktree, as Cezar's `.ai/cezar/worktrees/<id>`), and the checkout the CLI runs in (an orchestrator in its own checkout). A worktree beside the checkout, stopped from outside the repository, reads as unknown to any store: exit 1.
- No machine-wide process scan to find the daemon: only the socket of the path's id is asked, and `/proc/<pid>/fd` of the daemon that answers there is read.

## Tests

`test/cli/stop-removed.test.ts`: a checkout with two linked worktrees beside it (the issue's fixture), store rows with tokens, and stand-in daemon processes that hold their lock file open, start a test process carrying the token, and answer ping and stop.

- A is removed while its test process runs; `squeal stop A` stops A's daemon and test process; B's daemon still answers and its test process still runs.
- A daemon that leads no group: only the store's token ties its test process to it, and the stop names that process when it outlives the daemon.
- A store record of another start: its token is not used; with no group the result is unknown.
- A daemon that holds no lock file open and leads no group: unknown.
- An exited daemon, its socket gone or left behind (a stale identity), run from the checkout: nothing stopped, exit 0; B goes on.
- A removed worktree that lay inside the checkout, run from outside it: its row is found through the checkout, exit 0.
- A mistyped path, and a removed sibling worktree run from outside the repository: task 011-09's refusal, exit 1.
- `--until-start` on a removed root and on a path not made yet: refused, exit 1; A's daemon is not asked.
- A daemon at A's socket that answers for B (a reused identity): refused, exit 1, no stop sent.

## Limits

- A later daemon's store prune deletes the row of a worktree whose root has no `.git` (`src/core/store/prune.ts`). After that, a removed worktree whose daemon exited reads as never known: exit 1.

- A daemon started from another environment listens at the socket its store records, not at this environment's computed one. With the root gone, the store cannot be found before a daemon answers, so such a daemon reads as none.
- A removed name that was a symbolic link gives another former path, so no daemon is found and nothing is stopped. That is safe, not wrong; it is the case the brief's stopping condition names, and it gives no other worktree's identity.
- Off Linux the result is "unknown" when the daemon stopped, since no process list or fd list is read there. The existing stop reports "stopped" there without checking its processes; that was left alone.
- `squeal --help`'s stop line (`src/cli/main.ts`) and `README.md` "Removing a worktree" do not mention a removed root. Neither is this row's file; the skill reference (`references/commands.md`, `## squeal stop`) does.

## Left to the coordinator's build

The bundles (`cli/squeal.mjs` in the Codex runtime, Pi and OpenCode packages) and the Codex runtime's copy of `references/commands.md` are build outputs: the runtime copy carries a sha256 in its manifest, and past reference edits (`b80d225a7`) left it to the release. This row edits the Claude Code and Pi copies only. Until the build, `test/harness/skill.test.ts` ("the same ... in the Codex and Pi copies"), `test/harness/codex/packaging/runtime.test.ts` and the three packages' "exactly as `npm run build:plugin` produces them" checks report that drift.

## R1: the saved socket first (review 0.1.383 B1)

Wave 61.5 RP1, worker 5fbadfdb, 2026-10-31.

The stop pinged only `socketPathFor(id)` from the caller's environment and read the saved row only as a Boolean. A daemon started with another `XDG_RUNTIME_DIR` listens at the socket its store records, so the stop said "No daemon running", exit 0, while that daemon served. This replaces the second item of "Limits" above.

What changed in `src/cli/stop-removed.ts`:

1. `savedRow` reads the worktree's row before any socket is chosen, from the same two stores as before: of the checkout the path lay in, and of the one the CLI runs in. `rowKept` (a Boolean) is gone; `noDaemon` reads the row.
2. `servingDaemon` applies C1's rule to the row's record: the recorded socket first while its heartbeat is fresh (`daemonLiveness`, the test `locateDaemon` makes), then the computed one. `servingAt` keeps the checks each socket had: an answer that is no ping is unknown, exit 1; a ping of another id or root is refused, exit 1, and no stop is sent.
3. A recorded socket whose heartbeat is late is not asked to stop (C1 picks the computed one then). But it is pinged before no daemon is claimed. Nothing answers there: "No daemon running", exit 0. Anything else (a ping, another answer, a timeout): "squeal: whether a daemon serves <root> is unknown: <socket>, the socket its store records, is in use, but the heartbeat it records is late, last at <ISO>; nothing stopped", exit 1.

`locateDaemon` is not called: it hashes `realpathSync(root)`, which throws for a root that is gone, and `src/core/daemon/ensure.ts` is not this repair's file. Its freshness test, `daemonLiveness`, is reused. How a daemon records its socket is unchanged.

Unchanged: the refusal for a path no store it can read knows (exit 1), the ban on the checkout around the path, the root and id checks, the process-start check (`statOf`), the token's start check (`savedToken`), the waits and their bounds.

Tests (`test/cli/stop-removed.test.ts`):

- The review's case: A's and B's daemons bound under the runtime dir they started with, A removed, the CLI in another runtime dir, run from the checkout. A's daemon and test process stop; B's daemon answers and its test process runs. Before: exit 0, "No daemon running", A still served.
- A late heartbeat whose recorded socket A's daemon still serves, the CLI in another runtime dir: unknown, exit 1; A and B run on. Before: exit 0, "No daemon running".
- A late heartbeat whose recorded socket is left behind (nobody accepts), the CLI in another runtime dir: "No daemon running", exit 0. It passed before too; it guards the exit 0 of an exited daemon.

Decisions the brief did not settle, my choices:

- A late heartbeat's socket is pinged, not left unexamined. Without the ping, a daemon killed in another environment would leave its removed worktree at exit 1 ("unknown") for good. With it, a socket with no listener gives an honest exit 0.
- A late heartbeat's socket that is in use is never asked to stop, even when its ping names this root and id: C1 picks the computed socket then. The result is unknown, exit 1, with one text for every answer there.
- A daemon that answers at a fresh recorded socket for this root and id is stopped whatever its start time. The ping's root and id are the identity check, as at the computed socket; the start time still gates the token.
- Still a limit: run from outside the repository, with the worktree beside the checkout, no store is read, so a recorded socket is not known. The computed socket alone decides. With no daemon there the result is task 011-09's refusal, exit 1, never "No daemon running".
