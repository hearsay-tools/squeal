# Issue 66 probe (throwaway)

Throwaway. Not product code, not a test. Delete when issue 66 is settled.

`run.sh <squeal-cli.mjs> [<scratch-dir>]` builds a two-worktree git repository
from `fixture/` under the scratch directory (default `/tmp/issue66-probe`),
with its own `HOME` and `XDG_RUNTIME_DIR`, so the store
(`<git common dir>/squeal/store.sqlite`), sockets and user config never reach
the real ones. It installs Vitest into the scratch tree; `node_modules` stays
out of git. The fixture has one setup file and two one-test files.

Steps, each printed with its output:

1. Worktree A runs the full suite: own PASS.
2. Worktree B registers a Claude Code session (SessionStart hook) and runs no
   test: its results are inherited from A.
3. A flag file outside the repository makes `slow.test.ts` sleep past the
   2 s tier timeout; A retries it: UNKNOWN, timed out, stored under the
   shared key.
4. B's PostToolBatch hook delivers the change notice; B's `status`,
   `status --full` and `why` follow.
5. B edits `setup.ts` (the `setupFiles` entry), runs the full suite, and
   prints `status --json` origins and `why` for each check.

Load is checked against the CPU count by the caller before `run.sh` starts.

`run-race.sh` (fixture `fixture-race/`): A and B daemons start together on one
key; `slow.test.ts` sleeps past the timeout only from worktree a's path. A times
out, B passes; shows a timeout stores nothing another worktree inherits.

`run-own.sh` (fixture `fixture-own/`): B inherits A's passes, then edits
`setup.ts` so B's own run of `slow.test.ts` times out; shows the UNKNOWN notice
and `why`'s retained inherited origin.

Outputs: `run-output.txt`, `run-race-output.txt`, `run-own-output-0.1.234.txt`
(0.1.234) and their `-0.1.233` twins. First attempts with a script sequencing
fault, kept for the record: `run-output-1-no-daemon-in-a.txt` (A started no
daemon), `run-race-output-1-early-delivery.txt` (B's delivery before A's
timeout), `run-own-output-1-early-*.txt` (the checkpoint predated the edit's
revision).
