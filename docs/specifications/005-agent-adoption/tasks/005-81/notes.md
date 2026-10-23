# 005-81 notes: a Codex hook other than SessionStart spawns its daemon from the kept copy

Worker notes, 2026-10-23. Brief W1 in `011-core/tasks/wave-18.md`; spec 005 D3 as amended 2026-10-21 and 2026-10-22; `tasks/005-77/notes.md`, "Open after this row".

## What changed

- `src/harness/codex/kept.ts`: `keepOnSpawn(deps)`. Before this version's copy exists, with `PLUGIN_ROOT` and `PLUGIN_DATA` set, it returns `deps` whose `ensureDaemon` probes the daemon as `ensureDaemon` does. When the probe finds no daemon, it keeps the copy (`keepVersion`, the same call SessionStart makes, which also writes `<data>/bin/squeal` and prunes) and spawns from the copy's CLI. A daemon that answers gives `alive`, one that holds the socket and does not answer gives `unavailable`; neither copies anything. A successor after a handoff (`awaitLockMs`, row 011-32) spawns with no probe, so it keeps the copy first. Once a copy exists, or without either variable, `deps` come back as they are.
- `keepCodexVersion` and `keepOnSpawn` share one private `keepCodexCli`. `keepCodexVersion` does the same as before.
- `src/harness/codex/main.ts`: `runMain` passes `keepOnSpawn(deps)` to every hook but `session-start`. SessionStart keeps the copy itself before it ensures the daemon, so its path is the code of 005-73.

## Decisions the brief did not settle

- The seam is the hook's `ensureDaemon`, not `src/harness/shared/ensure.ts` or `daemonCliEntry`, which are not this row's. Every spawn of a Codex hook goes through `deps.ensureDaemon`: `ensure`, `ensureIfStale` and `successor` in `ensure.ts`. So one wrapper covers PostToolUse, Stop, UserPromptSubmit, SubagentStart and a successor after a handoff.
- The wrapper probes once itself, and `ensureDaemon` probes again before it spawns. The second probe runs only on the spawn path, and only before a copy exists. A missing socket answers at once with `ENOENT` or `ECONNREFUSED`. The other way, reading `options.cli` lazily inside `ensureDaemon`, would rest on the order of reads inside `src/core/`.
- The copy follows `PLUGIN_ROOT` and `PLUGIN_DATA`, as SessionStart's does, not `keptCacheCli`'s path rule. A hook a launcher declares has neither variable and spawns from the cache as before, as 005-77 kept it.
- No `usesSqueal` check: every spawn path of these hooks opens the store first (`withContext`), or checks `usesSqueal` (`startSession`), so the repository uses Squeal.
- The hook that makes the copy still names the cache's CLI in its own text, since `deps.command` is read before the spawn. Its next hook finds the copy and names the launcher. SubagentStart reads its skill line after the spawn, so it names the copy at once.
- `SQUEAL_CLI` still overrides the daemon's CLI in `daemonCliEntry`. The copy is then made, though not used. Only tests set it.
- Cost: the copy is `dist/` (6.1 MB) and `skills/` (60 kB). With a warm page cache it took 5 ms here at load 11, once per version.

## D3

One sentence of D3 changes. The amended text reads: "a Codex hook other than SessionStart that runs before its version's copy exists still spawns from the cache." Proposed: "A Codex hook other than SessionStart that runs before its version's copy exists keeps the copy when it spawns the daemon, and spawns it from the copy (amended 2026-10-23, row 005-81); a hook that spawns nothing copies nothing." A hook a launcher declares, with no `PLUGIN_DATA`, still spawns from the cache. 005's `status.md` line of 2026-10-22 (005-77) names the same gap as open. The spec text and `status.md` are the coordinator's.

## Tests

- `test/harness/codex/version-copies-hook.test.ts`: builds the Codex plugin at A into a scratch cache. In a git repository whose store no daemon has served, it runs the bundled `post-tool-use` hook, then in a second test `stop`, with `PLUGIN_ROOT` and `PLUGIN_DATA` and no SessionStart. It reads the daemon's arguments from `ps`: `<data>/versions/A/dist/cli/squeal.mjs daemon <root>`. Then it removes A's cache directory, and the same daemon reaches `ready`. Both failed before the change: the daemon named the cache's CLI. A third test runs both hooks beside a socket that holds the daemon's place, and no data directory is made.
- `test/harness/codex/kept.test.ts`, `keepOnSpawn`: no daemon, so the copy is kept and the spawn names it; a daemon that answers (`alive`) or does not (`unavailable`), so nothing is spawned or copied; a successor spawns from the copy beside a live socket; a version that is no plain release spawns from the cache; `deps` unchanged without `PLUGIN_ROOT` or `PLUGIN_DATA`, or once the copy exists.
- Unchanged: `version-copies.test.ts` (005-73, SessionStart and "copies nothing, at a hook before any SessionStart", whose daemon a live socket stands in for) and `version-copies-start.test.ts` (005-77, `squeal start`).

## Open after this row

- The bundles are not rebuilt here, so `plugins/codex/dist` drifts until the coordinator's build. `test/harness/codex/plugin.test.ts`, "has the bundles exactly as `npm run build:plugin` produces them", fails until then.
