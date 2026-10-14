# 001-377: user-level config with the capacity keys

Worker notes, 2026-10-14. Spec 001 D11 Capacity, "Configuration" bullet; `research/host-capacity.md` §5.

## API for 001-376

The pool takes the daemon's reader as an injected parameter. Everything is in `src/core/daemon/user-config.ts`; types are in `src/core/types/capacity.ts`, exported from `types/index`.

```ts
interface Capacity { readonly hostSlots: number; readonly projectSlots?: number }

// In the daemon (daemon.ts), built in the constructor:
readonly #capacity: () => Capacity;
```

- Call `#capacity()` at each tier boundary where the pool needs the numbers. Pass it into the pool as `capacity: () => this.#capacity()` (or the function itself). Each call re-reads the file, so an edit to the user config applies at the next tier and no daemon restarts. The cost is one `readFileSync` of a small file plus one `realpath` per `projects` entry.
- `hostSlots` is always at least 1: the configured value, or `max(1, availableParallelism() - 1)`.
- `projectSlots` is present only when `capacity.projects` names this repository's root. It is never above `hostSlots` because `resolveCapacity` clamps it. The pool can use `min(hostSlots, projectSlots ?? hostSlots)` without checking further.
- The daemon calls `#capacity()` once at start, after the policy, so problems with the file show up as a note at start. They don't wait for the first backlog tier.

Lower-level exports, for tests or another caller (warmup, `squeal status`):

- `userConfigPath(env)`
- `defaultHostSlots(cpus)`
- `loadUserConfig({ env, cpus })` → `{ path, config, problems }`
- `resolveCapacity(config, repositoryRoot)`
- `repositoryRootOf(commonDir)`
- `capacityReader({ repositoryRoot, env, cpus, lastNote, note })`

## Decisions

1. **Loader rules shared, not copied.** `src/core/daemon/config-file.ts` now holds what `policy.ts` had privately: the read (missing file → defaults, no problems; unreadable, not JSON or not an object → defaults plus one problem), the shape `merge`, `Leaf`/`Shape`/`Kept`, `positiveInteger` and `describeProblems`. `loadPolicy` behaves as before: `test/daemon/policy.test.ts` and `hardening.test.ts` pass unchanged. `policy.ts` still exports `describeProblems`.
2. **Path.** `$XDG_CONFIG_HOME/squeal/config.json` when `XDG_CONFIG_HOME` is set to an absolute path, otherwise `$HOME/.config/squeal/config.json`, with `os.homedir()` when `HOME` is unset or empty. The XDG Base Directory spec says to ignore a relative value. `slowSlotDir` and `runtimeDir` treat `XDG_RUNTIME_DIR` the same way.
3. **The note.** The note goes through the same path as `squeal.config.json`'s problems (`daemon.#note`, deduplicated by `lastPolicyNote`, which now takes the file prefix as an optional third argument; its default and behaviour are unchanged). The text is `<absolute path>: <problems>; the defaults apply in their place`. The prefix is the resolved absolute path rather than `~/.config/…`, so the note says which file was read when `XDG_CONFIG_HOME` is set. A daemon adds one note per distinct problem set. A restart that finds the same problems adds none, matching probe H for the policy. The reader also remembers what it last told, so later calls with unchanged problems don't query the store. If the file is fixed, nothing is noted. Unlike `squeal.config.json`, there is no "changed; reloaded" note, because no revision sees this file: it is outside every worktree.
4. **Bad entries in `capacity.projects`.** Each bad entry is one problem and is left out. The other entries are kept, as `slow.include` keeps its good globs. The wording follows the existing `"<path>" …; it is left out` form:
   - `"capacity.projects[relative/repo]" must name an absolute path; it is left out`
   - `"capacity.projects[/srv/zero]" "slots" must be a positive integer, got 0; it is left out`
   - `"capacity.projects[/srv/extra]" has unknown key "worktrees"; it is left out`
   - `"capacity.projects[/srv/number]" must be { "slots": n }, got 5; it is left out`

   A `projects` value that is not an object gives `"capacity.projects" must be an object from repository root path to { "slots": n }, got …`, and the default `{}` applies.
