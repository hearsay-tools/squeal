# 008 wave-0 checks

Row 008-11, 2026-10-14. OpenCode **1.18.35** (`opencode-ai` and `@opencode-ai/plugin` pinned as devDependencies), source read at tag `v1.18.35` (`53d1eab`). Every OpenCode run below was made as the throwaway user `squeal-e2e`, never as the agent user, with the scripted provider (`test/fixtures/opencode/scripted-provider.ts`), so no credentials and no network. Raw output: [probes/wave-0-checks/](probes/wave-0-checks/README.md).

| Check | Answer |
| --- | --- |
| 1. Isolation | `HOME`, `TMPDIR`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_CACHE_HOME`, `XDG_STATE_HOME` in the run directory, plus `OPENCODE_DISABLE_MODELS_FETCH=1`, the two config directories seeded, and the project a git repository outside any other: nothing written, read or connected outside it, under `run` and `serve`. The helper runs locally. |
| 2. Offline provider | `@ai-sdk/openai-compatible` is bundled: no fetch for the provider. OpenCode itself fetches `@opencode-ai/plugin` from npm into every config directory and refreshes models from `models.opencode.ai` unless prevented; the helper prevents both. |
| 3. Open question 1 | `file:<dir> -g` links the directory, it does not copy it. `file:<v2> -g --force` does not replace `file:<v1>`: both entries stay and both versions load. A stable symlink path installed once and repointed switches the version. |
| 4. Open question 2 | Yes: a text part pushed onto `output.parts` in `chat.message` reaches the model's request, in the same user message, if it carries an `id` starting `prt`. Without an `id` the prompt fails. |

## 1. Isolation

**verified by experiment.** `test/fixtures/opencode/isolation-check.sh` (run from the agent user, it copies itself to `squeal-e2e` and runs there) traces `opencode --version`, then a scripted `write` and a text under `opencode run` and an `opencode serve` turn, with `strace -f -e trace=%file,%desc,%network`, in three environments: `bare` (HOME and PATH only), `unseeded` (the helper's variables, config directories left empty) and `helper` (exactly what `test/helpers/opencode.ts` sets). It lists every file-changing syscall outside the temp directory, every path under the real `HOME` looked at, every non-loopback connect, and diffs a `HOME` snapshot. Result ([isolation-check.txt](probes/wave-0-checks/isolation-check.txt)):

- `helper`, under `run` and `serve`: 3 model requests each (two planned, one title), `out.txt` written, and outside the run directory only two lines: Bun opening its extracted native modules relative to the `TMPDIR` fd (the files land in the run's `tmp/`, checked by listing it) and a refused open of `/sys/kernel/debug/tracing/trace_marker`. No path under `HOME`, no connect. The snapshot diff shows nothing of the helper runs.
- `bare`: writes `~/.local/share/opencode` (`opencode.db`, the log, a git snapshot repository per project), `~/.local/state/opencode/locks`, `~/.cache/opencode/models.json`, and Bun's native modules under `/tmp`; reads `~/.config/opencode` (config, `AGENTS.md`, agents, commands, plugins, skills, tools), `~/.claude/CLAUDE.md`, `~/.agents`, `~/.opencode`, `~/.gitconfig` and `~/.config/git`; connects to `models.opencode.ai` (`104.20.32.17`, `172.66.173.149`, resolved with `getent`).
- `opencode --version`, what `opencode-ai`'s postinstall runs: creates the seven global directories if missing (`Global.Path` in `packages/core/src/global.ts`: data, data/log, data/repos, config, state, cache/bin and `$TMPDIR/opencode`) and writes no file. So `npm ci` as the agent user makes only empty directories under its `HOME`, if absent. This row installed with `--ignore-scripts`; the helper takes the binary from the platform package (`opencode-linux-x64/bin/opencode`), so it does not need the postinstall.

What confines it, and why each:

- `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `XDG_CONFIG_HOME`: OpenCode's database, log, snapshots, locks, models cache, npm cache and global config (`xdg-basedir` in `global.ts`). **read in source code, verified by experiment.**
- `HOME`: `~/.claude/CLAUDE.md`, `~/.agents` skills and `~/.opencode` are read from `os.homedir()`; and git, run for snapshots, reads `~/.gitconfig`. **verified by experiment.**
- `TMPDIR`: Bun extracts its native modules (`.so`, `.node`, 5.5 MB) there and OpenCode makes `$TMPDIR/opencode`. **verified by experiment.**
- `OPENCODE_CONFIG_DIR`: confines nothing; the helper sets it to the run's directory to hold the provider config and plugins under test, and so a caller cannot point it elsewhere.
- `OPENCODE_DISABLE_MODELS_FETCH=1`: without it OpenCode refreshes `models.json` from the network (`packages/core/src/models-dev.ts`); with it, the snapshot built into the binary. `OPENCODE_DISABLE_AUTOUPDATE=1` and `autoupdate: false` keep the update check off. **read in source code, verified by experiment.**
- Config-directory seeding: OpenCode npm-installs `@opencode-ai/plugin` into every config directory it loads, global, `OPENCODE_CONFIG_DIR` and each project `.opencode` (`config/config.ts`, a detached fiber). `Npm.install` skips a directory whose `node_modules` exists and whose `package-lock.json` lists the package (`packages/core/src/npm.ts`). The `unseeded` run connected to `104.16.0.34` to `104.16.11.34`, `registry.npmjs.org`; the seeded one connected nowhere. The helper links this repository's pinned `@opencode-ai/plugin` there, so a plugin under test can import it. **read in source code, verified by experiment.**
- The cwd: OpenCode searches upward from the project for `opencode.json`, `.opencode`, `AGENTS.md` and ignore files, stopping at the worktree root; outside a repository that is `/`. The helper's project is a fresh git repository in a run directory outside any other repository (the Pi helper's `piBase()`), so the search stops at the project. Outside it OpenCode only checked `/tmp` and `/` for `.git`, `.gitignore`, `.ignore`, `.jj` (all absent). **verified by experiment.**

