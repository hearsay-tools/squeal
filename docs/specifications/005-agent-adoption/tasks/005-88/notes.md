# 005-88 notes: owned Node processes show the project first

Worker notes, 2026-10-27. Brief W1 in `tasks/wave-12.md` (baseline `6403074e4`); spec 005 D3, "Project-first process commands"; evidence `research/project-process-prefix.md`.

## What changed

| File | Change |
| --- | --- |
| `src/core/process-label.ts` (new) | The labels and the Linux argv0 option. `worktreeLabel(role, root, commonDir, id)` gives `squeal <project> <role> @<id8>`. `storeCheckLabel(commonDir)` gives `squeal <project> check`. `projectComponent` makes a project name safe to print. `argv0For(label)` returns the label on Linux, else `undefined`. `displayId(root)` returns `worktreeIdFor(root)`, or `null`. `ownNodeArgv0(...)` is the node:test leader's guard. |
| `src/core/daemon/ensure.ts` | The daemon spawn adds `argv0: argv0For(worktreeLabel("daemon", root, commonDir, displayId(root)))`. The executable, cwd, detached flag and `[cli, "daemon", root, ...lockWait]` do not change. |
| `src/core/daemon/full-check.ts` | `runFullCheck(database, label?)` sets argv0 from `label`. `FullCheckOwner` passes `storeCheckLabel(commonDir)` to `run`. |
| `src/runners/process/group.ts` | `GroupProcessOptions.argv0` is optional, and spawn receives it unchanged. When it is absent (pytest passes none), Node uses the command as argv0, as before. |
| `src/runners/node-test/run/run.ts` | The leader calls `ownNodeArgv0("node-test", options.root, node, cwd, env)` once per tier and passes the result to `startGroup`. |
| `test/keys/validity/cases/adapter/node-test.ts` | One new case: a worktree whose git metadata cannot be read runs and stores the same as the last release (see "Key-format guard"). Ownership extended by the coordinator, 2026-10-27. |

Example labels: `squeal project-with-spaces daemon @3f9c1a2b`, `squeal squeal node-test @528303f7`, `squeal squeal check`, and `squeal store check` for a store whose common dir is not `<project>/.git`.

## Decisions the spec did not settle, and the choice taken

1. **The node:test leader's shim guard** (coordinator decision A, 2026-10-27). Volta (`crates/volta-core/src/run/mod.rs`, `get_tool_name` reads arg0's file name) and mise (`MISE_BIN_NAME = filename(ARGV0)`) choose their tool from argv0. These are read in source code. With a label as argv0, a Volta or mise user's node:test tier would not start. The guard sets the label only when the command resolves to the same real path as `process.execPath`. It resolves a command that contains `/` against the child's cwd; otherwise it takes the first executable file on the child's `PATH` (`/usr/bin:/bin` when `PATH` is unset), as libuv does. The daemon and the integrity check spawn `process.execPath`, which is the real Node, so they need no guard. A hard link or a copy of Node is "another file", so it keeps argv0.
2. **A failed resolution keeps argv0** (coordinator, 2026-10-27). All of the resolution is inside one `try`. Any throw keeps the command as argv0: a PATH directory it cannot search (EACCES), a symlink loop, unreadable git metadata, or a file removed between two reads. A root that does not exist omits only the suffix (`existsSync(root)`). A race on that check throws, so it also keeps argv0. In an earlier version I removed the catch to satisfy the key-format alarm. The coordinator rejected that, and the catch is restored. The new validity case runs it.
3. **Trimming.** "Edge separators" is taken to mean hyphens. After the 32-character cut, hyphens at the end are removed again, so a cut never ends in `-`. `.` and `_` are kept at the edges.
4. **The node:test common dir** comes from `resolveCommonDir(root)`. It reads files only and runs no git subprocess. The runner has no resolved common dir of its own.
5. **The integrity check's label** is computed where `commonDir` is known (`FullCheckOwner`). It is not derived from the database path.
6. **Other platforms**: `argv0For` returns `undefined`. Node then uses the command as argv0, as before.

## Type changes (all additive)

- `GroupProcessOptions.argv0?: string | undefined`.
- `runFullCheck(database, label?: string)`.
- `FullCheckContext.run?: (database: AbsolutePath, label: string) => FullCheck`. Existing fakes with fewer parameters still type-check.
- New module `src/core/process-label.ts`: `WorktreeRole`, `PROJECT_MAX`, `argv0For`, `worktreeLabel`, `storeCheckLabel`, `displayId`, `projectComponent`, `ownNodeArgv0`.

