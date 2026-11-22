# 024 wave 0 checks

Row 024-01. Answers spec 024 Open questions 2, 3 and 4, and records the hook payload shapes that Wave 2 fixtures need. Examined on Linux on 2026-11-22. The CLI was `antigravity` `1.5.14` (release `83311d3f…`, `release.json` `"version":"1.5.14"`). The official docs and installer were fetched the same day. Probes are in `probes/wave-0-checks/` (throwaway). Live runs used a temporary `HOME`. In it, only the CLI's OAuth token file was symlinked; the token was never read or printed. The real `~/.gemini/config/` was unchanged afterwards (its `config.json` matched its earlier `sha256sum`). Raw payloads stayed in `$TMPDIR` and are not committed.

## Questions answered

| # | Question | Verdict | Tag |
| --- | --- | --- | --- |
| 1 | Binary names, and the detection order | The official installer installs only `~/.local/bin/agy`. `agy install` deletes legacy `agy` and `antigravity` shell aliases. Archives and Squawk's managed copy name the same binary `antigravity`. Both names are one binary with the same `plugin` subcommands; only the `argv[0]` text differs. Recommended order: `SQUEAL_ANTIGRAVITY_BIN`, then `agy`, then `antigravity`. Each candidate must pass an identity check, because `antigravity` on `PATH` can be the IDE launcher. | `verified by experiment` (1.5.14), `read in official docs`, `read in source code` (installer, Squawk) |
| 2 | Installed `PLUGIN_DATA`, disabled state, persistence | `PLUGIN_ROOT=~/.gemini/config/plugins/<name>`. `PLUGIN_DATA=~/.gemini/antigravity-cli/plugin_data/<name>`. Every event receives both. Antigravity creates `PLUGIN_DATA` before the first hook runs. The directory survives an in-place reinstall, `plugin uninstall`, and a later install. Disabled state is `config.json` `plugins.<name>.enabled: false`. Uninstall removes the entry. | `verified by experiment` (1.5.14), `read in official docs` |
| 3 | `hooks/run --if-squeal` with large and tricky stdin | Works under `dash` and `bash`. 32 of 32 cases passed, and passthrough was byte-exact. Stdin has no trailing newline. Two guards are needed. (a) Bound the `cwd` search: an unbounded `${payload#*…}` takes 8 to 19 s when `cwd` follows 100 KB, and a killed `PreToolUse` blocks the tool. (b) Parse under `LC_ALL=C` in `bash`. p95 at 100 KB: 6.7 ms with `dash`, 14.9 ms with `bash`. p95 at about 0.4 KB: 3.3 ms with `dash`, 7.3 ms with `bash`. | `verified by experiment` |
| 4 | Payload shapes for `test/fixtures/antigravity-hooks/` | Tables below. All keys are camelCase and alphabetical. Zero values are present. The runs observed `fullyIdle: false`, `executionNum: 1`, and `IsDaemon` on `run_command`. They never observed `continuationActive: true`, or any `terminationReason` other than `NO_TOOL_CALL`. A print timeout and SIGINT end the turn with no `Stop`. | `verified by experiment` (1.5.14); other `terminationReason` values `read in official docs` only |

## 1. Binary name detection (spec OQ2)

