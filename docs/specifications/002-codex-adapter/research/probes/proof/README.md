# Probes: 002-16 proof in a scratch Codex home (throwaway)

Throwaway probes for `../../../lessons.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-07 against Codex CLI 0.160.1, model `gpt-6.1-sol` through the host's provider, Squeal plugin 0.1.21 installed from this checkout at `faa202d`, Node 24.21.0, Linux 6.8.

## Rules followed

- Everything ran with `CODEX_HOME=/tmp/p16/codex` and `HOME=/tmp/p16/home` (`bin/env.sh`). The scratch `config.toml` holds the host's provider block and nothing else (`bin/codex-home.sh`); the provider reads its key from an environment variable, so no credential was copied. `~/.codex/auth.json` was never read, copied or listed. Nothing under `~/.codex` was written: its `config.toml` kept its 18:48 mtime, and every Codex process these probes started had `CODEX_HOME=/tmp/p16/codex`.
- The plugin was installed with `codex plugin marketplace add <this checkout>` and `codex plugin add squeal@squeal`. Its nine hooks were trusted in the TUI's `/hooks` (key `t`, trust all), which wrote `hooks.state` into the scratch `config.toml` (`logs/trust-tui-hooks-state.diff`). `--dangerously-bypass-hook-trust` was never passed.
- For the N4 probe only, a silent logging hook (`bin/loghook.sh`) was declared in the scratch user layer `/tmp/p16/codex/hooks.json` and trusted by writing the `currentHash` that `hooks/list` reported into the scratch `config.toml`. It logs each hook's stdin; it runs beside Squeal's hooks and outputs nothing.
- Scratch repositories: `/tmp/p16/r<N>`, made by `bin/mkrepo.sh` (Vitest 5.0.3, two source files, three tests, `squeal init --harness codex`).
- Daemons: every scratch daemon was stopped with `squeal stop` at the end. The TUI started Codex's managed app-server daemon in the scratch home (a 0.161.0 release it downloaded there); it was killed after the trust step. No `tmux` session is left.

## Files

- `bin/env.sh`, `bin/codex-home.sh`, `bin/mkrepo.sh`: the scratch environment.
- `bin/run-exec.sh <repo> <prompt> <label>`: one `codex exec --json` run with `bin/watch.mjs` polling the store.
- `bin/run-as.sh <repo> <label> <steps>`: one app-server thread through `bin/cz.mjs`, which drives `codex app-server` as Cezar's `codex-app-server-runner` does: `initialize`, `configRequirements/read`, `thread/start` with `cwd`, `sandbox: danger-full-access` and `approvalPolicy: never`, `turn/start` per prompt, then stdin EOF with a SIGTERM only after a 10 s grace. Steps may also be `sh:<cmd>` and `review:inline`.
- `bin/watch.mjs`: polls `<repo>/.git/squeal/store.sqlite` every 100 ms and prints consumers, views, transitions and the revision on change.
- `bin/timeline.mjs`: a readable timeline of one Codex rollout. `bin/hook-stats.mjs`: hook durations from `hook/completed`. `bin/collect.sh`: copies trimmed evidence into `logs/`.
- `prompts/`: the prompts, verbatim.
- `logs/`: evidence, named by run (`exec1`, `as1`, `as2`, `n4inline`, `n4detached`, `nd-r9`, `nd-r5`, `nd-r6`). `*.store.jsonl` times are ms after the run started; `*.hooks.jsonl` are Codex's `hook/completed` notifications; `*.timeline.txt` are rollouts with the system preamble cut and the encrypted `spawn_agent` message replaced.