## What a process can observe (011 C11 Fidelity)

D3 names this as the contract. These probes are throwaway scripts outside the repository, run on Node 22.19.0 and 24.21.0 (verified by experiment):

- **The daemon and its threads.** For a Node spawned with a label as argv0, `process.argv0` and the initial `process.title` read the label in the main thread and in every worker thread. Vitest's threads pool, its config and its globalSetup run in the daemon process, so a test there sees the label. `spawn(process.argv0)` then fails with `ENOENT`. Before this change, the daemon's argv0 was the absolute `process.execPath`, so such a call worked. `process.argv` and `process.execPath` keep Node's meaning (`test/harness/ensure-label.test.ts`).
- **The node:test leader.** With `--test-isolation=none` (Node 22: `--experimental-test-isolation=none`), tests run in the leader. A test then sees `process.argv0` and `process.title` as the label. With process isolation, the test child sees Node's path: Node spawns it from `process.execPath` (`test/runners/node-test/run-label.test.ts`, "not its test child").
- **Not reached.** Vitest forks (research 005-87 [E]), node:test children, pytest and Python, hooks, launchers, OpenCode bridges, and grandchildren of runners.
- **Not claimed.** I do not claim that code which runs `process.argv0` as an executable is unaffected in the daemon or in an isolation-none leader. It is affected, as described above.

## Key-format guard

esbuild bundles of `test/keys/validity/entries/*.ts` (metafile inputs, this checkout):

| Component | Changed files it holds |
| --- | --- |
| node:test | `src/core/process-label.ts` (only the functions run.ts reaches), `src/runners/process/group.ts`, `src/runners/node-test/run/run.ts` |
| pytest | `src/runners/process/group.ts` |
| global, vitest, recorder | none |

- Every changed bundle line maps to a source line that a case runs. The existing node:test cases use `node: process.execPath` and roots without `.git`, so they run the guard's success path.
- V8 marks a catch block that never runs, including its `catch` keyword and its closing brace, with count 0 (checked on a minimal script). The new case "a worktree whose git metadata cannot be read runs and stores alike (row 005-88)" runs the guard's catch. Its `.git` file names a git dir whose `commondir` is a directory, so `resolveCommonDir` throws EISDIR. I ran the harness directly at this checkout: the guard returned no label, and the run stored `pass`. The release's code reads no git layout there, so both sides should store the same.
- In pytest, the only changed line is `argv0: options.argv0,` in `startGroup`. Every pytest case's run executes it.
- I expect no version raise. Outputs should match the last release (`squeal--v0.1.366`). The actual `test/keys/key-format.test.ts` result is in the worker's final report.

## Checks

- `test/core/process-label.test.ts`: labels, layouts (main, linked, separate git dir, submodule, none), long and hostile names, platforms, and the guard (own Node by path, on PATH, relative; script shim; first executable on PATH; missing; unsearchable directory; missing root).
- `test/harness/ensure-label.test.ts`: real children spawned through `ensureDaemonProcess` for a main root with spaces and a linked worktree. Checks argv, `/proc/<pid>/cmdline`, `/proc/<pid>/exe`, `execArgv`, `--await-lock`, and the actual `discover()`. Also checks that the actual `keepVersion()` keeps an active 0.1.1 copy older than 24 h across 0.1.2 and 0.1.3, and prunes it at 0.1.4 after the daemon exits.
- `test/daemon/full-check-label.test.ts`: the label from `startFullCheck`. A real check finds a fault, passes a sound store, and leaves argv0 as Node's path without a label. A Node that is missing gives `unrun`.
- `test/runners/node-test/run-label.test.ts`: real runs. Covers the leader label by path and on PATH, a hard-linked Node, unreadable git metadata, and an unsearchable PATH directory before a valid Node. Results pass in every case.
- `test/runners/process/group-argv0.test.ts`: the default argv0 is the command; an explicit one is used; arguments stay separate.

## Remaining limits and next steps

- The bundles are not rebuilt (that is the coordinator's job). `test/harness/opencode/package.test.ts` fails with "cli/squeal.mjs differs from the build" until the build runs. Other dist-drift checks may also fail until then.
- btop's normal Command view shows the prefix (research [UI]). Name/comm, narrow tree views and monitors that hide argv0 do not.
- A daemon started directly with `squeal daemon` from a terminal launcher does not go through `ensureDaemonProcess`, so it has no label.