The helper refuses a caller's override of each of these and of `OPENCODE_CONFIG`, `OPENCODE_CONFIG_CONTENT`, `OPENCODE_TEST_HOME` (replaces `os.homedir()` in `global.ts`) and `OPENCODE_DB`, which would point config, home or the database elsewhere.

**The helper runs locally, not only in CI**: the check found no write and no read outside the run directory. `opencodeUnavailable()` skips locally only when the installed OpenCode is not the checked 1.18.35 or git is missing; on CI a reason is a failure. After this check passed, `test/harness/opencode-fixture.test.ts` ran locally as the agent user (15 tests, green).

## 2. The scripted provider loads offline

**verified by experiment, read in source code.** The provider is configured with `npm: "@ai-sdk/openai-compatible"`, which is in `BUNDLED_PROVIDERS` (`packages/opencode/src/provider/provider.ts`), so OpenCode imports it from the binary and fetches nothing for it. The `helper` runs made no connect except to the provider on `127.0.0.1`. The two fetches OpenCode makes on its own, the models refresh and the `@opencode-ai/plugin` install, are the ones check 1 turns off.

Two details the fixture relies on: OpenCode asks the small model for a session title, so the helper sets `small_model` to a second scripted model that answers a fixed title and never takes a planned step; and `opencode run` must have stdin closed (the sessions research's attempt 1), which the helper does.

## 3. Open question 1: updates without a remove command

**verified by experiment** ([checks.txt](probes/wave-0-checks/checks.txt), `checks.sh` check 3). Two versioned directories, `pkgs/squeal-0.0.1` and `pkgs/squeal-0.0.2`, each a package `squeal-probe` with `exports["./server"]` whose init logs its version and `import.meta.url`:

- `opencode plugin file:<dir> -g` writes `"plugin": ["file:<dir>"]` to the global `opencode.json` and installs through Arborist into `$XDG_CACHE_HOME/opencode/packages/file:<dir>/`, whose `node_modules/squeal-probe` is a **relative symlink to `<dir>`**. The plugin loads from `<dir>` itself (`import.meta.url` is `file://<dir>/dist/plugin.js`), and an in-place edit of `<dir>` loads at the next start. A link, not a copy: the package finds its own `dist/`, and its directory cannot be deleted while it is installed.
- `opencode plugin file:<v2> -g` appends a second entry; with `--force` too. `patchPluginList` (`plugin/install.ts`) counts as duplicates only the same spec or, for npm specs, the same package name; `file:` paths are never the same name. Both entries stay, **both versions load**, each plugin's server function runs once per start. The same holds for an absolute-path spec without `file:` (check 3b).
- With v1's directory deleted, OpenCode starts normally, loads v2 and says nothing on stderr; the stale entry stays in the config.
- A stable path works (check 3c): `opencode plugin file:<pkgs>/current -g` with `current` a symlink to `squeal-0.0.1`, then `current` repointed to `squeal-0.0.2`, loads 0.0.2 at the next start (`import.meta.url` is the resolved target). The config keeps one entry.
- Incidentally, `opencode plugin` itself starts the configured plugins: the probe logged one init during the plain install of v2 and two during the `--force` one. **inferred** from the counts.

So the spec's condition "neither replace nor a stable path works" is not met: replace does not work, a stable path does. `install.sh` can run `opencode plugin file:<squeal dir>/opencode/current -g` once and update by unpacking the next version beside it and repointing `current`, then delete the old directory. Calling `--force` with a new versioned path would leave two Squeal plugins running.

## 4. Open question 2: a text part from `chat.message`

**verified by experiment** (`checks.sh` check 4, `q2-plugin.js` in the global config's `plugins/`). `chat.message` gets `{message, parts}` after OpenCode has resolved and id'd the user's parts, then saves every part in `output.parts` (`session/prompt.ts`, `createUserMessage`). Three shapes of a pushed `{type: "text", text, sessionID, messageID}`:

| Shape | Result |
| --- | --- |
| `id` = the last part's id + `"z"` | the first model request's user message is `[{text: "hello"}, {text: "SQUEAL-Q2-after"}]`; run exits 0 |
| the same with `synthetic: true` | the same: synthetic text parts reach the model |
| no `id` | `invalid user part before save … Missing key ["id"]` in the log, `UnknownError` on stdout, exit 1, **no model request** |

`PartID` must start with `prt` (`session/schema.ts`) and parts sort by id, so an id derived from the last part keeps the order. The fallback `noReply` (D3) is not needed for this case; a part without a valid id breaks the user's turn, so the plugin must always set one.

## For later rows

A test that starts OpenCode uses `runOpenCode` from `test/helpers/opencode.ts`: `plugins` links plugin files into the run's `OPENCODE_CONFIG_DIR/plugins/`, `files` writes into the project, and `requests` are the planned model's requests in order. A test that spawns OpenCode another way (the end-to-end `opencode plugin` install) sets the six directories and `OPENCODE_DISABLE_MODELS_FETCH`, seeds every config directory as `seed()` does, and keeps its cwd in a git repository outside this one. An OpenCode upgrade re-runs `isolation-check.sh` and raises `CHECKED_VERSION` in the helper.
