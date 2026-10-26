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

Once per machine, with Node 22.19 or later and any of Claude Code, Codex and Pi on the `PATH`:

```sh
curl -fsSL https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh | sh
```

That is the `install.sh` of the latest release. Or download it, read it, then run it:

```sh
curl -fsSLO https://github.com/hearsay-tools/squeal/releases/latest/download/install.sh
less install.sh
sh install.sh
```

To use one release's script instead, replace `latest/download` with `download/squeal--v<version>`. The script installs the plugin the hub pins, which is the latest release either way, and in Pi the release the script belongs to.

For each of `claude` and `codex` on the `PATH`, `install.sh` adds the hub marketplace and installs `squeal@hearsay` at user scope through that harness's own CLI (`claude plugin marketplace add hearsay-tools/marketplace`, `claude plugin install squeal@hearsay`; `codex plugin marketplace add hearsay-tools/marketplace`, `codex plugin add squeal@hearsay`). It writes nothing under `~/.claude` or `~/.codex` itself. Then it copies the plugin's launcher to `~/.local/bin/squeal` (`SQUEAL_BIN_DIR` overrides) and says how to put that directory on the `PATH` when it is not. With `pi` on the `PATH` it downloads the release tag's source archive (`https://github.com/hearsay-tools/squeal/archive/refs/tags/squeal--v<version>.tar.gz`, about 10 MB) with `curl`, unpacks its `plugins/pi/` into `~/.local/share/squeal/pi/<version>/` (`XDG_DATA_HOME` moves it), and runs `pi install` on that directory, which writes Pi's own settings; it writes nothing under `~/.pi` itself. With only Pi, the launcher comes from that directory. It prints each command before running it, asks nothing and needs no sudo. A second run changes nothing. The hub `hearsay-tools/marketplace` is private for now: the marketplace step needs your access to it and git credentials for GitHub (`gh auth login`, or an SSH key), and when it fails the script says so. The Pi step needs no hub: the repository is public.

Then, in each repository: `squeal setup`. `squeal update` updates Squeal in every harness that has it to one version; Codex also upgrades it at each session start, and Claude Code only through this or `claude plugin update`. In Pi, which has no update for a local package, it downloads the latest release's `install.sh` and runs `sh install.sh --pi`, which installs that release's directory and `pi remove`s the older ones. It keeps the files of the one before, and of any older one a running process still uses, such as the daemon of a session still open, so a Pi session open across the update keeps working on the version it loaded; `/reload` in that session loads the new one. The next update deletes what is no longer kept. The launcher finds the installed plugin at each call, so it needs no update of its own. `sh install.sh --uninstall`, or `curl … | sh -s -- --uninstall`, removes the launcher, the plugins and the Pi package that `install.sh` itself created, which it records in `~/.local/state/squeal/installed`; a plugin or launcher that was there before stays, and it prints the command that removes it. The `hearsay` marketplace stays added.

Installing the plugin from inside a harness instead: [plugins/claude-code/README.md](plugins/claude-code/README.md), [plugins/codex/README.md](plugins/codex/README.md) and [plugins/pi/README.md](plugins/pi/README.md).

## Removing a worktree

Each worktree has a daemon of its own, which runs that worktree's tests in the background. Before deleting a worktree, run `squeal stop <worktree>`: it cancels the tests in flight, stops the daemon and every process it started, and returns once none of them is left, so nothing of Squeal's holds the directory. It exits 0 then, and 1 when something still runs past its bound, naming what. `git worktree remove` succeeds without it; a tool that refuses to remove a directory a live process holds needs it first. A hook starts the daemon again at the next edit; `squeal stop --until-start` keeps it stopped through edits and Git operations until `squeal start`.

## Slow tests

Slow test files (`slow.include` in `squeal.config.json`, or `"slow": true` on a `nodeTest` or `pytest` project) run in a tier of their own, after the fast ones: once the latest edit's fast tests are done and no edit has come for `slow.quietMs` (default 3000), whether or not the agent is mid-turn, so a slow result reaches the agent with its next tool call; or on `squeal run --slow`. With `"slow": { "trigger": "idle" }` they run only when the agent pauses. They are keyed, run and inherited by another worktree as any test file is. The `Slow tier:` line in `squeal status` says how many there are and which are current, pending, running or not run.

## Tests Squeal does not cover

Squeal covers no test of a build output it does not produce, such as an end-to-end suite that spawns a bundle your build writes: it cannot know when that output is current. Leave those tests out, and run them yourself or in CI:

```json
{
  "vitest": { "exclude": ["test/e2e/**"] }
}
```

`vitest.exclude` lists globs, relative to the worktree root, of Vitest test files Squeal never lists, runs, keys or counts. `squeal status`, `squeal setup --check` and the session's first message name them as not covered. For a node:test or pytest project, its entry's own `exclude` does the same.
