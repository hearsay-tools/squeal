# Research: cli-distribution

Board row 005-05, 2026-10-09. Claude Code 2.1.295, Codex CLI 0.160.1, Node 24.21.0, Linux. Squeal 0.1.62 (tag `squeal--v0.1.62`) and 0.1.72 (`2d01143`). Probes in `probes/cli-distribution/` (README, scripts, `logs/`), all under `/tmp/cli-dist` with a scratch `HOME` and `CODEX_HOME`. 0 agent subject sessions: hooks were run from recorded inputs. Host load 34 to 87 on 24 CPUs; each timing below gives its load.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Plugin updates; what a shim sees | Claude Code updates on `claude plugin update` after a marketplace refresh, or in the background when the marketplace has auto-update on, which is off by default for ours. It keeps the old directory 14 days. Codex upgrades Git marketplaces at every session start and deletes the old directory at once. User and project scopes hold different versions side by side. A resolving shim followed every change (+85 ms a call). A fixed path stayed on the old version in Claude Code and broke in Codex. | verified by experiment; read in official docs; read in source code |
| 2 | Distribution options and skew | (a) Plugin only, plus a resolving shim: no skew between the CLI and the plugin. (b) A separate npm CLI works (577 KB tarball, no dependencies). A CLI older than the hooks is stepped down, and every file re-runs under a new key. A newer one keeps serving older hooks. (c) A CLI that owns the plugins: Claude Code loads the plugin in place, but the marketplace name clashes with the hub, and Codex needs `codex plugin add` after every update. | verified by experiment; read in docs/source for SEA, Homebrew, npm and command sources |
| 3 | A terminal `squeal setup` | init, then trust (`--yes`, 1.1 s, once per user), then a warm-up (`start` and `run --all --wait`: 4.6 s wall, 2.2 s daemon CPU, load 46). `status --wait` is not a warm-up. The results survive the idle exit and carry over to a new worktree. A session whose plugin is newer than the warm-up's daemon re-runs everything. | verified by experiment |
| 4 | Prior art | beads, Serena and Nx ship a separately installed CLI as the product. Their agent wiring names that CLI on PATH (beads, Serena) or through `npx` in the repository (Nx), so the wiring cannot lag the CLI. Where a Claude Code plugin exists, it is optional and updated separately (beads checks the versions). | read in source code; read in official docs |

## 1. Plugin updates

**Claude Code** (`read in official docs`: plugins/loading, fetched 2026-10-09; `verified by experiment`: `logs/q1.log`, `q1d.log`)

- Triggers. `claude plugin update` alone does not refresh the marketplace (release-hub). `claude plugin install name@marketplace` refreshes the named marketplace first. Background auto-update runs "after you send your first message, … a random delay of up to ten minutes". It covers only marketplaces with `autoUpdate`, which is "off for every other marketplace" than Anthropic's. `DISABLE_AUTOUPDATER`, `DISABLE_UPDATES` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` turn it off, unless `FORCE_AUTOUPDATE_PLUGINS=1`. The probe's `known_marketplaces.json` entry had no `autoUpdate` key.
- Old version. After `update --scope user` 0.1.62 → 0.1.72, the 0.1.62 directory held `.orphaned_at` and an `.in_use/` directory and stayed runnable. Docs: removed "14 days later, so a session that already loaded the old version keeps running". A running session's hooks "keep using the previous version's path" until `/reload-plugins`.
- Scopes. With user scope at 0.1.62, `claude plugin install --scope project` in `proj` installed 0.1.72. `installed_plugins.json` then held both entries and both cache directories. `claude plugin list --json` lists every entry in any directory. Which entry a session in `proj` loads is not determined: the docs do not say, and the scratch home has no credentials for a live session.
- An enabled plugin whose only `true` is in the project's `.claude/settings.json` is not fetched on a machine that lacks it ("is enabled in project settings but isn't installed here"). So a collaborator installs it.

**Codex** (`read in source code`: `rust-v0.160.1`, `core-plugins/src/manager.rs:2812-2886`, `:2955-3010`, `loader.rs:512-556`; `verified by experiment`: `q1.log`, `q1b.log`, `q1c.log`)

- At each session start with plugins enabled, a `plugins-marketplace-auto-upgrade` thread upgrades every configured Git marketplace and force-reinstalls the installed plugins of each upgraded one. Manually: `codex plugin marketplace upgrade`. No setting to turn this off was found.
- The upgrade 0.1.62 → 0.1.72 left only `0.1.72`. The fixed path then failed with `Cannot find module …/0.1.62/dist/cli/squeal.mjs`. A daemon or session running from that path loses its files (004 `lessons.md` defect 4).
- A local (directory) marketplace is not upgraded: "marketplace `hearsay` is not configured as a Git marketplace". `codex plugin list` did not refresh it, though its source schedules an if-version-changed refresh when plugins are listed (`manager.rs:1804`). Re-running `codex plugin add` installed the new version.
- Hook trust is keyed `squeal@hearsay:hooks/hooks.json:<event>:<group>:<handler>`, with no path or version in the key. Trusted at 0.1.72, it stayed trusted after an upgrade to 0.1.73 with an unchanged `hooks.json`: "every hook … is trusted; nothing to do". Trust is once per user and plugin id, not per repository.

