# Squeal

> That's what tests said.

Continuous validation layer for coding agents. Squeal watches the workspace, runs the smallest useful set of checks in the background, and tells the agent only when a check changes state. Push transitions, pull state.

Part of the Hearsay product family.

- Vision: [docs/vision.md](docs/vision.md)
- Process: [docs/process.md](docs/process.md)
- Styleguide: [docs/styleguide.md](docs/styleguide.md)
- Board: [docs/board.md](docs/board.md)
- Specifications: [docs/specifications/](docs/specifications/)
- Decisions: [docs/decisions/](docs/decisions/)

Status: spec 001 (core loop, Vitest, Claude Code) shipped 2026-10-06; see [docs/board.md](docs/board.md) for what is next.

## Install

Once per machine, with Node 22.13 or later and Claude Code, Codex or both on the `PATH`. `<version>` is a release; its tag is `squeal--v<version>`, so what you read is what runs:

```sh
curl -fsSL https://raw.githubusercontent.com/hearsay-tools/squeal/squeal--v<version>/install.sh | sh
```

Or download it, read it, then run it:

```sh
curl -fsSLO https://raw.githubusercontent.com/hearsay-tools/squeal/squeal--v<version>/install.sh
less install.sh
sh install.sh
```

For each of `claude` and `codex` on the `PATH`, `install.sh` adds the hub marketplace and installs `squeal@hearsay` at user scope through that harness's own CLI (`claude plugin marketplace add hearsay-tools/marketplace`, `claude plugin install squeal@hearsay`; `codex plugin marketplace add hearsay-tools/marketplace`, `codex plugin add squeal@hearsay`). It writes nothing under `~/.claude` or `~/.codex` itself. Then it copies the plugin's launcher to `~/.local/bin/squeal` (`SQUEAL_BIN_DIR` overrides) and says how to put that directory on the `PATH` when it is not. It prints each command before running it, asks nothing and needs no sudo. A second run changes nothing. The hub `hearsay-tools/marketplace` is private for now: the marketplace step needs your access to it and git credentials for GitHub (`gh auth login`, or an SSH key), and when it fails the script says so.

Then, in each repository: `squeal setup`. `squeal update` updates the plugin in every harness that has it to one version; Codex also upgrades it at each session start, and Claude Code only through this or `claude plugin update`. The launcher finds the installed plugin at each call, so it needs no update of its own. `sh install.sh --uninstall`, or `curl … | sh -s -- --uninstall`, removes the launcher and the plugins that `install.sh` itself created, which it records in `~/.local/state/squeal/installed`; a plugin or launcher that was there before stays, and it prints the command that removes it. The `hearsay` marketplace stays added.

Installing the plugin from inside a harness instead: [plugins/claude-code/README.md](plugins/claude-code/README.md) and [plugins/codex/README.md](plugins/codex/README.md).
