# 002-29 notes: retained runtime selection and stable hook dispatch

Wave 4 W1, 2026-10-27. Spec 002 D7 to D9, `../wave-4-contract.md`. No bundle build, no version raise.

## Exported interfaces

`src/harness/codex/adapter/store.ts`:

- `publishRuntime({ sourceRoot, data, select?, node? }): RuntimeRef` (`{ root, version }`), defined in `publish.ts`, re-exported. Validates the whole tree, hashes every byte as it copies it into `versions/.<version>.<pid>.tmp`, then renames it to `versions/<version>`. With `select`, writes `runtime/current.json` atomically. Throws `RuntimeError`.
- `selectRuntime({ pluginRoot, data, sessionId, pin?, node? }): SelectedRuntime` (`RuntimeRef` plus `source: "pin" | "current" | "seed"`). An existing pin always decides. `pin: false` makes no new pin, and neither does `sessionId: null`.
- `releaseSession(data, sessionId): void`.
- `runtimeReadiness({ pluginRoot, data, node? }): RuntimeReadiness`, read-only: `{ schema: 1, adapter: { root, version }, current, seed, pinned: { version, ready }[], ready }`, where `current` and `seed` are `{ version, ready, problem }`.
- `SEED = "seed"`.

`src/harness/codex/adapter/manifest.ts`: `RuntimeError` (`kind`: `invalid-runtime`, `version-conflict`, `unsupported-node`, `missing-pinned-runtime`, `invalid-pin`, `no-runtime`, `unwritable-data`), `RuntimeManifest`, `REQUIRED_ENTRIES`, `RUNTIME_HOOKS`, `RUNTIME_ENTRY`, `RUNTIME_MANIFEST`, `PLUGIN_MANIFEST`, `parseManifest`, `checkRoot`, `verifyTree`, `listTree`, `meetsFloor`, `isInventoryPath`.

`src/harness/codex/adapter/layout.ts`: paths (`runtimeRoot`, `currentFile`, `sessionsDir`, `pinFile`), `readCurrent`, `readPin`, `pinnedVersions`, `protectedVersions`, `writeAtomic`, `createExclusive`, `isNewer`.

`src/harness/codex/adapter/index.ts`: `runAdapterHook(name, { env?, stdin?, write? }?): Promise<void>`, `ADAPTER_HOOKS` (same list as `RUNTIME_HOOKS`), `ADAPTER_ROOT_ENV = "SQUEAL_ADAPTER_ROOT"`, `diagnosticText(error)`.

`src/harness/codex/runtime-entry.ts`: `runRuntimeHook(name, stdin, env): Promise<void>`. Importing it runs nothing.

`src/harness/codex/main.ts`: new `runHookInput(name, handler, stdin, env)`; `runMain` reads stdin and calls it. Behavior is unchanged.

`src/harness/shared/version-copies.ts`: new export `pruneVersions(data, version)` (formerly the private `prune`).

## Behavior decided here, not in the spec

