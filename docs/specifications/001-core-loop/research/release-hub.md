# Research: a release hub for the human's plugins

Task 001-163, 2026-10-09. Claude Code 2.1.295 and Codex 0.160.1 on Linux. Squeal at `8e77f0a` (0.1.60). Every experiment ran with `HOME` and `CODEX_HOME` in a scratch directory, against a scratch tool repository shaped like Squeal (`plugins/claude-code`, `plugins/codex`, one version) and a scratch hub, both served over smart HTTP on 127.0.0.1. No real repository, `~/.claude` or `~/.codex` was changed; the real ones were only read. Probe and log: `probes/release-hub/` (`run.sh`, `run.log`).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Claude Code: pin another repository's ref, and updates | Yes. `git-subdir` `{url, path, ref, sha}` (also `github`, `url`); `sha` wins over `ref`. An installed plugin moves only when the hub moves and the plugin's `version` differs: `claude plugin marketplace update <hub>` then `claude plugin update`, or background auto-update when the user turned it on. Running sessions keep the loaded version; the old directory stays 14 days. | verified by experiment; read in official docs |
| 2 | Codex: the same | Yes. `git-subdir` and `url` with `ref` and `sha` in `.agents/plugins/marketplace.json`; no `github` type. Codex upgrades every Git marketplace at each session start, or on `codex plugin marketplace upgrade`, then reinstalls. It deletes the old version's directory at once. No copy-holding hub is needed. | verified by experiment; read in source code (`rust-v0.160.1`) |
| 3 | Which of the human's tools publish a plugin | Squeal (both harnesses) and `toolkit-dev` (the Apptension company marketplace, 7 entries, three harnesses). `estimation-pipeline-v2` has a Claude manifest with no remote. Cezarion ships npm packages, not a plugin. The rest carry only project `.claude/skills`. | read in files (read only) |
| 4 | Squeal's release step | A release is a `squeal--v<version>` tag on a reviewed `main` commit plus the hub's pin move. The `version` must differ between releases: Claude Code does not update on a moved pin with the same version, and Codex silently replaces the content. Keep the per-landing bump and `check:version`: they no longer ship, but they keep two builds from sharing a version. | verified by experiment; inferred for the bump |
| 5 | Migration | The id becomes `squeal@<hub>`. Squeal hard-codes `squeal@squeal`, and Codex keys hook trust by it, so one Squeal release must change the id first. Then on each machine: add the hub, install, remove the old marketplace, and trust the Codex hooks once. A Claude Code session in flight survives; a Codex one loses its plugin directory. | verified by experiment; read in source code |

## Findings

### 1. Claude Code (verified by experiment, 2.1.295; read in official docs)

- Plugin sources with a pin: `github` `{repo, ref, sha}`, `url` `{url, ref, sha}`, `git-subdir` `{url, path, ref, sha}`. "When you set both `ref` and `sha`, Claude Code checks out `sha`" (marketplace-reference, Plugin sources). Squeal's plugin is a subdirectory, so `git-subdir`. A hub entry pinned to `tool--v0.1.0` and its sha installed 0.1.0 with content `a` while the tool's `main` was at 0.1.2. `installed_plugins.json` recorded `gitCommitSha`.
- Version: "The `version` field in the plugin's manifest comes first", and the cache directory is `cache/<marketplace>/<plugin>/<version>/` (loading reference). The probe moved the pin to 0.1.1. `claude plugin update` alone printed `already at the latest version (0.1.0)`. After `claude plugin marketplace update probe-hub` it printed `updated from 0.1.0 to 0.1.1 ... Restart to apply changes.`
- A pin moved to new content with the same `version` (0.1.1): no update, and the content stayed `b`. Docs: "a ref that moves without a version change leaves users on the cached copy" (host-marketplace).
- The tool's `main` moving to 0.1.3 changed nothing while the hub stayed put.
- Running sessions: auto-update is "off for every other marketplace" by default. On this machine the user turned it on for `squeal` (`autoUpdate: true` in `known_marketplaces.json`). When on, it runs after a random delay of up to ten minutes. "The running session keeps the versions it loaded"; hooks keep the previous path until `/reload-plugins` (loading reference). The old version directory got `.orphaned_at` in the probe; docs: removed "14 days later, so a session that already loaded the old version keeps running".
- `claude plugin tag plugins/claude-code --dry-run` in this repository plans `squeal--v0.1.60` and checks that `plugin.json` and the marketplace entry agree. It refuses a tag that exists (probe: `Tag "tool--v0.1.1" already exists locally`).

