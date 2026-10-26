# Research 011-249: a daemon stops on a signal and stays stopped (gh-1)

Researcher, 2026-10-26. Brief: `issue-1-brief.md`. Probes: `probes/issue-1/` (README says how to re-run each). Host: Linux 6.8, Node v24.21.0, Claude Code 2.1.310, cezarion 0.16.0-dev.2824. One-minute load during the work: 28 to 40 on 24 CPUs. No timing below depends on it.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | How often | 19 of 579 stored daemon exits (3.3%) are `daemon stopped: signal`, on 12 days of 26. The stores keep few: a removed worktree's notes go, and cezarion's store keeps 0 signal notes. The cockpit service stopped 52 times in 26 days (about 2 a day), and each stop signals every daemon on the host (13 live at 13:40Z today). | read from store; read from journal |
| 2 | Releases | No signal stop follows a release. 17 of 19 notes fall within 0.12 s of a `cezar.service` stop; 14 of those 17 come 0.14 to 0.37 s after an Ansible `state=restarted` of that service. On 2026-10-25, with about 20 releases, the service stopped once. The reported stop (09:43:52.710Z, 0.1.308) came 22 min after the 0.1.308 tag and 6 min before the 0.1.309 tag. | read from store; read from journal |
| 3 | Senders | The cockpit's systemd unit, `KillMode=control-group`, `KillSignal=SIGTERM`, a 90 s stop timeout, then SIGKILL. Every daemon a hook spawns is in that control group, and `setsid` does not leave it. Squeal sends no stop signal to a daemon. Cezar's worker stop signals a session's process group only, which a detached daemon is not in. 2 of 19 notes have no cockpit stop beside them. Both are daemons signalled during their own start, 0.62 s old in one case; the sender is not determined. | read in source code; read from journal; inferred |
| 4 | Why it stays stopped | A signal stop leaves no stop mark, so the next hook restarts the daemon: SessionStart and the tool-boundary hook (Claude Code PostToolBatch, Codex PostToolUse) when the heartbeat is stale. After a cockpit restart the sessions die too. The gap lasts until the cockpit is back (91 s when the stop times out) and the session resumes. In the report, the resumed SessionStart (09:46:39) said "a daemon is starting". At about 09:47:28 a wait said the daemon stopped and named `squeal start`, and the agent ran it (09:47:36). Whether that SessionStart daemon ever came up is not determined: the worktree's notes are gone. | read in source code; read from transcript; not determined |
| 5 | Naming the sender | Node's listener gets only the signal name and number: no sender pid. Things the daemon can read when the signal arrives: its parent pid, its control group, and whether that unit is stopping. Squeal's own senders need no mark, because they send no signal. | verified by experiment; read in official docs; inferred |

## 1. How often

Stores copied 2026-10-26 13:41Z with `-wal` and `-shm` (`probes/issue-1/notes.mjs`), read from store:

| Store | Notes kept from | Exit notes | Signal |
|---|---|---|---|
| squeal | 2026-10-04 | 467 | 15 |
| cezar | 2026-10-14 | 55 | 0 |
| toolkit-dev | 2026-10-22 | 29 | 1 |
| mvp-unveiled-july26 | 2026-10-12 | 28 | 3 |

By day (`exits-by-day.txt`): the squeal store has 4 on 10-06, 4 on 10-07, 2 on 10-08, 3 on 10-09 and 2 on 10-26. mvp has 1 on 10-13 and 2 on 10-16. toolkit has 1 on 10-22. The cezar store keeps 27 note lists for 26 current worktrees, so a removed worktree takes its notes with it. The reporter's worktree (`f4a3c123`) and both cezarion reports (2026-10-23 17:20:01Z, 2026-10-25 09:43:52Z) are not in it. The store count is a floor, and a weak one. At the 2026-10-24 08:40 and 2026-10-25 09:43 cockpit stops, no store keeps any note.

Time to the next daemon in the same worktree, where a later note records its incarnation (read from store): 4.9 s (squeal main, 10-26 13:31), 24 s (2 mvp worktrees, 10-16; the cockpit was back in 1.8 s), 1.7 min (toolkit, 10-22; the cockpit was back in 91 s), 42.9 min (squeal worker `52e58f23`, 10-26 07:59). The other 14 have no later incarnation stored. Their next daemon is not determined.

## 2. Releases

`match-output.txt` sets each note beside the nearest cockpit stop, Ansible restart and tag:

- 14 notes: an Ansible restart, then the service stop 0.14 to 0.37 s later, then the note 0 to 0.12 s after that. These are 10-06 (×4), 10-07 (×4), 10-08 14:20, 10-13 20:22, 10-16 (×2), 10-22 10:19 and 10-26 07:59.
- 3 notes, 10-09 22:43:07Z: the cockpit's main process crashed (`code=dumped, status=6/ABRT`) 0.00 to 0.02 s before them, and systemd then stopped the rest of the unit.
- The reported 2026-10-23 17:20:01.163Z note: the OOM killer hit the unit at 17:19:58.08Z, 3.1 s before. SIGKILL followed at 17:21:28 (inferred; the note is quoted in the issue, not stored).
- The reported 2026-10-25 09:43:52.710Z note: Ansible restarted the service at 09:43:52.474Z, and systemd began the stop at 09:43:52.711Z (read from journal).