5. **Repository root.** The daemon passes `repositoryRootOf(opened.commonDir)`. That is the directory holding the common `.git` directory, so the main worktree and every linked worktree resolve to the main worktree's root, and the cap covers "that project's daemons together". For a bare repository it is the common dir itself. `commonDir` is already `realpath`ed by `openDaemon`. Config keys are `realpath`ed when they exist (otherwise `path.resolve`d, which drops a trailing slash), so a symlinked or trailing-slash spelling still matches. If two spellings of one root both appear, the smaller `slots` wins.
6. **A project cap above the host's slots is clamped** to `hostSlots` when resolved, with no problem note. It is a harmless setting: the host bound applies anyway.
7. **`squeal.config.json` gets no capacity key.** `SHAPE` in `policy.ts` is unchanged, so a `capacity` key there is reported as `unknown key "capacity"`, as before.
8. **Test isolation.** `childEnv` in `test/daemon/helpers.ts`, which every daemon-spawning helper under `test/daemon` and `test/integration` uses, now sets `XDG_CONFIG_HOME` to `<test runtime dir>/config`. Spawned test daemons therefore never read the real user config. The unit tests pass a fully temporary env (`HOME`, `XDG_CONFIG_HOME`, `XDG_RUNTIME_DIR`). No test reads or writes the real home directory.

## Evidence

- `test/daemon/user-config.test.ts` (14 tests) covers:
  - the path rules
  - defaults: 24 CPUs give 23 slots, 1 CPU gives 1
  - valid keys
  - every problem collected for one note, with good entries kept and defaults applied
  - non-JSON and non-object files
  - a project's cap, and no cap for an unnamed root
  - the clamp
  - the symlink and trailing-slash spelling
  - **a project cap applied across its daemons**: a real git repository with a linked worktree, both of whose common dirs resolve to the main root and the same `projectSlots`
  - `capacityReader` notes once, picks up an edit at the next call, and adds no note on a restart with the same problems
- `test/daemon/user-config-note.test.ts` (built CLI, real daemon): a bad user config gives one note and a running daemon, across a second spawn that loses the lock and a restart. It is red with the start-time `#capacity()` call removed (`expected [] to deeply equal [ Array(1) ]`) and green with it.
- Host: `os.availableParallelism()` is 24 here, so the default `hostSlots` is 23.

## Open points for the coordinator

- **Spec wording.** D11 says the file is "read by the same loader rules as `squeal.config.json` (never throws; problems become one note)". It does not say when the file is re-read. I chose every call (each tier boundary), with no reload note. If D11 should say so, a proposed sentence for the Configuration bullet: "It is read again at each tier boundary that takes permits, so an edit applies to the next tier; its problems are one note per distinct set."
- **Spec wording.** "A map from a repository root path" leaves open what a linked worktree's repository root is. The code uses the main worktree's root (the common `.git` directory's parent). A proposed parenthesis: "(the main worktree's root, which every linked worktree shares)".
- **Residual isolation gap.** Test files outside `test/daemon` and `test/integration` that spawn daemons with their own env (`test/cli/*`, `test/harness/*`, `test/e2e/*`) still inherit the real `XDG_CONFIG_HOME`/`HOME`. Those daemons only read `~/.config/squeal/config.json`, never write it. If that file had problems, they would add a note to their own temp stores. No test I found asserts that no notes exist. Closing the gap fully means a temp `XDG_CONFIG_HOME` in each of those env builders, or one shared helper. I left that alone because it is outside this row's seam.
- **Not done here (other rows):** the pool (001-376) and sizing (001-378). Neither `squeal status` nor setup shows the resolved capacity yet.

## For integration

The full suite at bc651f98 has seven expected failures, and none of them is a behaviour failure:

- **The four committed-bundle drift tests** (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`, `opencode/package.test.ts`, `pi/package.test.ts`). The daemon's source changed and the brief leaves the `dist` rebuild to the coordinator.
- **The three `test/keys/key-format.test.ts` checks.** `src/core/daemon/*` and `src/core/types/*` are guarded sources, so the guard asks to pin `96de2f09b75632a3c417c8ba6996d5c5b3223ef14873239e81f78dbfc31221f7`. Format 10 is still unreleased (there is no `squeal--v0.1.17*` tag), so `KEY_SOURCES_HASHES[10]` can be re-pinned in place in the integration build commit, as was done for 001-360/361, 009-23 and 008. 001-376 changes guarded sources too, so pin once after both land. This row changes no key: the user config never enters an environment hash.
