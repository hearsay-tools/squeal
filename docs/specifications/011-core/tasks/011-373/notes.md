# 011-373: a SIGKILLed daemon's children beside its replacement

**Verdict: measured, no fix.** The killed daemon's full integrity check runs on after the kill and holds the store open read-only. It does not hold the replacement up. Its runner host ends within about 25 ms of the kill. No product code changed.

## The children

Found from `src/core/daemon/`:

- The full check: `runFullCheck` in `src/core/daemon/full-check.ts`. `node -e <script> <store> 10`, argv0 `squeal <project> check`, nice 10, stdin ignored, stdout a pipe to the daemon. It opens `store.sqlite` read-only and runs `PRAGMA integrity_check(10)`. Nothing ties its life to its parent: it ends when the check ends, then writes to a pipe with no reader.
- The runner host: `src/core/runner-host/channel.ts` spawns `cli runner-host <root> --runner vitest` with three pipes. The host ends when its input ends, which the kill causes (`src/core/runner-host/host.ts`, row 018-37).

## Measurement

Host: this project's VM, load 13–16 during every run (shared with other coordinators). Scratch fixture repository, scratch HOME, `XDG_RUNTIME_DIR` under `/tmp`.

**Natural lifetime** (a first version of the test, not committed). Store grown with 800,000 rows of filler (about 180 MB; `integrity_check` about 3.6 s per 500,000 rows here). Daemon killed 300 ms after its full check started. Replacement started at once. Control: the same store, the replacement killed with no full check running, a second replacement started.

| run | check lived after the kill | replacement serving / ready | control serving / ready | check alive when the replacement served |
| --- | --- | --- | --- | --- |
| 1 | 4,232 ms | 602 / 1,592 ms | 680 / 1,720 ms | yes |
| 2 | 4,157 ms | 591 / 1,447 ms | 566 / 1,441 ms | yes |
| 3 | 3,931 ms | 633 / 1,458 ms | 553 / 1,393 ms | yes |

The replacement serves and reaches ready, past its start's writes, while the dead daemon's check still reads. Its times match the control's within the noise. The runner host had ended in every run.

**What the check holds**: `/dev/null` twice (stdin, stderr), `store.sqlite`, `store.sqlite-wal`, `store.sqlite-shm`. Not the daemon lock (`locks/<worktree-hash>.sqlite`, which the OS frees at the kill) and not the socket.

**Why it does not get in the way**: the store is in WAL mode (`src/core/store/open.ts`). A reader does not block a writer or another reader. The replacement's start runs `quick_check` (a read) and writes in WAL. The only thing a long reader blocks is a WAL checkpoint past its snapshot: the idle `TRUNCATE` checkpoint (`src/core/daemon/idle-checkpoint.ts`) runs after a minute of quiet, reports `busy` and is tried again, so at most it waits for the check to end. Every other daemon on the same store already runs beside another daemon's full check this way.

## The test

`test/daemon/sigkill-children.test.ts` (Linux only, `/proc`). It grows the store with 300,000 rows of filler (about 70 MB), clears the day's claim, starts a daemon and waits until its full check has the WAL open. It then freezes the check with SIGSTOP, so the check holds its read snapshot through the whole replacement start whatever the load, and kills the daemon with SIGKILL. It asserts that the replacement serves and reaches ready while the frozen check is alive and holds the store and its WAL, that the check holds no lock file, and that the runner hosts end. A replacement that waited for the check would time out at ready (60 s). Five local runs, all passed: serving 501–593 ms and ready 1,513–1,825 ms after the kill; runner hosts gone 24–25 ms after the kill (the first three runs polled the hosts only after ready, so they read the same as ready).

The test kills its frozen check and every daemon it started in its cleanup.

## For the coordinator

- An observation, not in this row: the killed daemon took the day's full-check claim (`store.full-check` in `meta`) and never answered it. The replacement runs no full check (the first test version asserted it had no check child). The orphaned check's answer goes nowhere: a fault it found would not mark the store. So after a SIGKILL during the check, the next full check of that store is up to 24 hours later. Row 011-235 gives the claim back for a check that could not run or was stopped, but a SIGKILL leaves no one to give it back. A candidate for a proposed row if a day's delay of the full check matters.
- No 20-rerun or CI evidence; the five local runs above are the evidence.
