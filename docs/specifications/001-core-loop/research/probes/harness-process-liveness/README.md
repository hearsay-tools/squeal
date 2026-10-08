# Probes: harness-process-liveness (throwaway)

Throwaway probes for `../../harness-process-liveness.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-08: Claude Code 2.1.293 (`claude.exe`, native), Codex CLI 0.160.1 (npm `codex.js` wrapper over the native musl binary), Node 24.21.0, Ubuntu 24.04, kernel 6.8, `CLK_TCK` 100, `pid_max` 4194304. The host runs inside a Cezar worker, so every chain continues above the probe's harness into this worker's `claude` and `cezarion serve`.

## Rules followed

- Every probe ran in a scratch git repository under `/tmp/hpl/<name>` (`bin/mkrepo.sh`) with no `squeal.config.json` and no Squeal store. This repository's store and daemons were not touched.
- Claude Code: hooks from the scratch repository's `.claude/settings.json` (`bin/cc-settings.sh`), `--setting-sources project,local` so the user's plugins (Squeal included) did not load.
- Codex: hooks with `-c hooks.<Event>=[...]` and `--dangerously-bypass-hook-trust` (app-server: `bypass_hook_trust` in `thread/start` config), all four user plugins disabled (`bin/codex-common.sh`). The TUI ran with `CODEX_HOME=/tmp/hpl/cxhome`, a copy of `config.toml` lines 1 to 16 (provider and model; the key comes from an environment variable) plus one trusted project. `~/.codex` was not edited; `auth.json` was not read.
- `bin/clean.sh` unsets the outer session's `CLAUDE*`, `CEZ_*` variables so the harness starts as from a plain terminal.
- Everything the probes started was stopped; `tmux -L hpl` sessions were killed.

## Files

- `bin/walk.mjs <label>`: the probe hook. Appends `{event, session, agent_id, pid, ppid, walkUs, envVals, chain}` to `$PROBE_LOG`; `chain` is the `ppid` walk with `/proc/<pid>/stat` comm, pgid, sid, field 22 and the exe.
- `bin/cc-settings.sh <dir>`: Claude Code settings declaring `walk.mjs` on eight events in three forms: exec form (`command` + `args`), Squeal's `sh -c '...; exec "$@"'` fast path (001-93), and shell form (a command string).
- `bin/codex-common.sh`: the same for Codex in two forms: a plain command string, and `true || exit 0; exec node ...` (the plugin's fast-path shape).
- `bin/as2.mjs`: `codex app-server` client: two threads, one turn each, then SIGKILL of the npm wrapper only.
- `bin/bench.mjs`: cost of `kill(pid, 0)`, of a `/proc/<pid>/stat` read, of the hook-side rule, and of spawning `ps -o lstart=`; emulated PID reuse.
- `bin/sum.mjs <log>`: one line per hook record.
- `logs/*.chains.txt`, `logs/*.jsonl`: trimmed evidence per run (`cc-p`, `cc-p2` `-p`; `cc-i` interactive with a subagent and `/clear`; `cc-s` stream-json, Cezar's shape; `cc-kTERM`, `cc-kKILL` signals in `-p`; `cx-e` `codex exec` with a subagent; `cx-i` TUI; `cx-as` app-server). `logs/kills.txt`, `logs/bench.txt`: console output.

## Reproduce one

```sh
P=$PWD; R=$(bash bin/mkrepo.sh demo); bash bin/cc-settings.sh "$R"; cd "$R"
PROBE_LOG=/tmp/hpl/demo.jsonl "$P/bin/clean.sh" claude -p --model sonnet --setting-sources project,local \
  --dangerously-skip-permissions 'Run `echo hi` with the Bash tool, then reply done.'
node "$P/bin/sum.mjs" /tmp/hpl/demo.jsonl
```
