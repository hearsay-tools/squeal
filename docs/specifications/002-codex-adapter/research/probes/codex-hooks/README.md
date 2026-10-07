# Probes: codex-hooks (throwaway)

Throwaway probes for `../../codex-hooks.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-07 against Codex CLI 0.160.1 (`codex-cli 0.160.1`), model `gpt-6.1-sol` through the host's configured provider, Ubuntu 24.04, kernel 6.8.

## Rules followed

- Every probe ran in a scratch git repository under `/tmp/cxh/<name>` made by `bin/mkrepo.sh`. None touched this repository's Squeal store.
- Hooks were declared with `-c hooks.<Event>=[...]` on the command line, in `thread/start` `config` for app-server, or in the scratch repository's `.codex/hooks.json`. `--dangerously-bypass-hook-trust` (or `bypass_hook_trust: true` in `thread/start` `config`) ran them, except in the Q1 trust probes.
- The user's three plugins were disabled per run with `-c plugins."<id>".enabled=false` (`bin/common.sh`), so the bypass flag never ran a hook the probe did not declare.
- `~/.codex/config.toml` was never edited. Where a probe needed a trusted project (repo-level hooks, the interactive TUI), it ran with `CODEX_HOME=/tmp/cxh/home`, holding a filtered copy of `config.toml` (provider, model, no plugins, no projects) plus `[projects."/tmp/cxh/..."] trust_level = "trusted"`. That copy holds no credential: the provider reads its key from an environment variable. `~/.codex/auth.json` was never read, copied or listed.
- Runs without the scratch `CODEX_HOME` wrote their session rollouts under `~/.codex/sessions/2026/10/07/` and Codex's own state databases, as any Codex run does; they were left in place. No `~/.codex` config file was edited, so nothing needed a backup.
- Background processes the probes spawned (`sleep 311` to `314`, `sockserver.mjs`) were killed at the end. The TUI ran in tmux session `cxh` and exited by `/exit`. No daemon was left running.

## Files

- `bin/hook.sh <label> <mode>`: logs `{t_ns, label, stdin}` to `$PROBE_LOG` and emits output by mode: `silent`, `ctx` (`additionalContext` with a nonce), `plain` (plain stdout), `deny` (PreToolUse `permissionDecision: deny`), `block` and `blockonce` (legacy `decision: block`, once per log), `exit2`, `exit1`, `badjson`, `hang` (`sleep $PROBE_HANG`), `big` (`$PROBE_BIG` characters with HEAD, MID and TAIL nonces).
- `bin/common.sh`: `NOPLUG` plugin-disable flags and `h EVENT MODE [MATCHER] [EXTRA]`, which prints one `-c hooks.EVENT=[...]` override.
- `bin/as.mjs`: minimal `codex app-server` JSON-RPC client. `hooks-list <cwd>` prints `hooks/list`; `turn <cwd> <prompt> [threadStartJSON] [interruptMs]` runs one turn and logs every message to `$AS_LOG`.
- `bin/gap.py`: from `RUST_LOG=debug` stderr and `--json` stdout, milliseconds from each `date +%s%N` tool output to the next `codex.websocket_request`.
- `bin/reach.mjs`, `bin/sockserver.mjs`: Q7. Read a SQLite file under `<repo>/.git/squeal/`, ping unix sockets under `$XDG_RUNTIME_DIR/cxh-probe/` and `/tmp/cxh/squeal-1001-probe/` (stand-ins for Squeal's socket directories, so a real `/tmp/squeal-1001` was never touched), and spawn a detached and a same-group child.
- `logs/`: trimmed evidence, named by question. Tool responses, prompts and the encrypted `spawn_agent` message are cut or redacted.

## Reproduce one

```sh
source bin/common.sh; R=$(bash bin/mkrepo.sh demo); cd "$R"
PROBE_LOG=/tmp/cxh/demo.log codex exec "${NOPLUG[@]}" -c "$(h PostToolUse ctx Bash timeout=5)" \
  --dangerously-bypass-hook-trust --json -s danger-full-access \
  'Run `date +%s%N` twice, one call at a time, and quote any Squeal nonce you received.'
```

`-s workspace-write` and `-s read-only` cannot run any command on this host: bubblewrap fails with `loopback: Failed RTM_NEWADDR: Operation not permitted` / `setting up uid map: Permission denied` (AppArmor restricts unprivileged user namespaces), and `--enable use_legacy_landlock` panics with "filesystem-restricted execution requires bubblewrap". Every model run here therefore used `danger-full-access`, the mode Cezar selects on unmanaged installs.
