# Wave 5 integration contract

Spec 002 D7–D9 is approved. Foundations are integrated on the parent: `adapter/store.ts` and `runtime-release/index.ts`; read tasks/002-29/notes.md and tasks/002-30/notes.md. The packaging, updater/CLI and shell installer rows run in parallel. Changes to another row's files need coordinator agreement.

## Packaging and frozen output (002-31)

`plugins/codex-runtime/` is the current, committed artifact source tree, not an installed plugin. Routine `pnpm run build` builds it, including `dist/runtime.mjs`, current full skills, CLI, launcher and canonical runtime.json (nodeFloor 22.19.0). It leaves every byte in `plugins/codex/` unchanged. This includes that plugin's manifest, static skill bridges, adapter bundles and `seed/`.

Provide an explicit `build:codex-adapter` command that generates the fixed plugin and takes the complete current runtime as its seed only when explicitly requested. Initial independent adapter version is 1.0.0; the seed records its own runtime version. The coordinator invokes this after all rows integrate and the root runtime version is raised. Workers do not run this against committed plugin paths. Build tests use scratch roots. Do not accidentally rebuild seed/ via a global copy loop. Preserve exactly ten hook handler positions and existing shell fast paths/timeouts.

The fixed adapter dispatches via W1's `runAdapterHook`; its source dependency boundary remains adapter/* only. The runtime updater is reached through the runtime CLI, not bundled into the fixed adapter. Launcher-defined hooks need explicit PLUGIN_ROOT/PLUGIN_DATA because Codex does not supply them there; keep existing shell quoting/rejection and trust-hash behavior. Fixed plugin discovery must not mistake a retained runtime's plugin manifest for the adapter: a valid adapter has hooks/hooks.json and seed/.

Packaging exports a release command that writes both runtime assets from a validated runtime tree and supplied exact release commit. It verifies the tree corresponds to that commit (or packages from git archive of that commit), does not publish, and records exact upload instructions. CI must catch routine build drift and fixed-plugin changes without an adapter-version raise. Root runtime changes still require their ordinary version raise. Parent owns all generated artifacts/version edits.

## Runtime updater and CLI (002-34)

Add `src/harness/codex/runtime-update/` for updater state, one exclusive lock, stale-owned-lock recovery, cleanup of abandoned staging only under that lock, and retry timing. Use W2 resolve/prepare, then W1 publishRuntime(select:true), then pruneVersions, finally cleanup. Never downgrade current. Failed checks keep the selected runtime and record update failure separately. One-hour successful-check interval, five-minute transient-failure interval, one-hour nontransient-failure interval; explicit update bypasses these intervals. Use a 120-second whole-operation bound; a competing update gives a bounded busy result, not an unbounded wait.

Trigger a detached background CLI child from the versioned runtime entry on SessionStart after local runtime readiness. Tool-boundary hooks do no network work. Child argv names the selected retained CLI. Do not change the fixed adapter's code or peer-owned daemon/runner spawns. Pins are unchanged by updater publication.

Provide the additive CLI command `squeal codex-runtime` with:
- `ensure --plugin-root <absolute> [--data <absolute>]`: ensure/select a local complete runtime from current or seed, no network and no session pin. Return 0 only when ready.
- `update --plugin-root <absolute> [--data <absolute>] [--tag squeal--v<version>] [--background]`: bounded runtime update. Foreground reports its result and returns nonzero on failure. Background persists state and remains separate from validation verdicts.
- `status --plugin-root <absolute> [--data <absolute>] [--json]`: read-only adapter/runtime readiness, pin summary and last update result; 0 ready, nonzero not ready.

Default data locator uses explicit PLUGIN_DATA when appropriate, otherwise the existing Codex squeal-hearsay data path under CODEX_HOME (HOME fallback). No credential reads or arbitrary production endpoint override. Tests inject transports/functions. Export command/locator helpers from `src/cli/codex/runtime.ts` for existing update/setup wiring. Keep that file out of the packaging and installer rows.

`squeal update` updates the fixed adapter through Codex only as needed by its existing marketplace command, then uses the runtime updater; its human version report distinguishes the selected runtime from adapter version. Setup plan/check includes runtime readiness, and applying setup prepares it through the same operations. Other harness behavior remains unchanged. Expose honest missing-runtime diagnostics; do not interpret plugin presence/trust alone as ready. Follow the existing consent contract of setup; no silent trust writes.

## Installer and launcher (002-35)

`install.sh` installs the one fixed plugin, then invokes its `seed/dist/cli/squeal.mjs codex-runtime ensure --plugin-root <root>` and `codex-runtime update --plugin-root <root> --tag squeal--v<SQUEAL_VERSION>` before reporting current-runtime provisioning success. The initial seed is offline-capable, but explicit installer provisioning failure must be reported, not called current. Existing legacy plugin layouts remain supported during migration. Do not read adapter version as runtime version.

Launcher format advances from 7 to 8 in 002-35. Row 002-34 owns the corresponding current/future format assertions in update.test.ts, update-pi.test.ts and update-opencode.test.ts. Its recopyLauncher reads the validated selected managed runtime launcher, with seed fallback only when managed selection is absent; a frozen root bin copy is not the update source. Corrupt managed state must remain an explicit error. Preserve legacy and other harness selection.

The launcher finds managed runtime/current.json plus matching versions/<version> manifest/CLI, with the plugin seed as bootstrap fallback when managed state is absent. Respect a session pin when CODEX_SESSION_ID/THREAD_ID identifies one; do not silently switch a pinned session to a newer runtime. A missing pinned copy gives an actionable error. Keep raw executable paths for discovery/pruning. Bump launcher format when needed so squeal update replaces copied launchers. Preserve Claude/Pi/OpenCode selection and existing legacy Codex fallback. Shell fixtures may stub the new CLI contract; real combined proof is the coordinator's gate.

## Shared test boundaries and publication

Packaging owns harness/build/hash/version tests, `test/cli/codex.test.ts`, `codex-hash.test.ts`, and launcher-config compatibility. Updater owns new runtime-update and codex-runtime tests plus existing update/setup/status tests. Installer owns install-sh/launcher tests and shell fixtures. Leave shared e2e helpers/tests to the later shipped-proof row; report necessary changes in notes. No worker runs pnpm run build against committed plugins, raises versions, publishes a release, edits board/spec/status, or runs a full suite. Each runs lint/typecheck and affected checks; source failure versus expected generated drift must be explicit.