**Shims** (`verified by experiment`, `q1.log`). `squeal-shim.sh` resolves the plugin at each call, from `installed_plugins.json` (a project entry for the cwd first, then user) and else from the Codex cache. It printed the new version after every install, update and upgrade, in both harnesses. 10 calls took 2.97 s against 2.12 s for `node` on the bundle directly (+85 ms a call, load 87). A path written once kept 0.1.62 in Claude Code for up to 14 days and broke at once in Codex.

## 2. Distribution options

| Option | Install | Updated by, when | Node | Skew |
|---|---|---|---|---|
| (a) plugin only + resolving shim | `claude plugin marketplace add hearsay-tools/marketplace` and `claude plugin install squeal@hearsay` (Codex: `marketplace add`, `plugin add`), then a shim in `~/.local/bin` | the harness: Codex at every session start; Claude Code by hand, or by auto-update once the user turns it on | ≥22.13, needed by the hooks anyway | none between the CLI and the plugin; possible between the harnesses or the two scopes |
| (b) separate CLI | `npm i -g <pkg>` (verified from a tarball: 577 KB, bundle only, `engines >=22.13`); Homebrew wraps the npm tarball with `depends_on "node"` (docs); Node SEA (docs) | the user, never the harness | npm: yes; SEA: embeds Node | the CLI's version against the plugin's, at every release |
| (c) CLI installs the plugins | the CLI ships both plugin directories and a local marketplace (verified, `q1b.log`) | the CLI's own update; Codex also needs `codex plugin add` after it | yes | none for Claude Code (loaded in place); Codex until re-added |

**Skew, measured** (`verified by experiment`, `q2.log`; one store, 0.1.62 and 0.1.72; the store schema is the same in both, `schema.ts` unchanged between them):

- **Older daemon, newer hooks (A, A2).** A 0.1.62 `squeal start`, then a 0.1.72 SessionStart. The daemon stepped down: "hooks at Squeal 0.1.72 are newer than this daemon (0.1.62); their daemon starts once this one exits". In A2 a forced tier with an 8 s file was in flight. It finished and stored its results (17:15:29.5 to 38.4), and the successor started at 38.9. The successor re-ran all 4 files, because the Squeal version is part of the environment hash (`src/core/keys/environment.ts`): 2 keys per check. At real scale this is the re-key of 004 `lessons.md` defect 4, about 4 min of fast suite here and about 50 min in cezarion, plus the slow files.
- **Newer daemon, older hooks (B).** A 0.1.72 daemon kept serving a 0.1.62 session, which received `SQUEAL · … 1 failing check at revision 1` after an edit. An older hook never replaces a newer daemon (001 D10), so a separately installed CLI newer than the plugin keeps serving every older plugin's hooks.
- **Newer schema (C).** With `user_version` raised by one, both 0.1.62 and 0.1.72 said "Status unavailable, store version newer than this Squeal (store 2, supported 1)", and the 0.1.62 SessionStart hook printed nothing.

**(c) in detail** (`verified by experiment`, `q1b.log`). Claude Code installed `squeal@hearsay` from the CLI's directory. After the directory was replaced by 0.1.72, `claude plugin list` read "Version: 0.1.72, Read from: <pkg>/plugins/claude-code" before any update. That matches the docs: relative-path plugins in a local marketplace "load in place". The hub is also named `hearsay`, and "a user can't have two marketplaces with the same name". So a CLI-owned marketplace replaces the hub or takes a new plugin id, which `src/cli/plugin-id.ts` and the Codex trust keys depend on. Two further sources fit (c), neither probed (no registry; a command needs the user's acceptance): an `npm` plugin source, accepted by both harnesses (marketplace-reference; Codex `npm_source.rs`), and a Claude-only `command` source in `link` mode, re-run "once per session". `inferred`: an in-place update changes the hook files under a session that is running.

**SEA and Homebrew** (`read in official docs`). In Node 24.21, SEA is "Stability 1.1", "only supports … CommonJS", and its `require()` "can only be used to load built-in modules". The build goes through `postject`, and macOS needs codesigning. Squeal is an ESM bundle that hooks spawn as `node <cli> daemon`, and its daemon imports the project's Vitest from disk. A SEA would rework both, so it was not built (`inferred`).

## 3. A terminal `squeal setup`

