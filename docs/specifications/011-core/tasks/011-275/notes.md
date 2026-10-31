# 011-275 notes: configuration a pinned runtime cannot apply (gh-120)

Worker 7cf9fbfb, 2026-10-31. Brief: `tasks/wave-61.md`, W2. Shape: slice, one commit.

## What changed

- `src/core/daemon/config-file.ts`: the loader returns `unknownKeys`, the path of each key the shape does not know, beside `problems`. Absent when there is none, so every existing `toEqual` on a loaded config holds. `unknownKey(path)` is the one text of that problem.
- `src/core/daemon/policy.ts`: `loadPolicy` passes `unknownKeys` through.
- New status part `src/core/status/ignored-config.ts`:
  - `ignoredConfigOf(root, daemon, own)`: the rules. `by: "command"` for each key this runtime does not know, named with its version; with `daemonVersion` when the live daemon runs another version, since that daemon may apply it. `by: "daemon"` for each key of the `ADDED` table that the file sets apart from its default, while the live daemon is older than the version that added it, with `addedIn` and `cost`.
  - `ADDED` holds one key: `runtimeFiles`, added in 0.1.369 (`research/issue-120.md`), cost "extra re-runs". Any other unknown key reads "not applied" with no cost.
  - `liveDaemonVersion`: the recorded daemon's version only while liveness is alive and not stopping.
  - `ignoredConfigLines`: one `Not applied:` line for the unknown keys of one runtime, then one per daemon rule.
- `src/core/status/config-problems.ts`: the `Config problem` line leaves out the unknown keys the `Not applied:` line names, so no text says a default applies in their place. A status without a store carries the ignored part too (no daemon read there).
- Status JSON: `ignoredConfig` on `StatusSnapshot` and `StatusUnavailable`. `configProblems` is unchanged: it stays the loader's whole list, as `setup --check` names it.

## Shared edits (approved by the coordinator, 2026-10-31)

- `src/core/delivery/delivery.ts`, `register`: one spread, `ignoredConfigAt(worktree row, header.daemon)`.
- `src/core/delivery/format.ts`, inside `formatRegistration` only: one line, after the lint line. W3 edits liveness sentences elsewhere in this file.
- `src/core/status/snapshot.ts`: one spread after `configProblemsOf`.
- `src/core/status/format-status.ts`: the lines after `configProblemsLine`, in the snapshot and the unavailable text.

## Type changes (all additive)

- `LoadedConfig.unknownKeys?` (`config-file.ts`), `LoadedPolicy.unknownKeys?` (`types/policy.ts`).
- New `IgnoredConfigRule` (`types/status.ts`): `key`, `by: "command" | "daemon"`, `version`, `addedIn?`, `cost?`, `daemonVersion?`.
- `StatusSnapshot.ignoredConfig?`, `StatusUnavailable.ignoredConfig?`, `Registration.ignoredConfig?`.

## Decisions the brief did not settle

1. **Where a cost can show.** A runtime that does not know a key cannot know its cost. So `runtimeFiles`' cost shows only when a newer status or hook reads a worktree whose live daemon is older than 0.1.369, the case #120 reports from the other side. Asked the coordinator; option B approved (2026-10-31).
2. **"Sets the key".** The file sets a key of `ADDED` when its applied value differs from `DEFAULT_POLICY`'s (deep equality). `runtimeFiles: []` costs nothing and is not named.
3. **An unknown version.** `isNewerVersion` reads `0.0.0-unknown` and pre-releases as not older, so no daemon rule is claimed for them.
4. **Typo or newer key.** The loader cannot tell them apart. The line says both: "a typo, or a key a newer Squeal added".
5. **Restart path.** For an unknown key: `squeal setup --check`, `squeal update`, and "a session keeps the version it started on until it restarts" (the words of `squeal update`). For an older daemon: `squeal stop`, then `squeal start`, which spawns this CLI's own version (`start.ts`). No text says the key applies after it.
6. **Daemon notes.** `daemon.ts` is not this row's file: the daemon's persisted note keeps its text.

## Tests

- `test/status/ignored-config.test.ts`: an unknown key, a recognized key beside it, only known keys, another daemon version, `runtimeFiles` beside an older daemon, no claim at the default or for a newer or unknown version, the text lines, the `Config problem` line without the named keys.
- `test/cli/status-ignored-config.test.ts`: `squeal status` text and JSON with a store and a daemon of 0.1.368, only known keys, and no store.
- `test/delivery/registration-ignored-config.test.ts`: the registration carries the same rules as status, and its text the same lines.

## For the next worker

- The `ADDED` table grows only with keys whose cost is known, each with the release that added it.
- A runtime older than this row prints the old `Config problem` line only; the new lines start with the release that ships this row.
