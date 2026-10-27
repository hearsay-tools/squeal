# Proposal: one fixed Codex plugin with a managed runtime

Status: approved by the human, 2026-10-27: “One plugin: Implement it”. Revision 2 replaces the two-plugin proposal. Normative sections are copied into spec.md D7–D9; implementation contracts are in tasks/wave-4-contract.md.

## Outcome and evidence

Users install one `squeal` plugin. Routine runtime releases do not require renewed Codex hook approval. Changes to the fixed plugin itself still do.

`research/stable-wrapper-plugin.md` proves preserved approval and real SessionEnd execution after an external runtime update on Codex 0.164.0. `research/wrapper-install-flow.md` proves that Codex installs no plugin dependencies and runs no install scripts. SessionStart runs before ordinary first-turn sampling according to versioned source. Seed bootstrap has shell-replay evidence; actual first-turn bootstrap, production update transactions and session pinning remain implementation gates.

## D7. One plugin, two release lifecycles

Keep the existing `squeal` plugin identity. Its contents become a small dispatcher, stable skill entry points and a frozen, known-good seed runtime. Give the plugin an adapter version independent of the runtime version. Ordinary builds/releases update a separately published runtime artifact; they do not rewrite the plugin manifest, seed, skill bridges or any other fingerprinted file. Updating the seed or repairing the adapter is an explicit adapter release and requires approval again.

The seed is the offline fallback, not a promise to ship the latest runtime forever. It has its own runtime manifest and required entry files. A new session with no valid external runtime can use a retained complete seed copy. Unsupported environments or an unusable seed produce a clear validation-unavailable diagnostic and fail setup readiness; they never claim current validation.

Install routes:

- `codex plugin add squeal@hearsay` installs the one complete plugin. After the existing explicit hook approval, first use initializes the seed locally; no second package or remembered install step is required.
- `install.sh` provisions the current runtime and installs the same plugin before reporting success. Setup checks plugin presence, hook trust, runtime readiness and repository configuration together.
- Existing users receive one adapter migration and approve its changed hooks once. Keep exactly the existing ten handler positions; do not add a parallel hook-owning plugin.

The approval model is explicit: the adapter may execute future Squeal runtime releases. Codex checks the adapter contents, not each external runtime release. A trusted hook alone does not prove a usable runtime exists.

## D8. Runtime publication and updates

Publish a versioned Codex runtime artifact with each normal Squeal release, from the reviewed release commit. Include the runtime manifest, CLI, hook entries, skills, recorder/reporters and required assets. The installer/updater resolves the official release once, binds artifact identity to that release, validates integrity, manifest/version and required files, then publishes a complete immutable version directory atomically. Define the artifact and validation contract in the implementation brief; do not execute an incomplete staging tree or treat a mutable latest URL as a pinned identity.

`squeal update` installs the runtime independently of the fixed plugin. It still updates the adapter when there is an actual adapter release. Status and version output distinguish adapter and runtime versions; runtime version drives compatibility and existing daemon handoff rules.

For direct-install users, schedule a bounded background runtime-update check at session startup after a valid local runtime is available. One updater lock prevents concurrent downloads; failed checks use a persisted retry delay. No network request runs on each tool boundary. Startup does not wait for a download, and a completed update applies to new sessions only. Explicit `squeal update` waits for and reports its own update result. Offline/update failures retain the usable runtime and report update state separately from validation state.

An update must never modify the fixed plugin or its seed. Retain the selected runtime and versions in active use; interrupted downloads and failed validation leave the prior selection intact.

## D9. Preserve session and daemon identity

On the first hook for a session, resolve a valid installed runtime or seed, retain a complete copy, and pin that session to its runtime version. Later hooks use that version. New sessions use the newly published runtime. The adapter must support first contact through any existing registration hook, not only SessionStart.

Keep the daemon's matching recorder/reporters and the session's skill files. Treat adapter root/version and runtime root/version as separate facts. Existing copy validation compares against the runtime manifest; it must not infer runtime identity from the fixed plugin manifest. A missing pinned runtime produces an actionable diagnostic and no silent switch to another version. Specify mapping lifetime and pruning together, including sessions without SessionEnd and the current skill-retention limit.

Use regular files inside the fixed plugin: Codex rejects symlink entries. Publish runtime copies and pin records atomically. Stable skill entry points direct the agent to the selected runtime's retained instructions. Keep concrete runtime paths and original arguments visible to process discovery and retention.

## Coordination and ownership

Coordinator 5df9d46d owns 005-88 process display: `src/core/daemon/{ensure,full-check}.ts`, `src/runners/process/group.ts`, `src/runners/node-test/run/run.ts`, new `src/core/process-label.ts` and its tests. This proposal leaves those files and their original argv paths unchanged. Their ownership notice was received and acknowledged; the direct request about remaining shared boundaries is still pending.

Our rows cover fixed adapter/package build, external runtime selection and retention, installer/setup/update/status integration, artifact publishing, migration, launcher-config compatibility, version checks and documentation. Split them into disjoint implementation briefs after design approval. Bundles/version raises stay with the coordinator. No version is reserved.

## Required proof before landing

- Directly install one plugin through real Codex in a scratch home. With runtime network access unavailable, actual first-turn startup uses the seed within the existing hook budget and names its real version.
- Approve once, install runtime B through the real runtime updater: all ten approval hashes and trust config remain unchanged. A real hook runs B in a new session; the existing session stays on A.
- Remove A's Codex cache: its retained runtime, recorder and skill remain usable. Runtime identity checks reject a mislabeled copy.
- A fixed-plugin file change invalidates approval and prevents actual hook execution.
- Migration executes each handler once, including both intentional Stop handlers. Setup/install reruns are idempotent; launcher-defined hooks remain supported.
- Missing/corrupt seed or pinned runtime, unsupported Node, unwritable data, interrupted/concurrent update, first-hook races and paths with spaces produce defined outcomes without false validation claims.
- Offline updater preserves working validation; successful background updates do not change an active session. Runtime pruning preserves active daemon/session copies. Readable-process discovery/retention regressions pass.
- Relevant affected checks, lint, typecheck, bundle/version checks, runtime artifact checks and shipped-plugin tests pass. Candidate review passes before main; exact-release CI passes before publication. No routine local full suite.