All `verified by experiment` (`q3.log`, `q3b.log`, `q2.log`), on the fixture with 0.1.72:

- **Steps.** `squeal init` (and `--harness codex`). Then `init --harness codex --trust --yes`: 1.1 s, no credentials needed, idempotent ("nothing to do"). Without `--yes` and with no terminal it prints the hooks and "no terminal to ask on; rerun with --yes …; nothing changed". Then the warm-up: `squeal start` (592 ms) and `squeal run --all --wait`, 4.6 s in total, with 2.2 s of daemon CPU at load 46.
- **Not a warm-up.** `start` then `status --wait 60000` returned in 1.4 s with 0 runs and 0 results, in 0.1.62 (A) and 0.1.72 (B). The daemon had not listed the test files yet, and the hook said "these counts are not complete". Only `run --all --wait` waits for a checkpoint.
- **Idle exit.** With `daemon.idleExitMinutes` at 0.1, the daemon stopped "idle for 6 s with no registered consumers". The first session's SessionStart spawned a new daemon, which reported "14 current … Full-suite checkpoint: completed" and ran nothing more (runs stayed at 1). So the 60-minute exit costs one daemon start, not a re-run.
- **First session.** A session of the same version registers on the warm-up's daemon. That daemon exits 3 s after the session ends ("no session registered for 3 s"). A session of a newer plugin steps it down, the tier in flight finishes, and the suite re-runs (A2). So the warm-up must run the plugin's own CLI to be worth anything. With (a) it does, unless the two harnesses or the two scopes hold different versions.
- **Worktrees.** A linked worktree of the warm fixture had a settled status 1.2 s after `squeal start`: "Inherited from other worktrees: 14 current results", with no new run.

## 4. Prior art

