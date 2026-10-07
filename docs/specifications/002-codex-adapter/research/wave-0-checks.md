# Research: wave-0 checks (spec 002 open questions 1 to 3)

Board row 002-11. Codex CLI 0.160.1 (source tag `rust-v0.160.1`, `d27764b`), Claude Code 2.1.293 for one read-only validation, run 2026-10-07 on this host (Linux). Every run used a scratch `CODEX_HOME` and scratch repositories under `/tmp/w0c`. Probes and trimmed logs: `probes/wave-0-checks/`.

## Questions answered

| # | Question | Short answer | Tag |
|---|---|---|---|
| 1 | Does Codex take this repository's `.claude-plugin/marketplace.json` with a second entry at `./plugins/codex`? What does `codex plugin add` do with two entries? | It accepts the file and lists and installs both entries. `squeal@squeal` then installs the **Claude Code** plugin into Codex, which runs its hooks with `args` dropped. The two entries need distinct names, and Claude Code lists the Codex entry too. With `.agents/plugins/marketplace.json` present, Codex reads only that file. Each harness then sees only its own plugin, and `codex plugin add squeal@squeal` installs the Codex plugin. | verified by experiment; read in source code |
| 2 | Is a hook's working directory the thread's `cwd`? Does `CLAUDE_PROJECT_DIR` or a `cwd` variable reach the hook? | Yes, in all three modes: under `exec -C`, under app-server `thread/start` `cwd` (with process cwd `/tmp`), and in the TUI. A `turn/start` `cwd` override moves later hooks to the new directory. A subdirectory stays a subdirectory; Codex does not lift it to the git root. `$PWD` equals it, and stdin `cwd` equals it. `CLAUDE_PROJECT_DIR` is never set. Hooks run as `/bin/bash -c '<command>'`, non-login, and inherit Codex's whole environment. | verified by experiment; read in source code |
| 3 | How is `trusted_hash` computed? Does an outside value match `currentHash`? Does plugin trust survive a version change? | SHA-256 of canonical JSON `{event_name, matcher?, hooks:[normalized handler]}`, with the command text **before** `${PLUGIN_ROOT}` expansion. A Node port matched `hooks/list` on 17 of 17 handlers. Trust written from it worked from the user config, `-c` and `thread/start` `config`, with no bypass flag. Plugin trust **survives** a version bump while `hooks.json` is unchanged; a changed command marks only that hook `modified`. Codex's own `config/batchWrite` can write the trust. | read in source code; verified by experiment |

## Findings

### 1. Marketplace file