- **This host.** `which -a agy antigravity` finds nothing, and neither do `~/.local/bin`, `/usr/bin` and `/usr/local/bin`. The only CLI is Squawk's managed copy, `~/.local/share/hearsay-squawk/tools/antigravity/linux_amd64/versions/<sha256>/antigravity`. Squawk starts it by absolute path. Here `install.sh` and `squeal update` find no CLI without an override (`verified by experiment`).
- **Official docs.** `https://antigravity.google/docs/getting-started.md` says: "Install the Antigravity CLI (`agy`) binary using the automated installer", `curl -fsSL https://antigravity.google/cli/install.sh | bash`, "Default binary location: `~/.local/bin/agy`". The docs use `agy` in every CLI example (`cli/reference.md`, `plugins.md`: "`agy plugin install </path/to/local/plugin>`"). `install.md` says `--skip-aliases` "prevents the script from purging or updating legacy `agy` or `antigravity` shell aliases" (`read in official docs`).
- **Installer source** (`https://antigravity.google/cli/install.sh`, fetched and read, not run): `TARGET_DIR="$HOME/.local/bin"`, `BINARY_PATH="$TARGET_DIR/agy"`. The tarball member is `antigravity`, and the script copies it to `agy`. It then runs `"$BINARY_PATH" install` (`read in source code`).
- **Experiment** (`q1-binary-names.sh`, offline `ubuntu:24.04` container, tmpfs `HOME`). Steps: copy the binary to `~/.local/bin/agy`, then run `agy install` with a `.bashrc` that holds `alias antigravity=agy` and `alias agy=antigravity`. Result: `install` deleted both aliases. It appended `export PATH="$HOME/.local/bin:$PATH"` to `.bashrc` and `.profile`. `~/.local/bin` held only `agy`. Both files had the same hash. `help plugin` and `plugin validate --help` were identical once the program name was replaced. The usage line follows `argv[0]`: `agy --help` prints `Usage of agy:`, and the archive binary prints `Usage of antigravity:` (`verified by experiment`).
- **Squawk source** (`@hearsay-tools/squawk` `0.18.0-dev.7836`, `dist/runners/antigravity/executable.js`). It searches `PATH_NAMES = ['agy', 'antigravity']`, commented "`agy` (Windows, symlinks) and `antigravity` (archives)". It accepts a candidate only when `--version` prints a bare `x.y.z` and `--help` lists `acp`, because "The Antigravity IDE launcher and the retired registry server print neither". Its check also requires the literal `Usage of antigravity:`, so it would reject an `agy` on `PATH`. That is a Squawk defect, not a Squeal input (`read in source code`).
- **Subcommand behaviour** (`verified by experiment`). `plugin uninstall <missing>` prints `Uninstalled plugin "<missing>"` and exits 0. `plugin uninstall --help` tries to uninstall a plugin named `--help`. `plugin disable <missing>` exits 1. `plugin install <missing-dir>` exits 1.

**Recommendation.** Check `SQUEAL_ANTIGRAVITY_BIN`, then `agy`, then `antigravity` on `PATH`. Accept a candidate only when `<cli> --version` prints a bare semver and `<cli> help plugin` lists `uninstall <name>` and `validate`. Never match the usage line literally. Never pass `--help` to a `plugin` subcommand. Never use the exit code of `plugin uninstall` as evidence of presence: read `~/.gemini/config/plugins/squeal/plugin.json` or `plugin list --json` instead. When the plugin directory exists but no CLI passes the check (as on a Squawk-only host like this one), `squeal update` should say so and name `SQUEAL_ANTIGRAVITY_BIN`.

## 2. Installed `PLUGIN_DATA` and disabled state (spec OQ3)

`q2-installed-plugin.sh` installed `logger-plugin` with `plugin install` and ran a live turn (`-p`, `gemini-3.8-flash-low`) with 19 hook calls. It then disabled the plugin, enabled it, reinstalled it in place, uninstalled it, and installed it again (`verified by experiment`):