- **beads** (`steveyegge/beads` at `f21e3a8`, `read in source code`). Install: `brew install beads`, `npm install -g @beads/bd` (a native-binary wrapper with a `postinstall`), `install.sh`, or `go install`. Update: `brew upgrade`, `npm update -g`, then the checklist's `bd hooks install` and `bd version`. `bd init` and `bd setup <agent>` write hooks that run the CLI on PATH (`bd prime --hook-json`), so the hooks always match the installed CLI. The Claude Code plugin is optional: "the plugin requires the `bd` CLI … Update it separately". Its MCP server "automatically checks bd CLI version on startup", and `/beads:version` warns on a mismatch. With the plugin installed, `bd setup claude` skips its hooks "so `bd prime` doesn't fire twice".
- **Nx** (`nrwl/nx` at `c279829`, `packages/nx/src/ai/set-up-ai-agents/set-up-ai-agents.ts`; `nrwl/nx-ai-agents-config` at `49aa84c`). The CLI is the repository's own devDependency. `npx nx configure-ai-agents` writes `extraKnownMarketplaces.nx-claude-plugins`, an unpinned `github` source whose `plugin.json` carries version 0.2.34, and `enabledPlugins` into project settings. It writes the MCP server as `npx nx mcp` from Nx 22, which runs the workspace's own Nx. `--check` reports outdated configuration. The plugin carries skills and MCP, and no hooks.
- **Serena** (`oraios/serena` at `1de556f`, docs `02-usage`). The brief's `uvx` is now `uv tool install -p 3.13 serena-agent`, updated by `uv tool upgrade serena-agent`. `serena setup claude-code` runs `claude mcp add --scope user serena -- serena start-mcp-server …`, and its hooks call `serena-hooks …` on PATH. There is no plugin.
- **skills** (`vercel-labs/skills` at `671e8c3`, linked from Nx's ai-setup page). `npx skills add <repo>` copies or symlinks skills into each agent's directory, per project or with `-g`, and checks for updates. It ships no hooks. No tool these docs lead to ships a CLI with plugin-carried hooks the way Squeal does.

What Squeal can reuse: one product CLI that every integration names, a version check that tells the user when two copies differ (beads), a `--check` of the wiring (Nx, beads), and setup as a CLI command that the agent-side wiring and the skill call.

## Recommendation for Squeal

**Distribution: (a).** The plugin stays the only full copy. `squeal` on the terminal PATH is a resolving launcher: a shim that finds the installed plugin's `dist/cli/squeal.mjs` at each call, as `resolve.mjs` does. Do not ship a second full CLI (b). The measured cost of one version mismatch is a full re-run, and a newer separate CLI's daemon would keep serving older hooks. Squeal's hooks and daemon must share a version, unlike beads or Serena, whose hooks are one-line calls into the CLI. Leave (c) until the hub's marketplace name and the Codex re-add are settled. An npm package that holds only the launcher, `setup` and a plugin install could come later; publishing is the human's call.

**Update story.**
- *First-time user.* Installs the plugin with the harness commands (`claude plugin marketplace add hearsay-tools/marketplace`, `claude plugin install squeal@hearsay`, or the Codex pair), then asks the agent for `/squeal:setup`. The skill offers the launcher in `~/.local/bin` and the warm-up. Codex updates the plugin at each session start. Claude Code updates only with `claude plugin update` or with auto-update turned on for `hearsay`, which setup should offer. The launcher follows either.
- *A user who knows Squeal, in a fresh repository.* Runs `squeal setup` from the terminal before starting an agent. Codex trust is skipped once given, since it is per user. The warm-up runs the plugin's own version, so the first session keeps it. Then the user commits `squeal.config.json`, the settings and the block.
- *A collaborator joining a set-up repository.* Installs the plugin once: `claude plugin install squeal@hearsay --scope project`, which `squeal init` already prints, because Claude Code does not fetch a plugin enabled only in project settings. Codex: `marketplace add`, `plugin add`, and trust once per machine. The store is local, so setup offers the warm-up again.
- *An orchestrator creating worktrees.* Nothing per worktree. A new linked worktree inherited every current result. An optional `squeal start` gives a settled status in about a second. What costs is a version change, which re-keys every worktree, so pin releases (as the hub does) and update between batches.

**`squeal setup` and the skill.** One engine, two front ends. `squeal setup` asks on a terminal, takes `--yes` and one flag per choice for scripts, and without a terminal prints the plan and writes nothing, as `init --trust` does today. The steps:
1. Locate the plugin through the launcher.
2. Detect the harnesses and whether each has the plugin installed. When one does not, print the install commands, since Squeal writes nothing under `~/.codex` (002 D1).
3. `init` for each harness, with D3's block and gate choices.
4. Codex trust, when untrusted.
5. Offer the launcher, and Claude Code auto-update for `hearsay`.
6. Offer the warm-up as `start` then `run --all --wait`, never `status --wait`.

The `/squeal:setup` skill of D3 keeps the interview. It runs `squeal init --plan --json`, asks through the harness's question tool, and applies with `squeal setup --yes …`. The skill and the terminal then share one tested path.

## Open questions

1. Which install a Claude Code session loads when the user and project scopes hold different versions: not determined. The docs are silent and no live session ran (no credentials in the scratch home). The launcher's project-first rule is a choice, `inferred`.
2. Whether a Codex TUI session start refreshes a plugin from a local marketplace: not determined. The source schedules a refresh when plugins are listed, but the CLI's `plugin list` did not do one.
3. `npm` and `command` plugin sources were not probed: no registry here, and a command source needs the user's acceptance.
4. Whether to publish anything to npm (`package.json` is `private`, `UNLICENSED`) is the human's call.
5. Claude Code's background auto-update timing was read, not observed.

## Sources

- Claude Code docs, fetched 2026-10-09: https://code.claude.com/docs/en/plugins/loading (cleanup of previous versions, auto-update, in-place plugins, project-only enablement), https://code.claude.com/docs/en/plugins/marketplace-reference (npm, command and relative-path sources, one marketplace per name). `claude plugin install|update --help` at 2.1.295.
- Codex source, https://github.com/openai/codex tag `rust-v0.160.1` (`d27764b`): `codex-rs/core-plugins/src/{manager.rs,loader.rs,marketplace.rs,npm_source.rs,marketplace_upgrade.rs}`.
- Node: https://nodejs.org/docs/latest-v24.x/api/single-executable-applications.html. Homebrew: https://docs.brew.sh/Language-Specific-Formulae (Node).
- beads https://github.com/steveyegge/beads `f21e3a8` (`README.md`, `docs/getting-started/{installation,ide-setup}.md`, `docs/integrations/claude-code-plugin.md`, `npm-package/package.json`, `.claude-plugin/marketplace.json`). Nx https://github.com/nrwl/nx `c279829` (`packages/nx/src/ai/`) and https://github.com/nrwl/nx-ai-agents-config `49aa84c`; https://nx.dev/docs/getting-started/ai-setup. Serena https://github.com/oraios/serena `1de556f` (`docs/02-usage/{010_installation,030_clients}.md`, `src/serena/config/client_setup.py`). skills https://github.com/vercel-labs/skills `671e8c3` (`README.md`).
- This repository: `src/cli/{init,start,run,plugin-id}.ts`, `src/cli/codex/{init,hash,trust}.ts`, `src/core/daemon/lifecycle.ts`, `src/core/keys/environment.ts`, `src/core/store/schema.ts`; spec 001 D8 to D10; `001-core-loop/research/release-hub.md`; `004-slow-suites/lessons.md` defect 4; `docs/process.md` 6a; `../spec.md` D3; `../status.md`.
- Probes: `probes/cli-distribution/` (`q1.sh` to `q3b.sh`, `resolve.mjs`, `squeal-shim.sh`, `logs/`).
