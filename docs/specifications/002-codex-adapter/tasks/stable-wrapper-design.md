# Proposal: stable Codex hook adapter

Status: revision needed, 2026-10-27. The human identified a direct-install gap: users must not need to remember a second plugin. Research 002-28 checks dependency support and a single-plugin bootstrap alternative before this proposal can be approved. No product implementation authorized by this document.

## Outcome and evidence

Routine Squeal runtime updates do not require renewed Codex hook approval. Actual changes to the hook adapter still do.

`research/stable-wrapper-plugin.md` proves this on Codex 0.164.0: an entirely fixed plugin retained all ten approvals while an external runtime changed, and a real SessionEnd ran the new runtime. It also proves that selecting the newest runtime on every call changes already-open threads. The two-plugin installation and session pinning below are proposed behavior, not verified by that probe.

## D7. Two packages, one user setup

Keep the existing `squeal` Codex package as the versioned runtime and skills package. Remove its hook declarations as part of migration. Add a small `squeal-hooks` package that owns all ten existing handler positions and dispatches to that runtime. Its manifest has an independent adapter version; runtime builds and skill updates must not rewrite any file inside it. Ordinary releases may advance the marketplace ref while the adapter contents remain byte-identical.

The installer and `squeal setup` install both components through Codex. `squeal update` and Codex marketplace upgrades continue to deliver runtime releases. No hook downloads code. Installing directly through Codex must have clear instructions to install both components; setup/status names a missing component. The runtime component has no hooks, so there is one owner per handler. Migration removes the old declarations, installs the adapter and requests one explicit approval of the new adapter. It never writes approval silently.

The fixed adapter executes independently updated Squeal code. Initial approval therefore authorizes that update model. It does not claim Codex separately approved each runtime release. Any later adapter change still requires approval.

## D8. Preserve version identity

On the first hook for a Codex session, resolve the installed runtime, verify its manifest and required entry files, retain a complete versioned copy, and pin that session to it. Subsequent hooks use the same runtime; new sessions use the updated runtime. Preserve the current no-mid-session-upgrade contract rather than adopting the probe's newest-on-every-call behavior.

Retain the daemon's matching recorder/reporters and session skill files. Distinguish adapter root/version from runtime root/version explicitly. Existing keepVersion validation must continue to compare the copy with the runtime manifest, never the fixed adapter manifest. A missing or invalid pinned runtime must produce an honest diagnostic through supported hook/status output; it must not silently switch versions or claim validation ran. Specify mapping lifetime and pruning together, including sessions without SessionEnd and the existing 24-hour skill-retention limit.

Use regular files; Codex rejects symlinks inside fingerprinted plugins. Publish complete runtime copies and session selections atomically. Keep original executable arguments and concrete runtime paths visible to process discovery and retention.

## Ownership and implementation order

Coordinator 5df9d46d owns 005-88 process display: `src/core/daemon/{ensure,full-check}.ts`, `src/runners/process/group.ts`, `src/runners/node-test/run/run.ts`, new `src/core/process-label.ts` and its tests. This proposal does not change those files or their original argv paths. Its notification is recorded; direct acknowledgement of the remaining shared boundaries is pending.

Our implementation covers the Codex adapter package/build, runtime selection and saved copies, install/setup/update/status integration, migration, launcher-config compatibility, package/version checks and documentation. Split into disjoint board rows only after design approval. Bundles/version raises stay with the coordinator; no version is reserved yet.

## Required proof before landing

- Install both packages through real Codex in a scratch home and approve once. Upgrade the runtime through the actual marketplace path: all ten adapter approvals remain trusted and no trust config changes.
- Existing session stays on runtime A; a new session runs B. Deleting A's Codex cache leaves A's retained runtime, recorder and skill usable.
- An adapter file change invalidates approval and prevents actual hook execution.
- Migration from today's single package runs each handler once; both Stop handlers remain intentional. Re-running setup is idempotent.
- Missing/corrupt runtime, interrupted update, concurrent first hooks, spaces in paths and cleanup produce defined results without false validation claims.
- Existing launcher-config use still works; readable process labels, discovery and retained-version pruning pass their targeted regressions.
- Relevant affected checks, lint, typecheck, bundle/version checks and shipped-plugin tests pass. Candidate review must pass before main. No routine local full suite.
