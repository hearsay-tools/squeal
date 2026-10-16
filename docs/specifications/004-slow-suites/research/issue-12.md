# Issue 12 reproduction: requested slow work "loses its daemon"

Brief: `research/issue-12-brief.md`. Issue: https://github.com/hearsay-tools/squeal/issues/12 (read 2026-10-16 with `gh issue view 12 --json`, open, no comments; reported against 0.1.199). Source examined at `785c966d` (0.1.200). The liveness, lifecycle, slot and store code is unchanged since the `squeal--v0.1.199` tag (`git diff --stat` only touches `leftovers.ts` and `terminate.ts`). Experiments ran the installed 0.1.199 bundle and the `cand/0.1.201` bundle (f9c29e11, which carries 001-422). They ran in isolated fixtures on 2026-10-16 between 20:40 and 20:51 UTC, at host load 15 to 23 on 24 CPUs. Reproduction only: no product file, board, spec or status was changed.

## Vision alignment

Aligned with `docs/vision.md` principles 2 (current state), 3 (feedback beside ongoing work) and 7 (actionable evidence). A live daemon reported as absent can trigger competing manual validation; the request asks for trustworthy status and recovery within Squeal’s existing role. It does not ask Squeal to own the coding task or replace the test runner. The friction label identifies an agent-origin report, not independent proof of its suspected cause.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the requested slow work lose its daemon under shared-slot contention? | In the fixture, no. One daemon pid was alive throughout, the request stayed queued, and the same daemon ran all 3 requested slow files about 10 s after the slot freed. For the original incident this is not determined, because no pid or exit reason was recorded, and the user's own `squeal stop` ended it. | verified by experiment (fixture); not determined (incident) |
| 2 | Or does a missing heartbeat only report it lost? | Yes, deterministically. While another connection holds the store's write lock for longer than about 10 s, the heartbeat write fails. Status then says "no daemon running", and both waits return the incident's exact text while the daemon process is alive. An event-loop stall of the same length does the same. | verified by experiment, 0.1.199 and 0.1.201 |
| 3 | Does waiting for a permit drop ownership of an explicit request, or stall the daemon? | No. `acquireSlowSlot` never blocks. With the slot held elsewhere and the store free, 20 of 20 status reads said "running". `Scheduler.busy()` counts pending slow files, so 001-415's unused stop does not fire. The 004-29 and 001-219 drains need no consumers, and this scenario had consumers. | verified by experiment (no lapse); read in source code (busy, drains) |
| 4 | Why did the agent see "no daemon" and fall back to a direct run? | `status --wait` ends with outcome `no-daemon` at the first settled poll whose heartbeat is older than 10 s, with no tolerance. Both waits ended this way during a 16 s lock, 44 s before their 60 s deadline. The text tells the agent that "`squeal start` starts one", but during the lapse `start` answered "Squeal daemon alive". | verified by experiment; read in source code |
| 5 | Is a reason recorded? | Not where the agent looks. 0.1.199 logs `heartbeat failed: Error: database is locked` to stderr only, and a hook-spawned daemon's stderr is `/dev/null`. 0.1.201 adds one line after the episode ("the store was busy for 12.9 s …"). Neither wait's output carries a reason, and the lapse remains on 0.1.201. | verified by experiment; read in source code |
| 6 | What held cezarion's store in the incident? | Not determined, because the incident left no daemon log or lock-holder record. Candidates are inferred under question 6 below. | inferred |

## Findings

### 1. Deterministic mechanism (verified by experiment)

`probes/issue-12/probe.sh` (outputs in `output-0.1.199-lock.txt` and `output-0.1.201-lock.txt`) starts a foreground daemon on an empty fixture. It reads `squeal status` once a second and checks the daemon's pid each time.

- **A, negative control, nothing held, 14 s:** every read said `Daemon: running, last heartbeat 0–5 s ago`.
- **B, `hold-store.mjs` holds `BEGIN IMMEDIATE` for 20 s:** from about 10 s after the last heartbeat until the lock was released, status read `dirty state not known: no daemon is validating`. That was 11 reads on 0.1.199 and 12 on 0.1.201. The pid stayed alive the whole time. The 0.1.199 stderr showed `heartbeat failed: Error: database is locked` three times. Within a second of the release, status read `running, last heartbeat 3 s ago`.
- **C, `SIGSTOP` for 14 s, an event-loop stall:** status reported no daemon for 7 reads (9 on 0.1.201), then `running` again after `SIGCONT`, with the same pid.