Versions: the exited daemons were 0.1.131, 0.1.199, 0.1.256, 0.1.308 and 0.1.333, and each next daemon was the same version or newer. One stop (toolkit, 0.1.256 exiting while 0.1.261 was released) shows an older daemon ended by the restart and its successor at the hook's version. None of the 19 notes is a step-down. A step-down writes `hooks at Squeal X are newer than this daemon` (13 such notes in the squeal store, 5 in cezar) and goes over the socket.

Ansible ran `systemd_service name=cezar.service state=restarted` 34 times from 10-01 to 10-26, 1 to 3 a day (6 on 10-06). The 52 service stops are 45 requested (34 of them by Ansible) and 7 failures (3 OOM, 4 crashes). Ansible's run before the restart clones or checks the host's project repositories (`ansible.builtin.git`, `npm root -g`). It is a host-provisioning run, not a Squeal release step (read from journal). Plugin copies are not the trigger either: the Claude Code cache got 0.1.308 at 10:01:10Z and 0.1.309 at 14:00:16Z on 10-25, both after the stop.

## 3. Senders

Inside Squeal (read in source code, this worktree at `cf678b7c2`):

- `src/cli/daemon.ts` routes SIGINT, SIGTERM and SIGHUP through `ownSignals` (`src/core/daemon/signals.ts`) to `daemon.stop("signal")`. That writes `daemon stopped: signal` with `exitOf`, the only source of this note. A signal during start stops the daemon once `startDaemon` returns, so its revision is null.
- `terminate` (`src/core/daemon/terminate.ts`) is called only by `EscapedChildren` (`escaped.ts:253`). It reaches processes that carry the daemon's `SQUEAL_DAEMON_CHILD` mark, or that are in the daemon's own group and no longer descend from it. A hook-spawned daemon has neither.
- `squeal stop`, a step-down, the handoff and `squeal remove` ask over the socket. Their notes are `squeal stop` or `hooks at ... are newer`. `stop.ts:235` and `slot-holders.ts:28` call `kill(pid, 0)`, a probe only. `squeal hold` (`hold.ts:46`) forwards SIGINT, SIGTERM and SIGHUP to its own child command only. An older daemon's exit signals nothing.

Outside Squeal:

