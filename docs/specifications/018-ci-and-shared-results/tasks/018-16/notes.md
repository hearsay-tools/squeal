# 018-16 notes: `squeal ci record`

Worker e257a740, 2026-11-09. Spec 018 D8. Commits `27604b9f0` (command and format), `faf79d1e4` (tests).

## How it attaches to an unchanged command

Vitest reads no reporter from the environment, and a CLI `--reporter` replaces the config's reporters (Vitest 5.0.3 `resolveConfig`, "When CLI reporters are specified"). So the command is not changed. Instead:

1. `squeal ci record` (`src/cli/ci.ts`) spawns the command with `NODE_OPTIONS` holding the recorder (`recorder.cjs`, as the daemon's workers get it, `observeEnv`) and a hook, `src/runners/observe/vitest-ci.cjs`.
2. The hook acts only in a process whose main script is the `bin` of the `vitest` package, on the main thread. It `require`s the project's `vitest/node` (an ES module without top-level await; `require(esm)` is synchronous on Node 22.12 and later, Squeal needs 22.19) and wraps `Logger.prototype.setVitest`. `Logger` is a public export; each Vitest instance calls `setVitest` once in its constructor. On that instance it calls `onAfterSetServer` (marked `@internal` in 5.0.3) to push one reporter into `vitest.reporters` after Vitest built its own. A missing member writes `state: "failed"` with the reason, and the CLI prints it; the run is not touched.
3. The reporter keeps each module's end and writes `<private temp>/raw/<pid>.json` at `onTestRunEnd`: outcomes, each project's `serializedConfig` (RegExps as `{"squeal:regexp": "/x/"}`), `globalSetup`, the Vitest process's Node, and the values of the allow-listed variables. These values never reach a part; the private directory is removed at the end.
4. After the command exits, the CLI reads the raw files and the recorder's directory (`src/runners/vitest/ci-runs.ts`) and writes one part per Vitest process (`src/core/ci/parts.ts`).

The hook is a `.cjs` in `src/runners/observe/` because the plugin build already copies every `.cjs` there into `dist/observe/` (`src/harness/build.ts` `OBSERVE_RUNTIME`). No build change was needed; the coordinator's rebuild carries it.

The daemon's recorder in a test process leaves a child whose `SQUEAL_OBSERVE` names another output alone (`spawn.cjs`), so the tests run correctly under a Squeal daemon.

## The part file, `squeal-ci-part/1`

One JSON object per file, `<out>/squeal-part-<uuid>.json`, `--out` default `squeal-parts/`. Types in `src/core/ci/parts.ts`; `readPart(file)` returns the part or why not.

- `header`: `squealVersion`, `keyFormat`, `runner: "vitest"`, `runnerVersion`, `commit` and `dirty` (`readHead`), `createdAt` (epoch ms), `source` (`sourceOf`, as the export header), `end` (`completed`, `crashed`, `interrupted`), `observing` (the recorder ran).
- `projects[]`: `descriptor`, D1's `EnvironmentDescriptor` without `installedDependencies` and `files` (`RunDescriptor`), from the run's own resolved config: `config` hashes each top-level field of `canonicalConfig` of the run's `serializedConfig`; `env` the allow-listed variables the Vitest process saw (policy `env.allowlist`), names and one hash; `nodeVersion`, `platform`, `arch` of the Vitest process; `adapterVersion` as the daemon's (`3+observe.6` while observing); `ci` from the command's env. And `updateSnapshot`, the run's `snapshotOptions.updateSnapshot` as a plain value (D9 refuses all but `none`).
- `testFiles[]`, sorted by project and path: `project`, `path` (relative), `outcome` (`fail` on a failed module, a failed check, a module or suite error, or an unhandled error naming the file; `skip` for a skipped module; else `pass`), `durationMs` (the module's diagnostic sum, as the daemon's), `checks[]` (`fullName` as `checkNames` names it, `outcome`, `durationMs`, `location` line and column), `observed` (`ObservedInputs` without `testFile`; absent when nothing was read).
- A part whose `end` is not `completed` lists no test file: an error outside every file trusts nothing (D12), and a cancel reports skips.
- Never in a part: failure text, logs, config or variable values, absolute paths.

## What 018-17 must know

- No key and no closure is in a part. The export job computes both, as the daemon does, in its checkout of `header.commit`.
- The part's descriptor is the run's, not Squeal's instance's. On one environment, its `config` differs from the daemon's descriptor only in `includeTaskLocation` (Squeal passes `true`) and `snapshotOptions` (Squeal passes `update: "none"`; equal under CI) (`test/runners/vitest/ci-record.test.ts`). Add D10's fields (`allowOnly`, `watch`, `browser.*` without browser mode, coverage) to that tolerance. Vitest 5.0.3 changes `coverage.coverageFilesDirectory` per shard (`research/ci-step.md` 2), so parts of different shards differ in `coverage`.
- `installedDependencies` and `files` are not in the part; take them from the export job's own checkout of the same commit.
- `ci` comes from the env of `squeal ci record`, not the Vitest process: it is a hint for text only.
- Several Vitest processes in one command give several parts. Files of two projects at one path share their observed reads: the recorder attributes by path, as in the daemon.

## Limits and follow-ups

- A command that starts Vitest through its API (`startVitest` from a script) is not a Vitest CLI process: no part, the note "no Vitest run in this command".
- The hook depends on `Logger.setVitest` and `onAfterSetServer`; a Vitest that drops either gives the `failed` note and no part. `test/cli/ci-record.test.ts` catches it on the repository's Vitest.
- Only a worktree from whose root `vitest` resolves is recorded; others print "only Vitest is supported" and run the command with its env unchanged.
- `src/core/ci/command.ts` repeats `squeal hold`'s private `run` with an env added; `src/cli/hold.ts` can switch to it (not this row's file).