The cause, read in source: liveness is `now - heartbeatAt <= heartbeatIntervalMs * 2`, which is 10 s (`src/core/delivery/liveness.ts` `daemonLiveness`; `HEARTBEAT_GRACE_INTERVALS = 2`). The heartbeat is a store `UPDATE` on a `setInterval` (`src/core/daemon/lifecycle.ts:279`). Each store write waits up to `DAEMON_BUSY_TIMEOUT_MS`, 5 s, synchronously on the event loop. In 0.1.199 each tick makes three writes in a row (heartbeat, harness check, leaving check), so a busy store can also stall the socket and timers. A heartbeat is a write, so no retry policy can record one while another connection holds the write lock.

### 2. The incident's shape (verified by experiment)

`probes/issue-12/probe-slow.sh` (outputs in `output-0.1.199-slow.txt` and `output-0.1.201-slow.txt`) uses a Vitest 5 fixture with one fast file and three slow files. `hold-slots.mjs` holds the only slow permit for 75 s. Status then read "3 pending, waiting for the slow slot another worktree's slow tier holds" and "Daemon: running", as the issue's 19:25 status did. Next, `run --slow --wait 60000` and `status --wait 60000 test/slow/a.test.js` started, and the store lock was held for 16 s.

- Named wait, exit 3: `Named test files have no verdict: no daemon has validated since 2026-10-16T20:49:51.741Z; results are as of revision 0; \`squeal start\` starts one`. This is the issue's text.
- `run --slow --wait`, **exit 0**: `Returned without a daemon: no daemon has validated since …`.
- `squeal start` during the lapse printed `Squeal daemon alive for …`. `pgrep` found one daemon before and after it, so no competing daemon was spawned.
- Negative control: with the store free and the slot still held, 20 of 20 reads said `Daemon: running`.
- After the slot was released, the same pid ran the 3 slow files: `Slow tier: 3 test files; 3 current at revision 0`. Nothing requested was lost.

The 0.1.201 bundle gives the same verdicts, plus `the store was busy for 12.9 s (another connection held its write lock); ran once it was free: the heartbeat, the next tier` on stderr.

### 3. Why a lapse ends the wait (read in source code)

`src/cli/status-wait.ts:304` reads `settled && daemon.state !== "alive" ? "no-daemon"`. One stale read ends the wait. Spec 004 D9's Stop waiting entry, by contrast, waits "until the daemon has been down for 10 s". The `no-daemon` text comes from `noDaemonText` (`src/cli/status-wait-lines.ts`). It cannot tell a stale heartbeat from a stopped daemon, and it names no reason. `ensureDaemon` probes the socket before it spawns (`src/core/daemon/ensure.ts`), and the daemon singleton lock refuses a second daemon, so the fallback it suggests is harmless but misleading. The direct browser run the agent launched is the competition the issue's "Expected" section wants to avoid.

### 4. Ownership while waiting for permits (read in source code)

`acquireSlowSlot` returns `null` and the tier retries on the next pass (`src/core/slow/slot.ts:66`). The request stays in the scheduler's ledger. `busy()` returns true while `slowPending()` (`src/core/scheduler/scheduler.ts:375`), so the unused stop (001-415) skips the daemon. When consumers leave, the drain (004-29, 001-219) keeps the daemon until the files run or until `idleExitMinutes`. No path found stops a daemon because it is waiting for a slot.

### 5. Original incident vs mechanism

The reported timeline fits heartbeat lapses, not a stop:

- The last heartbeat was at 19:25:41.
- Status later read "alive, heartbeat 19:26:06", a 25 s gap.
- Status then read "down since 19:26:16".
- The status after the gap still said "waiting for a slot" with 87 files pending.

A stopped daemon would leave a stop note, or 001-263's "died" text. A fresh daemon, if one had been spawned, would have had to win the singleton lock. The issue reports neither, but did not look for them. This is inference: the incident's pid, notes and stderr were not captured.

### 6. Who held the lock (inferred)

Candidates, none confirmed:

- Other daemons on cezarion's shared store. 001-415 found thirteen.
- Store pruning. 001-422's row measured prune at 4.5 to 5.3 s in 87 transactions at load 40 to 145.
- Bootstrap writes from the governed review worker's worktree starting.
- Cleanup when that worktree was removed.
- A daemon event loop blocked by its own chain of 5 s busy waits.