| Step | Result |
| --- | --- |
| Hook env, all 6 events, 19 of 19 calls | `PWD` = `PLUGIN_ROOT` = `~/.gemini/config/plugins/sqprobe`. `PLUGIN_DATA` = `~/.gemini/antigravity-cli/plugin_data/sqprobe`. |
| Creation | No data directory exists after `plugin install`. The first `SessionStart` already finds `PLUGIN_DATA` (`PLUGIN_DATA_existed: true`, checked before the probe's own `mkdir`). |
| `config.json` after install | No entry. The first CLI start writes `{"plugins":{"sqprobe":{"enabled":true},"swarm":{"enabled":true}}}`. |
| `plugin disable sqprobe` | `"sqprobe":{"enabled":false}`. `plugin list --json` shows `"enabled": false`. A live turn fired 0 hooks. |
| `plugin enable sqprobe` | `"enabled": true`. |
| Reinstall in place | Prints `(replaced existing installation)`. `PLUGIN_DATA` kept its marker file. The `config.json` entry stayed. Later hooks saw the same `PLUGIN_DATA`. |
| `plugin uninstall sqprobe` | The plugin directory and the `config.json` entry are deleted. `PLUGIN_DATA` is kept. |
| Install again after uninstall | `PLUGIN_DATA` still holds the earlier files. |

Official docs (`plugins.md`, built-in `agy-customizations/docs/plugins.md`) say the `config.json` map is "keyed by the plugin's **directory** name". They also say "`config.json` wins wherever it has an entry", and that a missing entry "falls back to its `plugin.json` declaration" (`"disabled": true`) (`read in official docs`).

**Recommendation.** Detect a disabled install as `plugins.squeal.enabled === false` in `~/.gemini/config/config.json`. With no entry, fall back to `plugin.json` `disabled` (Squeal ships none), or use `plugin list --json` `enabled`. The `squeal-launcher` and `squeal ps` path from outside a hook is `~/.gemini/antigravity-cli/plugin_data/squeal/`. `plugin uninstall` leaves that directory behind, so `install.sh --uninstall` must delete it itself. That path is outside `~/.gemini/config/`, so D1 still holds. `PLUGIN_DATA` sits under the CLI's own data directory (`antigravity-cli`). The App and IDE paths are not determined, because no App or IDE host was available (out of v1 scope).

**Disagreement with earlier research.** In these temporary-`HOME` `-p` runs, the only hook env names matching `^(ANTIGRAVITY_|PLUGIN_|GEMINI)` were `ANTIGRAVITY_CONVERSATION_ID`, `PLUGIN_DATA` and `PLUGIN_ROOT`. `antigravity-hooks-and-plugins.md` question 8 says hooks also get `ANTIGRAVITY_AGENT`, `ANTIGRAVITY_APP_DATA_DIR`, `ANTIGRAVITY_LS_ADDRESS` and `ANTIGRAVITY_AGENTAPI_EXE`. A logger run under the `--input-format stream-json` runner would decide which is right. Until then, D6 should key only on `ANTIGRAVITY_CONVERSATION_ID`.

## 3. `hooks/run --if-squeal` with large stdin (spec OQ4)

The candidate is `probes/wave-0-checks/run`, built on `plugins/claude-code/hooks/run`'s walk-up. The test is `q3-fast-path.py`. It ran under `dash` 0.5.12 (`/bin/sh`) and GNU `bash` 5.2.21, with `LANG=C.UTF-8` (`verified by experiment`):

- **Byte-exact passthrough.** `payload=$(cat; printf x); payload=${payload%x}` and `printf '%s' "$payload" | "$@"` gave identical bytes (`cmp`) in every passthrough case. The cases covered a 100 KB UTF-8 `lastUserInput` with quotes, backslashes and `\n` escapes, with no trailer, with `\n`, and with `\r\n\n\n`. A plain `$(cat)` strips trailing newlines (336 bytes in, 334 out). The JSON still parses, so it is harmless, but the sentinel costs nothing.
- **No trailing newline from Antigravity.** The last stdin byte was `}` in every record from the live runs (q2, q4, q4-sigint).
- **The fake `cwd` cannot match, in any key order.** JSON escapes every `"` inside a string, so an unescaped `"cwd":"` only ever occurs as a key. The key order matters for two other reasons. A nested `cwd` key, such as one in an MCP tool's `toolCall.args`, follows the top-level key only because `toolCall` sorts after `cwd`. And the order sets the cost (next item). Cases that passed: fake `{"cwd":"/squeal/repo"}` in the prompt, both orders; spaces in `cwd`; raw UTF-8 `café` in `cwd`; escaped `\\` or `\"` in `cwd`, which fall through; empty `cwd` and no `cwd` key, which fall through; a nonexistent `cwd`, which is silent; a linked worktree of a repository with a store, from a subdirectory, which passes through; a linked worktree without one, which is silent.
- **Search cost grows with the square of the offset.** With `cwd` after a 100 KB prompt, `${payload#*\"cwd\":\"}` took 18.7 s in `dash` and 7.8 s in `bash`. That exceeds the `PreToolUse` timeout, and a killed `PreToolUse` blocks the tool. The candidate first takes `head=${payload%%\"cwd\":\"*}` in one linear scan. Only when `${#head} < 4096` does it extract the value; otherwise it passes the payload to Node. In Antigravity's order, `cwd` sits after `artifactDirectoryPath`, `continuationActive` and `conversationId`, which is under 400 bytes.
- **Locale in `bash`.** Under `C.UTF-8`, each expansion of a 100 KB string costs about 3 ms (`read`, strip, `%%`, length/compare, `#`). Under `C`, the whole parse takes about 2 ms. The candidate sets `LC_ALL=C` for the parse, then restores the caller's value or unsets it before running the command. This was checked for an unset caller value and for `C.UTF-8`.
- **Protojson spacing.** protobuf-go's single-line encoder adds "a random extra space after each comma", seeded by the binary (`internal/encoding/json/encode.go` lines 238–243, v1.36.6, `read in source code`). That build never puts a space after `:`. So match `"cwd":"` and never `,"cwd"`. This build emitted no spaces at all. That Antigravity uses this encoder is `inferred` from the docs' "protojson" and the Go binary.

Latency over 30 runs on a non-Squeal repository, timed from Python `subprocess.run` (spawn included). The host had 16 CPUs (`nproc`) at load average 17 to 22, from this project's parallel work:

| Payload | `dash` min / p50 / p95 | `bash` min / p50 / p95 |
| --- | --- | --- |
| about 0.4 KB | 2.1 / 2.7 / 3.3 ms | 3.5 / 4.7 / 7.3 ms |
| 100 KB | 4.1 / 5.2 / 6.7 ms | 7.0 / 9.9 / 14.9 ms |
| 100 KB plus `\n` | 4.2 / 5.9 / 9.3 ms | 7.2 / 10.7 / 13.0 ms |
| 100 KB, `cwd` last, goes to the command | 5.0 / 6.4 / 10.5 ms | 60.3 / 66.5 / 79.4 ms |
| bare Node, 100 KB | 54.5 / 74.7 / 98.4 ms | |

**Recommendation.** Ship the candidate's shape: sentinel buffering, the 4 KB-bounded `%%` head, `LC_ALL=C` during the parse, backslash or empty fall-through, and the Claude Code walk-up. `dash` meets the 10 ms p95 target at every size. `bash` (where `/bin/sh` is `bash`) meets it at real payload sizes. For a 100 KB prompt it reached 13 to 15 ms p95 on this loaded host. No shell limit triggered, so no Node fallback for size is needed.

## 4. Payload shapes for fixtures

Every payload is one line of camelCase JSON. Keys are in alphabetical order. There is no trailing newline. Zero values are present (`false`, `0`, `""`). Common fields, all events:

| Field | Type | Sanitized example |
| --- | --- | --- |
| `artifactDirectoryPath` | string | `/home/user/.gemini/antigravity-cli/brain/<conversationId>` |
| `conversationId` | string (UUID) | `00000000-0000-4000-8000-000000000001` |
| `cwd` | string | `/home/user/project` |
| `hookEventName` | string | `SessionStart`, `PreInvocation`, `PreToolUse`, `PostToolUse`, `PostInvocation`, `Stop` |
| `lastUserInput` | string | the prompt; `""` in a subagent |
| `modelName` | string | `gemini-3.8-flash-low` |
| `transcriptPath` | string | `<artifactDirectoryPath>/.system_generated/logs/transcript_full.jsonl` |
| `workspacePaths` | array of string | `["/home/user/project"]` |

Event-specific fields:

| Event | Extra fields (type) | Observed values |
| --- | --- | --- |
| `SessionStart` | none | Fires once per new conversation, and once per subagent. |
| `PreInvocation` and `PostInvocation` | `initialNumSteps` (int), `invocationNum` (int) | `invocationNum` 0, 1, 2, … within a turn. `initialNumSteps` 1, 3, 5, 8, 10. |
| `PreToolUse` | `stepIdx` (int), `toolCall` `{args: object, id: string, name: string}` | `id` is `call_` plus 19 or 20 characters. `stepIdx` 2, 4, 7. |
| `PostToolUse` | as `PreToolUse`, plus `error` (string) | `error: ""` on success. |
| `Stop` | `continuationActive` (bool), `error` (string), `executionNum` (int), `fullyIdle` (bool), `terminationReason` (string) | `executionNum` 0, then 1 after a `"continue"`. `continuationActive` was `false` every time. `fullyIdle` was `true`, or `false` while a subagent, a `schedule` timer or an async command ran. `terminationReason` was `"NO_TOOL_CALL"`. `error` was `""`. |

`toolCall.args` by tool, as the CLI's model chose them:

| `name` | `args` |
| --- | --- |
| `write_file` | `Content` string, `Path` string (absolute) |
| `edit_file` | `Path` string, `Replacement` string, `Target` string |
| `run_command` | `CommandLine` string, `WaitMsBeforeAsync` int (1000 or 5000), `toolSummary` string, and in one run `IsDaemon` bool. There is no `Cwd`. |
| `invoke_subagent` | `Prompt` string, `Role` string, `TypeName` string |
| `schedule`, `send_message` (seen in the subagent) | `DurationSeconds` int and `Prompt` string; `Message` string and `Recipient` string (the parent's `conversationId`) |

Sequences that fixtures and handlers should cover (`verified by experiment`, `q4-shapes.sh`, `q4-sigint.sh`):

- **Background subagent.** The parent's `Stop` arrives with `fullyIdle: false`. The subagent gets `SessionStart` with `lastUserInput: ""`. When the subagent reports back, the parent starts a turn with no new user input: `PreInvocation` `invocationNum: 0` with the old `lastUserInput`, then `Stop` with `fullyIdle: true`.
- **Late `PostToolUse`.** The subagent's `schedule` `PostToolUse` arrived 10 s after its own `Stop` (`fullyIdle: false`), just before its next `PreInvocation` `invocationNum: 0`.
- **No `Stop` on abort in `-p`.** `--print-timeout` (`finished_reason: "print_timeout"`, exit 3) and SIGINT (`"interrupted"`, exit 1) both ended the turn after `PreInvocation` without a `Stop`. The other `terminationReason` values (`USER_CANCELED`, `ERROR`, `MAX_INVOCATIONS`, …) are only in the built-in `hooks.md`. Fixtures for them are synthetic, not recorded.

For fixtures, use placeholder UUIDs and `/home/user/...` paths, which `check:private` allows. Keep `lastUserInput` and `Content` short and synthetic.

## Open questions

- Hook env under the `stream-json` runner (the disagreement in section 2).
- `PLUGIN_DATA` path for the App and IDE surfaces (out of v1 scope).
- Whether any CLI path sends `Stop` with `continuationActive: true` or a `terminationReason` other than `NO_TOOL_CALL`. Interactive Esc in the TUI was not tried.

## Sources

- `antigravity` `1.5.14` live and offline probes: `probes/wave-0-checks/` (2026-11-22).
- `https://antigravity.google/docs/getting-started.md`, `install.md`, `cli/reference.md`, `plugins.md`, `hooks.md`. `https://antigravity.google/cli/install.sh` (fetched 2026-11-22).
- Built-in docs: `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/{plugins,hooks}.md`, `antigravity_guide/references/cli.md`.
- `https://raw.githubusercontent.com/protocolbuffers/protobuf-go/v1.36.6/internal/encoding/json/encode.go`.
- `@hearsay-tools/squawk` `0.18.0-dev.7836`: `dist/runners/antigravity/{executable,cli}.js`.
- Squeal: `plugins/claude-code/hooks/run`.