- Codex looks for a marketplace file at a root in a fixed order and takes the first that exists: `.agents/plugins/marketplace.json`, `.agents/plugins/api_marketplace.json`, `.claude-plugin/marketplace.json`, `.cursor-plugin/marketplace.json` (`core-plugins/src/marketplace.rs:20`, `find_marketplace_manifest_path`). `codex plugin marketplace add` uses the same lookup for local and git sources (`marketplace_add/source.rs:93`). Plugin manifests are found at `.codex-plugin/plugin.json`, then `.claude-plugin/plugin.json`, then `.cursor-plugin/plugin.json` (`exec-server-protocol/src/protocol.rs:49`). *read in source code*
- Layout `one` (this repository's file plus a second entry `squeal-codex` at `./plugins/codex`): `marketplace add` succeeded. `plugin list` showed `squeal@squeal` (source `plugins/claude-code`) and `squeal-codex@squeal`, and both installed into the cache and were enabled. *verified by experiment (`logs/q1-marketplace.txt`)*
- The Claude Code plugin installed into Codex had its `hooks.json` loaded. `hooks/list` showed the handler `"command": "sh"` with its `args` gone and no warning (`logs/q1-one-hooks-list.jsonl`). Squeal's real hooks use `command: "node"` plus `args`. If a user trusted them, Codex would run a bare `node` on the hook's stdin, which fails with `SyntaxError` and exit 1 after a Node start. *verified by experiment (listing; bare `node` on hook JSON); the per-call cost is inferred*
- Layout `dup` (both entries named `squeal`): Codex listed only the first entry, and the Codex plugin could not be installed (`plugin squeal-codex was not found`). The install also checks `plugin.json` `name` against the entry name (`store.rs:322`), so each name must match its own manifest. *verified by experiment; read in source code*
- Layout `split` (`.claude-plugin/marketplace.json` with the Claude entry only, `.agents/plugins/marketplace.json` named `squeal` with one entry `squeal` at `./plugins/codex`): Codex reported the `.agents` file as the marketplace, listed one plugin, and `codex plugin add squeal@squeal` installed the Codex plugin. *verified by experiment*
- Claude Code: `claude plugin validate` passed layout `one` and layout `split`, with only metadata warnings. In layout `one` Claude Code therefore also offers `squeal-codex` as a plugin. *verified by experiment (validation only; no install into Claude Code)*

### 2. Hook working directory and environment

- Source: every event runs its command with `current_dir(cwd)` (`hooks/src/engine/command_runner.rs:226`). That `cwd` is the turn context's `cwd`, the same value written to stdin (`core/src/hook_runtime.rs:155`). `turn/start` takes `cwd`, documented as "Override the working directory for this turn and subsequent turns" (`app-server-protocol/src/protocol/v2/turn.rs:204`). *read in source code*
- `codex exec -C /tmp/w0c/r-q2/pkg/sub`, started from `/tmp`, ran 13 hooks: SessionStart, UserPromptSubmit, Pre/PostToolUse, SubagentStart, the subagent's own Pre/PostToolUse, Stop and SessionEnd. Every one had `pwd -P`, `$PWD` and stdin `cwd` equal to `/tmp/w0c/r-q2/pkg/sub`; the git root was `/tmp/w0c/r-q2`. Both shells printed the same `pwd`. *verified by experiment (`logs/q2-exec-hooks.jsonl`, `q2-exec-transcript.txt`)*
- App-server spawned in `/tmp` with `thread/start` `cwd` `/tmp/w0c/r-q2/pkg/sub`: hooks of turn 1 ran in the subdirectory. Turn 2 passed `turn/start` `cwd: /tmp/w0c/r-q2-other`, and its hooks and the later SessionEnd ran there. Cezar spawns app-server in the same directory it passes as the thread `cwd` (cezarion `codex-app-server-runner.js:52`). *verified by experiment (`logs/q2-as-hooks.jsonl`); read in cezarion dist*
- TUI in tmux, started in `/tmp` with `-C /tmp/w0c/r-q2/pkg/sub`: all hooks ran in the subdirectory. The TUI ran its thread in a managed app-server daemon it started under `$CODEX_HOME`. *verified by experiment (`logs/q2-tui-hooks.jsonl`)*
- Environment: `CLAUDE_PROJECT_DIR` was absent in every run, and the string does not occur in `codex-rs`. No `CODEX_SESSION_ID` or `CODEX_THREAD_ID` was set. `PWD` was correct. Plugin hooks get `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_ROOT` and `CLAUDE_PLUGIN_DATA`; hooks declared in launcher config get none of these. Codex's own environment passes through whole: this host's `CLAUDE_CODE_*` variables from the launching session reached the hook. *verified by experiment; read in source code (`hooks/src/engine/discovery.rs:262-270`, `command_runner.rs:424`, session environment replayed)*
- Shell: a launcher hook recorded `/bin/bash|hBc|non-login`, so the command line runs as `bash -c`. Codex uses the turn environment's shell without login (`core/src/session/mod.rs:5183`, `use_login_shell: false`). It falls back to `$SHELL -lc` only when no shell is known (`command_runner.rs:391`). On this host `bash -c true` takes 1.8 ms and `bash -lc true` 195 ms. *verified by experiment (`logs/q2-hook-shell.txt`); read in source code*

### 3. Trust hash

- Key: `<keySource>:<event_label>:<group>:<handler>`. For a plugin, `keySource` is `<plugin>@<marketplace>:hooks/hooks.json`, with no version and no path (`hooks/src/declarations.rs:35`). For `-c` and `thread/start` `config` it is `/<session-flags>/config.toml` (`discovery.rs:421`). *read in source code; verified by experiment*
- Hash (`discovery.rs:775` `hook_hash`, `config/src/fingerprint.rs:54` `version_for_toml`): `"sha256:" + hex(sha256(json))`. Here `json` is the identity `{event_name: "<snake label>", matcher, hooks: [{type: "command", command, timeout, async, statusMessage?, additionalContextLimit?}]}` with object keys sorted at every level, serialized compactly. Normalization before hashing:
  - `command` is the raw text, before `${PLUGIN_ROOT}` expansion (`discovery.rs:559` vs `:567`).
  - `timeout` defaults to 600; SessionEnd and Interrupt default to 1 and clamp to 1..3.
  - `async` is always present.
  - `matcher` is dropped for UserPromptSubmit, Stop and Interrupt.
  - `additionalContextLimit` is kept only on context events and only when it is not 2,500.
  - `statusMessage` is kept when set.

  *read in source code*
- `probes/wave-0-checks/bin/hash.mjs` (38 lines, `node:crypto` only) ports this. It matched `hooks/list` `currentHash` on 17 handlers:
  - 9 in the rich plugin (`matcher: "*"`, `apply_patch` with `statusMessage`, `additionalContextLimit: 0`, Stop with a dropped matcher, SubagentStart without a timeout, SessionEnd at 3, Interrupt at 9 clamped to 3);
  - 4 plain ones;
  - the Claude plugin's handler;
  - the edited handler;
  - 2 launcher hooks, which ran once trusted.

  *verified by experiment (`logs/q3-trust.txt`, `q2-launcher-hashes.txt`)*
- Trust written from computed hashes ran the hooks with no bypass flag through three layers: the user `config.toml` (`hooks/list` showed `trusted`; the TUI ran them), `-c 'hooks.state={...}'` on `codex exec`, and `thread/start` `config: {"hooks.state": {...}, "hooks.PostToolUse": [...]}`, which declared and trusted the launcher hooks too. *verified by experiment (`logs/q2-*`)*
- Version change: the plugin was reinstalled at 0.1.15 with the same `hooks.json`. The cache moved to `.../squeal-codex/0.1.15/` and the old directory was removed. All 9 hooks stayed `trusted`. At 0.1.16 with one command edited, only that hook became `modified`, with the hash `hash.mjs` predicted; the other 8 stayed `trusted`. This corrects the inference in `codex-sessions-and-wake.md` finding 4 and the expectation in spec open question 3. *verified by experiment (`logs/q3-trust.txt`)*
- Trust through Codex's own API: an app-server client called `hooks/list` and then `config/batchWrite` with `{keyPath: 'hooks.state."<key>".trusted_hash', value: currentHash, mergeStrategy: "replace"}` and `reloadUserConfig: true`. All 9 hooks turned `trusted`, Codex wrote the `[hooks.state."…"]` tables into the user config itself, and a following `codex exec` with no bypass ran them. This is the edit Codex makes for workspace plugins (`app-server/src/effective_plugin_change.rs:88`). *verified by experiment (`logs/q3-trust-api.txt`); read in source code*

## Recommendation for Squeal

1. **Marketplace file: add `.agents/plugins/marketplace.json`** (name `squeal`, one entry `squeal` at `./plugins/codex`, with `plugins/codex/.codex-plugin/plugin.json` `name: "squeal"`). Leave `.claude-plugin/marketplace.json` as it is, with its one entry. Install is then `codex plugin marketplace add <this repository>` and `codex plugin add squeal@squeal`, as D1 states. Do not add a second entry to `.claude-plugin/marketplace.json`. In that layout Codex installs the Claude Code plugin under `squeal@squeal` with its `args` dropped, Claude Code lists the Codex plugin, and the Codex plugin needs a different name.
2. **Fast-path shape: one `command` string, no `args`, testing `$PWD`.** Codex drops `args`, runs the string with `bash -c` in the thread's `cwd` and sets `PWD` to it, so no stdin read is needed. The 001 D9 `s()` function already walks from a subdirectory up to the `.git` and its common dir; under Codex call only `s "$PWD"`. Drop `s "$CLAUDE_PROJECT_DIR"`: Codex never sets it, but it inherits the launcher's environment, so a Codex started from a Claude Code hook could carry a foreign value. Keep `${PLUGIN_ROOT}` literal in the command text so the trust hash does not depend on the install path.
3. **Trust automation that is possible:**
   - (a) `--print-launcher-config` can emit hook declarations plus a matching `hooks.state` table for Cezar's `thread/start` `config`. Keys are `/<session-flags>/config.toml:<event>:<g>:<h>`, hashes from the port above. This needs no file write and no bypass.
   - (b) A Squeal command can trust the installed plugin through Codex itself: spawn `codex app-server`, call `hooks/list`, then `config/batchWrite` for the hooks of `squeal@squeal` that are not `trusted`. Codex writes `~/.codex/config.toml`, and Squeal edits no Codex file. This is a consent step and needs the user's say-so, like `/hooks`.
   - (c) A plugin version raise needs no re-trust unless `hooks.json` changed. A test can pin the `hooks.json` hashes so a release states when users must re-trust.

## Open questions

- The hash format is internal to Codex 0.160.1, not a documented API. A Codex upgrade can change it, and `config/batchWrite` (b) avoids depending on it. Pin the port with a test against `hooks/list` per Codex version if (a) ships.
- SessionEnd at TUI `/exit`: in this run the TUI's thread lived in a managed app-server daemon. SessionEnd fired only when the daemon was stopped, not at `/exit`. That contradicts `codex-sessions-and-wake.md` finding 7 (one run, scratch home). Deciding it needs a TUI run with and without the daemon (`codex app-server daemon stop` before launch) and `/quit` versus `/exit`.
- Plugin hooks under app-server ran here without the project being trusted in user config only because a `danger-full-access` thread persists project trust itself (sessions finding 4). Not rechecked under a read-only sandbox, which cannot run on this host.
- `owner/repo` git marketplace sources were not run (no network test of this repository); the source shows the same file precedence.

## Sources

- Source: https://github.com/openai/codex tag `rust-v0.160.1` (`d27764b`):
  - `codex-rs/core-plugins/src/{marketplace,store}.rs` and `marketplace_add/source.rs`;
  - `codex-rs/exec-server-protocol/src/protocol.rs`;
  - `codex-rs/hooks/src/{lib,declarations,config_rules}.rs` and `engine/{discovery,command_runner}.rs`;
  - `codex-rs/config/src/{hook_config,fingerprint}.rs`;
  - `codex-rs/core/src/{hook_runtime.rs,session/mod.rs}`;
  - `codex-rs/app-server/src/effective_plugin_change.rs`;
  - `codex-rs/app-server-protocol/src/protocol/v2/{turn,config}.rs`.
- Cezarion dist: `/home/agent/.nvm/versions/node/v24.21.0/lib/node_modules/cezarion/node_modules/@wjarka/cezarion/dist/core/codex-app-server-runner.js`.
- This repository: `.claude-plugin/marketplace.json`, `plugins/claude-code/hooks/hooks.json` (the 001 D9 `s()` test).
- Prior findings: `codex-hooks.md` findings 1 and 6, `codex-sessions-and-wake.md` findings 4 and 7.
- Probes and logs: `probes/wave-0-checks/`.
