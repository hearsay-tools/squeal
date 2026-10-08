# Which process is the harness, seen from a hook

Research task 001-121 for spec 001 (`lessons.md` defect 24), 2026-10-08. Linux: kernel 6.8, Node 24.21.0, `CLK_TCK` 100, `pid_max` 4194304. Claude Code 2.1.293 (the brief names 2.1.292; 2.1.293 is installed), Codex CLI 0.160.1, Cezarion 0.15.1-dev.1468. macOS from source and docs only. Probe: `probes/harness-process-liveness/` (throwaway).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which ancestor of a hook is the long-lived harness? | The hook's nearest ancestor that is not a shell. In every Claude Code mode (interactive, `-p`, stream-json as Cezar runs it, a subagent's hooks) that is the `claude` process, and Claude Code also hands it over as `CLAUDE_PID`. In every Codex mode (`exec`, TUI, `app-server`, a subagent's hooks) it is the native `codex` binary, the child of the npm `codex.js` wrapper. Squeal's `sh -c '...; exec "$@"'` fast path adds no process. A Claude Code shell-form hook adds one short-lived `sh`. | verified by experiment; read in official docs (`CLAUDE_PID`); read in source code (Codex spawn) |
| 2 | How can the daemon tell later that exactly that process is gone, safe against PID reuse? | Record `(pid, starttime)` with `starttime` = `/proc/<pid>/stat` field 22. Gone means the stat file is missing, its field 22 differs (the PID was reused), or its state (field 3) is `Z`. `kill(pid, 0)` alone is wrong twice: it reports a reused PID and a zombie as alive. Cost per check: 10 to 17 µs warm. macOS: `sysctl kern.proc.pid.<pid>` gives `p_starttime` in µs but Node cannot call it; `ps -o lstart=` has 1 s resolution and costs a process spawn. | verified by experiment (Linux); read in official docs and source code (macOS) |
| 3 | Does a hook ever run under a harness that is not its ancestor? What does Cezar look like? | Not in any case probed. Cezar spawns the harness directly (`cezarion serve` → `claude`, or → `node codex.js` → `codex app-server`); a hook sees the agent process, never Cezar. Launchers above the harness (`timeout`, the Codex npm wrapper) sit above it and are skipped by "nearest". A container: not tested; a PID number means nothing outside its PID namespace. | verified by experiment (Cezar, `timeout`, wrapper); read in source code (Cezarion); inferred (containers, `nohup`) |
| 4 | Recommendation | See below: `CLAUDE_PID` under Claude Code, else the nearest non-shell ancestor; record `(pid, starttime, pid namespace)`; about 0.1 ms per hook; no process named means the 12 h expiry applies. | inferred from 1 to 3 |

## Findings

### 1. The chain from a hook

Each run declared the probe hook on eight events in every form Squeal uses (`logs/*.chains.txt`). Chains read hook < parent < grandparent:

| Harness, mode | Exec form / `sh` fast path | Shell form |
|---|---|---|
| Claude Code `-p` | hook < `claude` < `timeout` < `bash` | hook < `sh` (dash) < `claude` |
| Claude Code interactive (tmux) | hook < `claude` < `bash` < tmux | hook < `sh` < `claude` |
| Claude Code stream-json (Cezar's argv) | hook < `claude` < `timeout` | hook < `sh` < `claude` |
| Claude Code subagent (`agent_id` set) | hook < the same `claude` | hook < `sh` < the same `claude` |
| Codex `exec` and TUI | | hook < native `codex` < `node codex.js` (both command forms) |
| Codex `app-server`, two threads | | hook < native `codex` < `node codex.js` < client |
| This Cezar worker's own Bash tool | | `bash` < `claude` < `cezarion serve` < `systemd --user` |

- **Exec form and the fast path.** Claude Code's docs: with `args`, "`command` is resolved as an executable and spawned directly with `args` as the argument vector, with no shell involved". The fast path's `exec "$@"` replaces `sh` with `node`, so both give ppid = `claude`. *Verified by experiment; read in official docs (hooks reference).*
- **Shell form.** "The `command` string is passed to a shell: `sh -c` on macOS and Linux". Dash did not exec the single command: a `sh` lives for the hook's duration between `node` and `claude`. Recording that `sh` would name a process that dies with the hook. *Verified by experiment.*
- **Codex.** `build_command` runs `$SHELL -lc <command>` in a new session (`codex-rs/hooks/src/engine/command_runner.rs`, tag `rust-v0.160.1`, `d27764b`). Bash execs a lone command, so no shell showed; a `$SHELL` that does not (fish, a compound command) would leave one. *Read in source code; verified with bash; inferred for other shells.*
- **`CLAUDE_PID`.** Docs: "Claude Code sets this to its own process ID in the subprocesses it spawns: Bash and PowerShell tool commands and hook commands ... Requires Claude Code v2.1.214 or later." The binary builds every child environment with `CLAUDE_PID:String(process.pid)`. In all 120 Claude Code hook records that logged it (every run after the first) it equalled the walk's answer, also in the nested runs where the outer worker's `CLAUDE_PID` was inherited: the inner `claude` overwrites it. Codex sets no such variable for hooks. *Verified by experiment; read in official docs; read in source code.*
- **One process, several sessions.** `/clear` ran SessionEnd for the old `session_id` and SessionStart for a new one 144 ms later, same `CLAUDE_PID`. One `codex app-server` hosted two threads (two `session_id`s) and ran SessionEnd for both when it exited. Subagents share the parent's process. So a process outliving a session proves nothing; a process gone proves every session it hosted is gone. *Verified by experiment.*
- **What a kill leaves.** SIGKILL of interactive `claude`, SIGTERM and SIGKILL of `claude -p`, SIGKILL of the native Codex TUI: no SessionEnd in any case (`logs/kills.txt`). Stdin EOF in stream-json mode, `codex exec` finishing and a killed Codex wrapper did run SessionEnd. Cezar ends a Claude run with stdin EOF, then SIGTERM, then SIGKILL (`claude-cli-runner.js:197-226`), so a Cezar cancel or a stuck worker can end with no SessionEnd. *Verified by experiment; read in source code.*
- **The Codex wrapper.** Native killed: the wrapper mirrors the exit (`codex.js:274-294`, verified). Wrapper killed: the native process was reparented to `systemd --user`, ran SessionEnd for both threads and exited within 3 s. Either way the native process is the one whose death ends the sessions. *Verified by experiment; mechanism not read.*

### 2. Telling later that exactly that process is gone

- **Identity.** proc_pid_stat(5): field 22 `starttime` is "the time the process started after system boot ... in clock ticks". A reused PID gets a new start time unless the 4,194,304-entry PID space wraps within one 10 ms tick. Comm (field 2) may hold spaces and `)`, so fields are counted after the last `)`. *Read in official docs; inferred for the wrap.*
- **Emulated reuse** (`bin/bench.mjs`; this host cannot create PID namespaces or cycle 4 M PIDs cheaply): a record whose PID is live but whose start time differs is "gone" by the identity check while `kill(pid, 0)` says alive. After SIGKILL both say gone. *Verified by experiment.*
- **Zombies.** An unreaped child passes `kill -0` and keeps its stat file with state `Z`. A harness whose parent has not reaped it yet is such a zombie. *Verified by experiment.*
- **Cost** (warm, 20,000 calls, load 3.4 on 24 cores, `logs/bench.txt`): `kill(pid, 0)` 1.2 µs live, 5.5 µs dead; stat read and parse 16.5 µs live, 9.7 µs dead; the hook rule with one shell hop 32 µs; `readlink /proc/self/ns/pid` 3.4 µs. In a cold hook process a hop cost 128 µs p50, 1.1 ms p95 across 222 records, with three reads per hop. `/proc` is mounted without `hidepid`, so a daemon can read another user's stat file too. *Verified by experiment.*
- **macOS, docs only.** xnu defines `PID_MAX 99999` (`bsd/sys/proc_internal.h`), so reuse comes 40 times sooner than here. `sysctl` `KERN_PROC_PID` returns `struct kinfo_proc` whose `kp_proc.p_starttime` is a `struct timeval` (`bsd/sys/sysctl.h`, `bsd/sys/proc.h`), not reachable from Node without a native addon. `ps -o lstart` prints "the exact time the command started, using the %c format" (`adv_cmds/ps/ps.1`): seconds only. Spawning `ps` cost 18 ms here on Linux procps. *Read in source code and official docs; cost measured on Linux only.*

### 3. Hooks whose harness is not their ancestor

- **Cezar.** Claude: `nodeSpawn` of `claude` from `cezarion serve` (this worker's chain above). Codex: `spawn(bin, ['app-server'])` with `bin` = `codex`, "One long-lived process per session" (`codex-app-server-runner.js`). From a hook Cezar is two levels above the harness and is never the answer. *Verified by experiment (Claude); read in source code (Codex).*
- **Launchers.** `timeout` stayed in the chain above `claude`; `nohup` execs its command and adds no process. Neither is reached by "nearest". *Verified by experiment (`timeout`); inferred (`nohup`).*
- **Orphaned hooks.** Hooks run in their own session (pgid = sid = hook pid, both harnesses). If the harness dies before the walk, ppid is a subreaper (`systemd --user` above) or pid 1. *Verified by experiment.*
- **Containers.** Not tested (no user namespaces here). A hook and the daemon it spawns share a PID namespace; a store shared with a process in another namespace (a devcontainer and the host on one `.git`) would hold PIDs that name nothing there. `readlink /proc/self/ns/pid` tells namespaces apart. *Inferred.*

## Recommendation for Squeal

**Rule.** In a hook: if `CLAUDE_PID` is set and the hook is Claude Code's, the harness is that PID. Otherwise walk from `process.ppid` past processes whose comm is a shell or launcher (`sh dash bash zsh ksh mksh fish env nohup timeout`), at most 4 hops; the first other process is the harness. Record `{pid, starttime: stat field 22, pidns: readlink /proc/self/ns/pid}` with each registration, and overwrite it on every hook, since `claude --resume` or a Codex `thread/resume` moves a session to a new process.

**No process named.** Record none, and the consumer keeps today's 12 h expiry, when: not Linux (no `/proc`), the stat read fails, the walk reaches pid 1 or exhausts its 4 hops, or it reaches a process whose comm is `systemd` (the harness died first). On macOS a `ps -o lstart=` probe once per new PID in the daemon is possible but buys only second resolution against a 99,999 PID space.

**Daemon check.** On each heartbeat, per consumer with a record: same PID namespace as the daemon, else skip; stat file present, field 22 equal, field 3 not `Z`, else the consumer is gone. About 17 µs per consumer.

**Cost per hook.** Claude Code: one stat read and one readlink, 30 µs warm, about 0.1 ms cold; no extra hop in the shell form because `CLAUDE_PID` skips the `sh`. Codex: the same, plus one hop only under a `$SHELL` that does not exec. On SessionStart, UserPromptSubmit, PostToolBatch and Stop this is under 0.3% of the 50 ms p95 a bundled hook already takes (001-93).

**Tradeoff.** Process death ends every session the process hosted, which is right for Claude Code and per-run Cezar app-servers, but an app-server shared by many threads stays alive after a thread ends; SessionEnd remains the only per-session signal there.

## Open questions

- Linux PID-namespace and container behaviour was not run. Decides: a probe on a host that allows user namespaces.
- macOS was not run. Decides: a probe on macOS for `ps` cost and whether `CLAUDE_PID` is set there (docs say yes).
- Claude Code background or teammate sessions, and Windows, were not examined.
- Why the native Codex exits when its wrapper dies (parent-death signal or stdin) was not read.

## Sources

- Claude Code hooks reference: https://code.claude.com/docs/en/hooks (exec form, shell form, own session), fetched 2026-10-08.
- Claude Code environment variables: https://code.claude.com/docs/en/env-vars (`CLAUDE_PID`, `CLAUDE_CODE_SESSION_ID`), fetched 2026-10-08.
- Claude Code 2.1.293 binary, `@anthropic-ai/claude-code/bin/claude.exe`: child environment with `CLAUDE_PID:String(process.pid)`.
- Codex `rust-v0.160.1` (`d27764b82f71`), `codex-rs/hooks/src/engine/command_runner.rs` `build_command`, `default_shell_program`: https://github.com/openai/codex/tree/rust-v0.160.1/codex-rs/hooks
- Codex npm wrapper 0.160.1: `@openai/codex/bin/codex.js` lines 241 to 294.
- Cezarion 0.15.1-dev.1468: `dist/core/claude-cli-runner.js` (stop escalation), `dist/core/codex-app-server-transport.js`, `codex-app-server-runner.js`.
- proc_pid_stat(5): https://man7.org/linux/man-pages/man5/proc_pid_stat.5.html (fields 3 and 22).
- xnu `f6217f891ac0`: `bsd/sys/proc_internal.h` (`PID_MAX`), `bsd/sys/proc.h` (`p_starttime`), `bsd/sys/sysctl.h` (`KERN_PROC_PID`, `kinfo_proc`): https://github.com/apple-oss-distributions/xnu
- adv_cmds `6bed8737a34d`, `ps/ps.1` (`lstart`): https://github.com/apple-oss-distributions/adv_cmds
- Probe evidence: `probes/harness-process-liveness/logs/`.