### 2. Codex (verified by experiment, 0.160.1; read in source code at `rust-v0.160.1` `d27764b`)

- Entry sources (`core-plugins/src/marketplace.rs:1037-1068`): a path string, `local`, `url` `{url, path?, ref, sha}`, `git-subdir` `{url, path, ref, sha}`, `npm`. There is no `github` type: such an entry is "skipping marketplace plugin with unsupported source" (`:590-616`). Accepted URLs are `http(s)`, `file://`, absolute paths, `ssh://`, `git@` and `owner/repo` shorthand (`:747-782`). A Git source is fetched with `--filter=blob:none`, then checks out `sha`, else `ref` (`loader.rs:1838-1876`). So one entry shape, `git-subdir` with an https URL, is valid in both harnesses.
- Pinned install worked: `codex plugin list` shows `ref tool--v0.1.0, sha ...`, and the cache was `cache/probe-hub/tool/0.1.0`. A moved pin is not seen by `plugin list`. After `codex plugin marketplace upgrade probe-hub` the cache holds `0.1.1` only, and `0.1.0` is gone. When the tool's `main` moved, the result was `Marketplace probe-hub is already up to date`.
- Automatic path: at each session start a `plugins-marketplace-auto-upgrade` thread upgrades every configured Git marketplace and force-reinstalls the installed plugins of the upgraded ones (`manager.rs:2812-2886`, `:2961-3010`). This was not run in a live session, because the scratch home has no credentials. It matches the 0.1.56 to 0.1.59 replacements in `004-slow-suites/lessons.md` defect 4.
- Version and deletion: the version comes from `plugin.json` (`store.rs:425`). Install replaces the plugin's whole base directory atomically (`store.rs:304-340`), so older versions are deleted at once. `codex plugin remove` also left `cache/tool/` empty.
- With the same version and new content, Codex reinstalled into the same `0.1.1` directory with content `e`, where Claude Code kept `b`. The harnesses diverge here. A distinct `version` per release makes them agree.
- Copy-holding hub: not needed. It would cost a release script and a hub that grows by every release's bundles, and would only save one partial clone of the tool repository.

### 3. The human's other tools (read only, `/home/agent/projects/*`, 2026-10-09)

| Repository | Publishes | To be listed in a hub |
|---|---|---|
| `squeal` (`hearsay-tools/squeal`) | `.claude-plugin/marketplace.json` and `.agents/plugins/marketplace.json`, one entry each (`./plugins/claude-code`, `./plugins/codex`), 0.1.60, no tags | a release tag per release; two `git-subdir` entries |
| `toolkit-dev` (`apptension/toolkit-dev`) | marketplace `apptension-dev`: 6 local plugins with `.claude-plugin`, `.codex-plugin` and `.cursor-plugin` manifests, each versioned on its own (for example `apptension-sdlc` 0.24.11), plus `superpowers` as a `url` source; one tag in total (`project-ops/v1.0.0`) | per-plugin tags (`<name>--v<version>`) and one entry per plugin per harness. It is installed today from `apptension-dev` with auto-update, so listing it again would install each skill twice |
| `estimation-pipeline-v2` | `plugin/.claude-plugin/plugin.json` (`estimation-pipeline` 0.2.0); no marketplace, no remote, no Codex manifest | a remote, a tag, a Claude-only `git-subdir` entry at `plugin` |
| `cezar` (`hearsay-tools/cezarion`) | npm packages (`@wjarka/cezarion` 0.16.0, `v*` tags, `release.yml`); no plugin | nothing until it ships a plugin |
| `earwitness`, `prime`, `mvp-unveiled-july26`, `test-repo`, others | project `.claude/skills` only, or nothing | nothing |