1. **Pins only where Squeal is in use.** The adapter makes a session's first pin only when the input `cwd` is in a repository that uses Squeal. It uses the same test as the `hooks.json` shell fast path (`adapter/repository.ts`, a copy of `usesSquealAt`). Once a pin exists, it decides every hook of that `session_id`, whatever the hook's `cwd`. A session that never touches a Squeal repository runs the current runtime with no pin. This keeps pins, and the runtimes they retain, to sessions that use Squeal. A session pins at its first hook after `squeal init`.
2. **Current or seed.** A new session uses `current.json`'s runtime when it is complete. It uses the seed when there is no usable current runtime, or when the seed is newer (an adapter release with a newer seed). The seed becomes current when no record exists, the record is unreadable, or the seed is newer. A current record whose root is missing is not rewritten unless the seed is newer. The seed serves new sessions, and readiness reports the problem.
3. **Diagnostics.** A runtime that cannot be selected or loaded produces `additionalContext` at SessionStart, UserPromptSubmit and SubagentStart, only in a repository that uses Squeal. The text says validation is unavailable, gives the reason and action, and tells the agent to run tests itself. Other hooks are silent. `SQUEAL_HOOK_DEBUG=1` writes the error to stderr. A missing pinned runtime keeps its pin, so a restored root serves the session again.
4. **Tree validation.** Publication rejects symlinks, hard-linked files (`nlink > 1`), other entry types, unlisted files and missing listed files. It writes each file with the manifest mode, so source modes are not trusted. Aligned with W2 (002-30) on 2026-10-27: `runtime.json` must be byte-identical to its one spelling (`serializeManifest`, a copy of W2's `serializeRuntimeManifest` rule). This also refuses duplicate keys and extra keys. `bin/squeal-launcher` must be 0755. W2's path rule (`[A-Za-z0-9._@+-]` segments, case-insensitive uniqueness) is stricter than W1's `isInventoryPath`. A later quality pass can make W1 call W2's `validateRuntimeTree`, so that one rule set exists.
5. **Required entries** (`REQUIRED_ENTRIES`): `.codex-plugin/plugin.json`, `dist/runtime.mjs`, `dist/cli/squeal.mjs`, the ten `dist/<hook>.mjs`, `skills/squeal/SKILL.md` and `bin/squeal-launcher`. W2 validation and packaging must use the same list.
6. **Same-version collision.** An existing root is fully verified, byte for byte, against its own `runtime.json`. If it is the same payload, it is kept. A valid root with a different payload is a `version-conflict`. An invalid root is renamed out and replaced. Examples are a spec 005 D3 copy without `runtime.json`, or a tampered tree. A pinned reader can miss the root during that brief rename window.
7. **Node floor.** The format is `major.minor.patch`, as in W2. Publication and selection reject a floor the running Node misses (`unsupported-node`). Packaging writes the floor as `22.19.0`, not `nodeFloor()`'s `22.19`.
8. **Copy identity.** `version-copies.ts` `manifestVersion` returns the version only when `runtime.json` and `.codex-plugin/plugin.json` agree, if `runtime.json` exists. Otherwise it uses the plugin manifest, as before. The fixed plugin root names the adapter version, so 005 D3 makes no runtime copy from it. Under the adapter, `PLUGIN_ROOT` is the retained root, so `keepVersion` finds a whole copy and makes none. It still writes the launcher.
9. **Pruning.** `pruneVersions` also keeps every pinned version and the current one. Pins have no age limit, as the contract states. A session that never sends SessionEnd keeps its runtime's disk space, about 11 MB per version today. The newest-previous rule is computed as before.

## Integration notes

- **Packaging:** bundle `src/harness/codex/runtime-entry.ts` as `dist/runtime.mjs` beside the hook entries (`{ in: "src/harness/codex/runtime-entry.ts", out: "runtime" }` in `bundleOptions`). The adapter bundle must contain only `src/harness/codex/adapter/*` (`test/harness/codex/adapter/frozen.test.ts`). The tests run it as `node adapter.mjs <hook>` (`fixture.ts` `buildAdapter`). The real plugin can use per-hook stubs `await runAdapterHook("<hook>")` with the existing command shape. Generate `runtime.json` over every file except itself, with modes normalized to 0644 or 0755. A checkout under umask 002 holds 0664. The seed at `plugins/codex/seed/` is a complete runtime tree, and the plugin root manifest names the adapter version.
- **Updater / CLI wiring:** use W2 `prepareRuntimeUpdate`, then `publishRuntime({ sourceRoot: prepared.root, data, select: true })`, then `pruneVersions(data, version)`, then `cleanup()`. Status and setup read `runtimeReadiness`. Today the 005 D3 launcher finds the CLI through the Codex plugin cache, which will hold the fixed plugin. Launcher migration must find retained runtimes, for example the newest complete `versions/<v>/`.
- **Runtime environment:** the runtime runs with `PLUGIN_ROOT` set to its retained root, the persistent `PLUGIN_DATA`, and `SQUEAL_ADAPTER_ROOT` set to the fixed plugin root. These are set on `process.env`, so a spawned daemon inherits them. Daemon argv names the retained root's `dist/cli/squeal.mjs`, which the process-args prune protection reads.

## Residue

- Adapter latency was not measured. Host load was 54.8 at 12:03 and 33 at 12:06 on 2026-10-27, from this project's parallel work. Measure first contact (seed publication hashes and copies about 11 MB) and a pinned hook against the direct bundle at calm load.
- Committed bundles drift: `version-copies.ts` feeds every plugin's `cli/squeal.mjs`. The bundle drift tests fail until the coordinator rebuilds: `test/harness/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`, and the Codex bundle test.
- No real Codex proof yet: actual first-turn seed bootstrap and the trust hash are later rows.