The issue names the review worker's create, collect and destroy cycle in the same interval. The probes did not exercise Cezar's park and resume or worker settling.

## Duplicates and new evidence

- **001-422** (review, `cand/0.1.201`): same root cause, "the heartbeat and consumer-expiry writes still block the daemon up to 5 s each on a busy store". Its acceptance criterion is "heartbeats keep their cadence beside a 12 s writer". With a 16 s or 20 s writer, 0.1.201 still reported no daemon for about 8 and 13 s. Review 001-432 may want to check that criterion against writers longer than the 10 s grace.
- **001-156** (done): the same symptom, flapping on a loaded host, but its fix covers only the start of a daemon (`startingSince`), not a running daemon.
- **001-263** (done): names a daemon that died. Not applicable, because the daemon was alive.
- **001-415, 004-29, 001-219** (done): not involved, read in source.
- **004-59** (done): load guard. Not involved; the probes turned the guard off.

**New evidence:**

1. The CLI waits (`status --wait <paths>`, `run --slow --wait`) end on the first stale heartbeat, unlike the Stop wait's 10 s down bound.
2. `run --slow --wait` exits 0 when it returns without a daemon.
3. The no-daemon text gives no reason and suggests `squeal start`, which reports the daemon alive.
4. The lapse remains on 0.1.201 for writers longer than the 10 s grace.

## Recommendation for Squeal

The reproduced mechanism is a heartbeat lapse with no lost request; whether it caused the original incident remains unconfirmed. Two decisions for the human:

- **(a) The root cause.** Fold it into 001-422 and its review. The store-busy episode it adds names the cause, but only after the episode ends.
- **(b) The wait behaviour.** Decide whether the waits tell a stale heartbeat from a stopped daemon: tolerance like the Stop wait's 10 s down bound, a socket or pid check, the reason in the text, and `run --slow --wait`'s exit code. This is new and covered by no row.

## Open questions

- What held cezarion's store write lock at 19:25 to 19:26? This needs the daemon's stderr, or a lock-holder record, at the next occurrence.
- Did Cezar's park and resume, or the worker settling, contribute? Not exercised, per the brief's limit on Cezar's suites.
- Should the no-daemon outcome stay at exit 0 for `run --slow --wait`, when the named wait exits 3?

## Sources

- https://github.com/hearsay-tools/squeal/issues/12
- `src/core/delivery/liveness.ts`, `src/core/status/snapshot.ts:42`, `src/core/daemon/lifecycle.ts`, `src/core/daemon/ensure.ts:192`, `src/core/daemon/open.ts:50`, `src/core/slow/slot.ts`, `src/core/scheduler/scheduler.ts:375`, `src/cli/status-wait.ts:304`, `src/cli/status-wait-lines.ts`, at `785c966d`
- `docs/specifications/004-slow-suites/spec.md` D2, D8, D9; `docs/board.md` rows 001-156, 001-219, 001-263, 001-415, 001-422, 004-29, 004-59
- Probes and outputs: `research/probes/issue-12/`. Bundles: 0.1.199 `~/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs` (sha256 6869478e…ae31f); 0.1.201 `git archive f9c29e11 plugins/claude-code` (sha256 35ef882d…454620a)

## Coordinator validation

Documentation-only integration, 2026-10-16. `npm ci`: 196 packages installed, 0 vulnerabilities. `npm run lint`, `npm run typecheck`, `npm run build`: exit 0; lint output `Checked 1351 files in 454ms. No fixes applied.` Build left committed plugin bundles unchanged. `git diff --check` and `bash -n` on both probe scripts: exit 0.

Full-suite command (installed Squeal, no independent Vitest run):

```sh
node --disable-warning=ExperimentalWarning "/home/agent/.codex/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs" run --all --wait
```

Output (exit 1):

```text
Checkpoint 567eff5f-b191-4efd-a7d1-ed6fc17f00ad completed at revision 4: 2 known failures: 2 tests; 667 test files, 665 already current, 2 run by the baseline checkpoint e86991c2-2a56-4406-88a2-61850a8352e9 it joined
Known failures: 2 (2 tests)
Affected checks: 6339 passed (5672 tests, 667 test files loaded), 0 running, 0 queued, 10 skipped (10 tests)
Full-suite checkpoint: completed at revision 4
```

Failures: `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, the same pair already recorded under 001-431 (fails under Squeal, passes under plain Vitest). No product fix attempted. First validation before dependency installation had no verdict (exit 3); the checkpoint above is the completed post-install result.