### 4. Squeal's release step

- What ships is the hub's pin, not `main`. A landing on `main` reaches no installed plugin until a release moves the pin. *verified by experiment*
- `version`: both plugin manifests already carry `package.json`'s version (`src/harness/build.ts` `writePluginVersions`). It must differ from the previous release's (finding 1). Do not set `version` in hub entries; `plugin.json` wins, and `claude plugin validate` warns about the mismatch (docs).
- The per-landing bump and `check:version` no longer ship anything, but keep them. The version is in every environment hash (`src/core/keys/environment.ts:56`) and decides daemon step-down (`isNewerVersion`, `src/core/daemon/version.ts`). Without the bump, every `main` build between two releases would report the last release's version with different code. Such builds would share keys in one store, and step-down could not order them. The cost is that release numbers skip (0.1.60, then perhaps 0.1.67). *inferred*
- `plugins/*/dist` stays committed: the hub pins a commit, and the plugin directory at that commit must hold the bundles. The CI drift check is unchanged.

### 5. Migration (verified by experiment; read in source code)

- The plugin id is `<entry>@<marketplace name>`, so a hub named `hearsay` makes it `squeal@hearsay`. Squeal hard-codes `squeal@squeal`: `src/cli/init.ts:15` (`squeal init` writes the `squeal` marketplace and `squeal@squeal: true` into project settings), `src/cli/codex/init.ts:19` `CODEX_PLUGIN_ID`, `src/cli/codex/hash.ts:16` `PLUGIN_KEY_SOURCE`, `src/cli/remove.ts:122`, both plugin READMEs and their tests. Claude Code's `renames` maps names within one marketplace only (host-marketplace), so nothing moves the id automatically.
- Codex trust is keyed `squeal@squeal:hooks/hooks.json:<event>:<group>:<handler>` (`002 research/wave-0-checks.md` 3). The real `~/.codex/config.toml` holds 9 such keys. Under the new id each hook is untrusted once. The hashes do not change.
- In flight: when a marketplace was removed, Claude Code uninstalled its plugin and left the cache with `.orphaned_at`, so a running session keeps its hooks for 14 days. Codex `plugin remove` deleted the cache at once (probe). A Codex session running at that moment, and any Squeal daemon started from that path, lose their files.

## Recommendation for Squeal

