# 018-30 notes: the daemon runs on the project's pinned Node (D18)

## Seam map

- One spawn of the daemon exists: `ensureDaemonProcess` in `src/core/daemon/ensure.ts`. Every start path reaches it: `src/cli/start.ts` (`squeal start` and its successor after a step-down, through `ensureDaemon`), `src/harness/shared/ensure.ts` (every hook, and the successor that claims a handoff), `src/harness/codex/kept.ts` (Codex's first hooks, through the copy of the CLI). No other file spawns `daemon`. None of the files of spec 021 (`daemon.ts`, `lifecycle.ts`, `src/cli/{start,runner-host}.ts`) needed a change.
- `pinnedNode(root, env = process.env)` in `src/core/node-pin.ts` decides. `ensure.ts` calls it only on a spawn, after the probe found no daemon, so a hook whose daemon answers pays nothing.
- The `node` key: type and default in `src/core/types/policy.ts`, the leaf in `src/core/daemon/policy-node.ts` (spread into the loader's shape). `node-pin.ts` reads that one key with `loadConfigFile` and the same leaf, so a hook does not load the whole policy loader.

## Decisions the spec did not settle

- Key values: `"project"` (default) and `"session"`. D18 names only `"session"`.
- Reason `too-old`: an exact pin below Squeal's minimum Node (`engines.node`, 22.19) is not used, since the daemon could not start on it (no `node:sqlite`). Agreed with the coordinator (2026-11-11): order of checks session, none, range, too-old, then the lookup (missing). The floor comes from `meetsMinimum` in `src/harness/opencode/host.ts`, its one source (011-86); a build that cannot read its floor takes any version.
- The session's own Node at the pinned version is the answer without a lookup; its directory still goes first in `PATH`.
- Pin reading: `.node-version` before `.nvmrc`; the first line with a value after its `#` comment is the pin; an empty file or one with only comments is no pin. Exact means `x.y.z` with or without `v`; anything else is a range or alias and is not resolved.
- Version-manager installs are checked by running `<binary> --version` once per process and file (path, inode, size, mtime). A `node` on `PATH` may be a shim (volta, asdf, mise) that picks its version by its working directory and its tool by argv0. The daemon's spawn sets argv0 to its label and runs from the store directory, so it must not run a shim. A `PATH` candidate is therefore asked from the worktree root with `-p process.version + "\n" + process.execPath`, and the daemon runs the binary the candidate reports. The session's own Node on `PATH` is skipped without a run.
- When no pin is used, the spawn has no `env` option, as before. When a pin is used, `env` is `process.env` with the pinned directory first in `PATH`.
- `test/node-pin/` is in `test/version-sensitive.txt`: one test reads `process.versions.node`.

## Found on Node 26

- From Node 26, a child spawned without `env` does not see a replaced `process.env` object, only keys set on it (probe: `process.env = {...}` then `spawnSync`: v24.22.1 sees the new PATH, v26.13.0 sees the real one). `test/node-pin/spawn.test.ts` sets keys in place. `test/daemon/step-down-helpers.ts` replaces `process.env` and says "The spawn inherits `process.env`"; on Node 26 that spawn gets the test runner's environment.
- Node 26 names its main thread `node-MainThread` (Node 24: `MainThread`). `NODE_COMMS` in `src/core/ps/reads.ts` lacks it, so `squeal ps` (`discover.ts:41`, `flags-processes.ts:77`) skips every Squeal process on Node 26. `test/harness/ensure-label.test.ts` fails 2 of 3 on Node 26 with the base commit's `ensure.ts` as well; it passes on Node 24. CI runs Node 22 and 24 only. D18 moves cezar's daemons to the pinned 26.13.0, so this matters now. Fixed in this row on the coordinator's answer (2026-11-11): `NODE_COMMS` holds `node-MainThread`; `test/ps/discover.test.ts` holds a Node 26 main thread, so CI on Node 22 and 24 checks it too.

## Not done here

- The policy reference (`plugins/*/skills/squeal/references/policy.md`, four copies a test keeps equal) does not list `node`; it does not list `shared.ref` either.
- Bundles (`plugins/*/dist`) are not rebuilt (brief: no build). The bundle-equality tests fail until the coordinator rebuilds.
- A running daemon does not move to the pinned Node when the pin or the config changes; the next start reads them.
