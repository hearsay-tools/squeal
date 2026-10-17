# 004-66 notes: a requested wait tells a stale heartbeat from a stopped daemon (issue #12)

Wave 8, repair. Spec 004 D8 and D9, 011 C9, `research/issue-12.md`. Baseline 0.1.204 (011-01, 005-67 landed). No version bump and no build: the coordinator does both.

## What changed

- `src/cli/wait-liveness.ts` (new): `watchDaemon(worktreeId, { downMs })`. Each wait read calls `judge(record, at)`:
  - fresh heartbeat: `alive`;
  - no record: `down`, reason `stopped` (`squeal stop` and the unused stop clear it);
  - stale record: a background `ping` to the record's socket and to the computed one, one at a time. An answer, or a socket that accepts and times out (a stalled event loop, `SIGSTOP`), means `lapsed`: the wait goes on, and the oldest heartbeat age seen is kept as the lapse. Before the first ping returns, the record is `lapsed` too. When no socket listens, it is `down`, reason `silent`, once it stayed dead for `WAIT_DOWN_MS` (10 s, the Stop wait's `STOP_SLOW_DOWN_MS`), counted as the longer of the wait's time since its first dead socket and the record's time past the heartbeat grace. A daemon long gone therefore ends the wait at once.
- `waitForStatus` (`status --wait`, `run --slow --wait`) and `waitForNamed` (`status --wait <paths>`): `no-daemon` only on `down`. While `lapsed`, neither quiet nor a verdict is decided (review wave 4.5 S2 stays fixed: no "nothing pending" on a daemon that is not alive), so a lapse that never recovers ends on the deadline. Results gain optional `down` and `lapse` fields (additive type changes on `StatusWait` and `NamedWait`; option `downMs` on both option types).
- Text (`status-wait-lines.ts`):
  - stopped: `no daemon has validated since <T>: the daemon stopped`;
  - silent: `no daemon has validated since <T>: its heartbeat stopped and nothing listens on its socket`;
  - a wait that went on through a lapse appends `; the daemon's heartbeat went N s stale while its socket showed it alive (a busy store or a stalled daemon), so the wait went on` to its first line. For a named wait it goes before the `Selected:` line.
- `run --slow --wait` exit code (`slowWaitCode`): 3 when it returns without a daemon, or on timeout while a queued slow file is still pending; 0 otherwise, as before. Unavailable stays 1. With nothing queued (`holdSlow` false) it stays 0.

## Decisions the brief left open (my defaults)

1. The liveness check applies to every wait, the plain `status --wait` and fast named files included, not only slow ones. A stale heartbeat misleads the same way there, and gating by slowness would keep the bug in those waits.
2. A timeout with queued slow files still pending exits 3 too, as "no verdict" (it was 0). `test/cli/run-slow-wait.test.ts` was updated. A news outcome stays 0.
3. Socket only, no pid check: `DaemonRecord` records no pid. Adding one would be a type change in the heartbeat writer, which 011-01 and 001-435 own.

## Not done, for the coordinator

- Spec 004 D9 (or D8) needs the amendment text for this behaviour in `status.md` and `spec.md`. Workers do not edit them.
- `plugins/claude-code/skills/squeal/references/commands.md` (and its Codex, Pi and OpenCode copies) still say only "Exit 1 means no daemon runs …" for `run --slow`. They should add: exit 3 when the wait ended before the queued slow files had results. Not in this row's ownership.
- Bundles and key-format pins: the bundle-drift tests fail until the coordinator builds.

## Regressions (`test/cli/slow-wait-liveness.test.ts`)

- A live daemon with a stale heartbeat during a requested slow queue: `run --slow --wait` goes on past the lapse, ends quiet once the file finishes and the heartbeat recovers, names the lapse, and exits 0. The fake daemon got exactly one `run-slow` request, so there was no competing run. The named form gives its verdict after the lapse. A socket that accepts and never answers is not a stopped daemon, so the wait ends on its deadline.
- A stopped daemon: a cleared record and a closed socket give "the daemon stopped" and exit 3. A stale record with a dead socket ends after the down bound, as `silent`. A heartbeat 60 s old ends at once.