**Hub layout.** One private repository, for example `hearsay-tools/marketplace`, with marketplace name `hearsay` in both files (the names are the human's call). `.claude-plugin/marketplace.json` lists the Claude Code entries; `.agents/plugins/marketplace.json` lists the Codex entries. Codex reads the `.agents` file first and Claude Code reads only its own. Each entry has the same shape:

```json
{ "name": "squeal", "description": "...",
  "source": { "source": "git-subdir", "url": "https://github.com/hearsay-tools/squeal.git",
              "path": "plugins/claude-code", "ref": "squeal--v0.1.61", "sha": "<40-char commit of the tag>" } }
```

The Codex file uses `path: "plugins/codex"`. Do not use `github` (Codex skips it) or `version`. Leave `toolkit-dev` out: it is the company's marketplace with its own release flow. Add `estimation-pipeline` when it has a remote.

**Release checklist (coordinator, after a wave review passes):**
1. Choose the reviewed `main` commit; `npm run build` shows no drift and `check:version` passed when it landed.
2. `claude plugin tag plugins/claude-code --push` creates `squeal--v<version>`, after checking `plugin.json` against the marketplace entry.
3. In the hub, set both Squeal entries' `ref` to the tag and `sha` to `git rev-list -n1 <tag>`. Run `claude plugin validate .` and commit `squeal 0.1.N`. Push.
4. On this machine: `claude plugin marketplace update hearsay && claude plugin update squeal@hearsay`, and `codex plugin marketplace upgrade hearsay` with no Codex session running.

**`docs/process.md`.** In step 5 (Wave), keep the bump rule but change its reason. It reads "so installed plugins update"; it should say the bump keeps builds apart in the environment hash and in step-down. Add a Release step after the wave review with the checklist above, and say that landing on `main` ships nothing.

**Environment hash.** Keep the Squeal version in it. Installed daemons then change version only at releases, so the re-keying from defect 4 happens once per release instead of several times an hour.

**Migration order.** First one Squeal row: the id becomes a constant derived from the hub name, used in init, Codex trust, remove, READMEs and tests. Release it through the hub. Then on each machine:
- Claude Code: `claude plugin marketplace add hearsay-tools/marketplace`, `claude plugin install squeal@hearsay`, `claude plugin marketplace remove squeal`, then turn on auto-update for `hearsay` in `/plugin`.
- Codex, with no session running: `codex plugin remove squeal@squeal`, `codex plugin marketplace remove squeal`, `codex plugin marketplace add hearsay-tools/marketplace`, `codex plugin add squeal@hearsay`, `squeal init --harness codex --trust`.
- In each repository that ran `squeal init`, run it again. No committed `.claude/settings.json` under `/home/agent/projects` names `squeal@squeal` today.

## Open questions

1. The hub repository's name and marketplace name are the human's to choose. The marketplace name becomes part of every plugin id.
2. Codex deletes the previous version's directory at each release, so a Codex session or Squeal daemon running at that moment still breaks (defect 4, once per release). Releasing between Codex sessions avoids it. A Squeal fix, a daemon and primer path that survive a replaced cache, would be a later row.
3. Not verified against github.com or in a live interactive session: the scratch home holds no credentials. That leaves Claude Code's auto-update timing, `/reload-plugins`, and Codex's start-of-session upgrade read only.
4. Whether `claude plugin update` ever refreshes the marketplace itself is not determined. The docs say nothing for `update`, and in the probe it did not.
5. Whether Codex's start-of-session marketplace upgrade can be turned off is not determined. No setting was found in the files read.

## Sources

- Claude Code docs, fetched 2026-10-09: https://code.claude.com/docs/en/plugin-marketplaces, https://code.claude.com/docs/en/plugins/marketplace-reference (Plugin sources, `ref`/`sha`), https://code.claude.com/docs/en/plugins/host-marketplace (Keep users up to date, Release channels, renames), https://code.claude.com/docs/en/plugins/loading (version computation, auto-update, cleanup of previous versions), https://code.claude.com/docs/en/plugins/cli-reference (`plugin update`, `plugin tag`, `marketplace remove`).
- Codex source, https://github.com/openai/codex tag `rust-v0.160.1` (`d27764b`): `codex-rs/core-plugins/src/marketplace.rs`, `loader.rs`, `store.rs`, `manager.rs`, `marketplace_upgrade.rs`.
- CLIs: `claude` 2.1.295, `codex-cli` 0.160.1, `--help` of each plugin subcommand.
- This repository: `scripts/check-version-bump.ts`, `src/core/keys/environment.ts`, `src/core/daemon/version.ts`, `src/harness/build.ts`, `src/cli/init.ts`, `src/cli/codex/{init,hash}.ts`, `docs/process.md` step 5, `docs/specifications/002-codex-adapter/research/wave-0-checks.md`, `docs/specifications/004-slow-suites/lessons.md`.
- Read only: `/home/agent/projects/*` manifests, `~/.claude/plugins/{known_marketplaces,installed_plugins}.json`, the `[marketplaces]`, `[plugins]` and `hooks.state` keys of `~/.codex/config.toml`.
- Probes: `probes/release-hub/run.sh`, `git-http.mjs`, `run.log`.