| Sender | Signal, when | Reaches a daemon? | Fits a report? |
|---|---|---|---|
| `cezar.service` stop or restart (Ansible, a manual `systemctl`, OOM, crash) | SIGTERM to every process in the control group, then SIGKILL after 90 s | Yes: 13 of 13 live daemons with a readable cgroup are in `app.slice/cezar.service` (read from `/proc`) | Yes: 17 of 19 stored, both cezarion reports |
| Cezar worker stop and destroy (`session-process.js`) | `kill(-pgid, SIGTERM)`, then SIGKILL, to the session's own group | No: `ensureDaemonProcess` spawns `detached: true`, so the daemon leads its own group (read in source code) | No |
| The harness ending a hook's group (Codex, Claude Code) | Group or tree kill at timeout or session end | Not by group. By process tree only while the daemon is still the hook's child: SessionStart waits up to 750 ms (`SPAWN_SETTLE_MS`), and `squeal start` waits up to 30 s | Maybe the 2 unexplained notes (10-08 21:52:37Z, rev null; 10-26 13:31:18Z, daemon 0.62 s old, started for Cezar's task-naming session in the main checkout). Not determined: both harnesses are closed binaries here |
| Leftover sweeps (agents, by hand) | SIGTERM by pid | Possible, but the sweep runbook excludes daemons (`squeal stop` for them) | No match found |
| Closed terminal (SIGHUP) | Terminal's session | No: a detached daemon has its own session and no controlling terminal | No |

## 4. Why it stays stopped

Read in source code: a signal stop clears the daemon record and writes no `daemon-stopped:` mark (only `squeal stop` writes one, `stopped-mark.ts`). Nothing stops the next spawn, then:

- Claude Code: SessionStart and SubagentStart (`ensureToRegister`), PostToolBatch and Stop (`ensureIfStale`, which spawns when the heartbeat is older than two intervals). UserPromptSubmit spawns only for a consumer that is not registered (`prompt.ts:40`).
- Codex: SessionStart, PostToolUse (`deliver` → `ensureIfStale`) and Stop, by the same shared code.

The report, read from the Codex transcript `~/.codex/sessions/2026/10/25/rollout-2026-10-25T08-23-11-01a171f1-*.jsonl`:

| UTC | Event |
|---|---|
| 09:42:59 | The turn ends; the agent waits on a 3-minute timer |
| 09:43:52.71 | Ansible restarts the cockpit; daemon 0.1.308 stops on the signal |
| 09:45:23.6 | The stop times out at 90 s; SIGKILL; the cockpit starts |
| 09:46:36 | Cezar resumes the session |
| 09:46:39 | SessionStart: `registered at revision 6 ... A daemon is starting` |
| ~09:47:28 | A named wait: `no daemon has validated since 09:43:47.782Z: the daemon stopped ... squeal start starts one` |
| 09:47:36 | The agent runs `squeal start` |
| 09:48:04 | `Squeal daemon alive`, 4 files running |

Of the "about three minutes", 2 min 44 s (09:43:52 to 09:46:36) is the cockpit down and the session not yet back. No hook could run then. The agent needed `squeal start` because the wait 49 s after SessionStart said so. Whether the daemon that SessionStart spawned was alive, still starting, or had exited is not determined. Its notes went with the worktree. `squeal start` prints the same line for a daemon it found and one it spawned (a gap the 2026-10-23 comment names).

## 5. Naming the sender

- Verified by experiment (`listener.mjs`, Node v24.21.0): a `process.on("SIGTERM")` listener receives `["SIGTERM", 15]` and nothing else.
- Read in official docs (Node v24 `process`, "Signal events", https://nodejs.org/docs/latest-v24.x/api/process.html#signal-events, fetched 2026-10-26): "The signal handler will receive the signal's name ('SIGINT', 'SIGTERM', etc.) as the first argument." The page names no sender field. The sender's pid (`si_pid`) needs `sigaction` with `SA_SIGINFO` or a `signalfd`. Node exposes neither, so a native addon would be needed (inferred).
- What a daemon can record at the signal without native code (inferred, not built): its `process.ppid` (1 or the user manager after reparenting, or the hook still alive); `/proc/self/cgroup`, which names the unit; and that unit's state (`systemctl --user show -p ActiveState <unit>` reads `deactivating` during a stop). Here the unit and its state would have named the cockpit restart in 17 of 19 cases. From outside, the user journal names the restart and its caller (Ansible). Squeal's own senders write no mark today, and need none: none of them sends a stop signal.

## Recommendation for Squeal

The fix row should treat this as the host's service manager ending the daemon with the cockpit, not as a Squeal release or a Squeal sender. Two facts decide it. Every hook-spawned daemon lives in the cockpit's control group. That group is SIGTERMed about twice a day, by Ansible or by an OOM or crash, and 1 time on 2026-10-25 against about 20 releases. Two directions follow, both outside this brief's design scope:

- Make the stop note say which unit stopped and that the next hook restarts the daemon. Today the note says only "signal".
- Find out why the resumed session's daemon did not serve its first wait.

Whether daemons should leave the cockpit's control group is a host and Cezar question for the human, not a Squeal one.

## Open questions

1. Did the daemon spawned by the resumed SessionStart (09:46:39Z) start, and why did a wait 49 s later report none? Answering needs a reproduction in a clone: a cockpit-style control group stopped under a session, then resumed. That is more than this budget.
2. Who sends the two signals during a daemon's start (10-08 21:52:37Z; 10-26 13:31:18Z, Cezar's task-naming session)? Does Claude Code or Codex kill a hook's process tree, not only its group, when a short session ends? Answering needs a hook in an isolated `HOME` that spawns a detached child under each harness.
3. Do Codex PostToolUse hooks fire for its `exec` code-mode tool calls, which the reporter's session used? If not, Codex restarts a stopped daemon only at SessionStart and Stop. Not determined: no Codex source or doc was read.
4. Should removed worktrees keep their exit notes? Their loss hides most cezarion evidence for gh-1.

## Sources

- Issue https://github.com/hearsay-tools/squeal/issues/1 and its comments, read 2026-10-26.
- Source in this worktree at `cf678b7c2`: `src/cli/daemon.ts`, `src/core/daemon/{signals,terminate,escaped,ensure,daemon,lifecycle}.ts`, `src/cli/{stop,stopped-mark,hold,start}.ts`, `src/harness/shared/{ensure,deliver,prompt,session,stop}.ts`, `plugins/{claude-code,codex}/hooks/hooks.json`; spec 011 C9.
- Cezar bundle `~/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/core/session-process.js` (0.16.0-dev.2824).
- `~/.config/systemd/user/cezar.service`; `systemctl --user show cezar.service`; `journalctl --user` from 2026-10-01 (extracts in `probes/issue-1/`).
- Store copies of `/home/agent/projects/{squeal,cezar,toolkit-dev,mvp-unveiled-july26}/.git/squeal/store.sqlite`, taken 2026-10-26 13:41Z and deleted after reading.
- Codex transcript named in section 4; Claude Code transcript `~/.claude/projects/-home-agent-projects-squeal/8d3d53c3-*.jsonl` (the task-naming session at 13:31:18Z).
- Node v24 `process` docs, signal events (URL above).
