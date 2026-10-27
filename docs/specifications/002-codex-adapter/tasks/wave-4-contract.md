# Wave 4 contract: fixed adapter and runtime artifacts

Approved design: spec 002 D7–D9. This contract is the coordinator's implementation choice, 2026-10-27. W1 and W2 run in parallel and do not import each other's unlanded code. Report an interface change before committing it. Neither worker builds committed plugins or edits another row's files.

## Layout and identities

- Fixed installed plugin: `plugins/codex`; packaged seed at `<plugin>/seed/`.
- Current runtime build (later packaging row): `plugins/codex-runtime/`. This is an artifact source tree, not a second installed plugin.
- Every runtime root holds `.codex-plugin/plugin.json` with `name: squeal` and its runtime version, `runtime.json`, `dist/`, `skills/`, and `bin/squeal-launcher`. `dist/runtime.mjs` is a side-effect-free dispatch entry in addition to the existing ten hook entries and CLI/assets.
- Persistent data remains Codex's `PLUGIN_DATA`. Retained roots remain `versions/<runtime-version>/`, preserving existing lookup conventions. Control files are below `runtime/`.
- `runtime/current.json`: `{schema:1, version:string}`. A successfully published version may become current; a staged or invalid tree never does.
- `runtime/sessions/<sha256(session_id)>.json`: `{schema:1, sessionId:string, version:string}`. Session IDs never become raw path components. All handlers/subagents carrying the same session_id use the same pin. First valid contact pins once, including non-SessionStart registration. Resume/compact preserves a pin. SessionEnd releases it after dispatch; Interrupt does not. No age-only eviction of pins in this change: absent SessionEnd retains disk space, explicitly documented, instead of guessing a session is dead. Pruning keeps every pinned version plus existing process/current/previous/recent-copy protections.

## Runtime manifest and staged artifact

`runtime.json` has `{schema:1, version:string, nodeFloor:string, files:Record<string,{sha256:string,mode:number}>}`. Paths are relative regular files with `/` separators; exclude runtime.json itself. The inventory covers every other published file, including the matching runtime plugin manifest. Allow modes 0644 and 0755 only. Reject duplicates, absolute/traversal/backslash paths, symlinks, hardlink entries, unsupported schema/Node floor, missing required entries, and mismatched versions. Publication validates the whole tree. Normal hook dispatch reads identity/required entries, not all bundle hashes on every tool call.

W2 owns serialization and retrieval. Use a gzip-compressed JSON file envelope with schema/version and base64 regular-file records, including runtime.json. This avoids shell extraction and new dependencies. Enforce compressed/decompressed/file/count bounds before writing outside a fresh private staging directory. A separate release descriptor names schema, runtime version, immutable release tag/commit, artifact filename and SHA-256 of its bytes. Use fixed asset names `squeal-codex-runtime.json.gz` and `squeal-codex-runtime.json`. The descriptor's commit is the exact release commit supplied when packaging; it is not baked into committed bundles. Official discovery uses hearsay-tools/squeal GitHub releases; resolve latest once, then bind every download to that release/tag. Fixtures inject a transport, never real credentials or a mutable production endpoint override in hooks.

## Ownership and exported operations

W1 exports from `src/harness/codex/adapter/store.ts`:
- `publishRuntime({sourceRoot, data, select?, beforeSelect?})` validates and atomically retains a runtime. Without `select` it returns the requested retained `{root,version}`. With `select` it calls the shared monotonic selection owner and returns the usable winning `{root,version}`, which may be newer. `beforeSelect` admits cancellation/deadline-sensitive writes inside selection exclusion. Preserve existing valid roots on collision; reject a different payload claiming the same version.
- `selectRuntime({pluginRoot,data,sessionId})` returns the pinned complete root, creates a first pin from current or seed, or reports a typed/actionable error. Missing pinned roots never switch versions.
- `releaseSession(data,sessionId)` and a read-only readiness/status helper for later CLI integration.

`adapter/selection.ts` owns every current write. Its permanent `runtime/current.json.sqlite` transaction covers compare, winner validation, final admission and atomic current replacement only. It never covers download, copying or full-tree hashing. `selectCurrent(data, version, {node?, beforeSelect?})` returns the winner. Contention fails immediately with `selection-busy` and creates no pin; existing pins and retention without selection bypass this lock. A valid but unusable newer current record stays unchanged while a usable seed can remain a local fallback. Never unlink the lock database; process death releases exclusion.

W1's stable `adapter/index.ts` takes one allowed hook entry name, consumes stdin once, selects the runtime and invokes `dist/runtime.mjs` in-process with that input. Set runtime PLUGIN_ROOT and persistent PLUGIN_DATA for existing retention semantics; preserve the adapter root separately. No second Node startup and no network. `runtime-entry.ts` exports `runRuntimeHook(name,stdin,env):Promise<void>` and shares existing runMain behavior. Preserve event-specific output and timeout budgets; genuine invalid/unavailable runtime produces an actionable supported diagnostic, not false validation. A later row attaches the background updater only at startup after local readiness.

W2 exports manifest creation, deterministic pack/unpack, release discovery and `prepareRuntimeUpdate(...)` returning `{root,version,releaseTag,releaseCommit,sha256,cleanup}`. It does not change current, pins, install directories or user config. Later wiring calls W1 publication after W2 validation and owns updater locks/backoff. W2 must not implement another live-store publication mechanism.

## Later integration boundaries

Packaging owns build scripts, manifests, plugin declarations/skills and generated artifacts. CLI/install wiring owns updater scheduling, setup/status/update and launcher migration. The coordinator owns board/spec/status and bundle/version commits. Peer 005-88 owns daemon ensure/full-check and runner spawn/process-label files; leave them untouched and preserve original runtime argv paths. No full-suite run; use Squeal affected verdicts and relevant uncovered targeted checks, lint and typecheck.
