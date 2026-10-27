# Wave 4: runtime foundations

Read spec 002 D7–D9, status.md and `wave-4-contract.md`. Both rows run in parallel on disjoint files. Use /worker. No bundle build, version raise, board/spec/status edit or full suite. Commit small coherent steps and report exact affected-check evidence, lint/typecheck, exported interfaces and residue notes.

## W1 — 002-29, slice

Deliver retained runtime selection and stable hook dispatch. Start at `src/harness/codex/main.ts`; first add a real-child regression showing an A session stays on A after B becomes current, while a new session selects B. Follow `research/stable-wrapper-plugin.md` and 005 D3's retention rules.

Own new `src/harness/codex/adapter/`, `src/harness/codex/runtime-entry.ts`, necessary edits to `src/harness/codex/main.ts`, `src/harness/shared/version-copies.ts`, their existing focused tests, and new `test/harness/codex/adapter/`. Notes: `tasks/002-29/notes.md`. Leave runtime-release, build/package/CLI/install files and peer 005-88 spawn files alone.

Done: seed first use, first-hook races, persistent pins, missing pinned runtime diagnostics, unchanged event output, corrupt/mislabeled tree rejection, same-version collision, atomic publish/current selection and pinned-copy pruning tests pass. Keep the adapter small and independent of changing product modules. Do not implement the updater; expose the contract for later wiring. Build dispatch only into scratch test output if needed.

## W2 — 002-30, slice

Deliver runtime release artifact validation and staging. Start new `src/harness/codex/runtime-release/`; first test deterministic pack/unpack of a runtime-shaped fixture and reject a modified byte before publication. Read `research/wrapper-install-flow.md` and `wave-4-contract.md` for the approved single-plugin flow and schemas.

Own only new `src/harness/codex/runtime-release/`, new `test/harness/codex/runtime-release/`, and `tasks/002-30/notes.md`. Leave adapter/store, main, shared version-copies, build/package/scripts, CLI/install and peer spawn files alone.

Done: deterministic artifact/descriptor roundtrip, manifest/hash/identity validation, malicious paths/modes/entries and oversized/truncated payload rejection, immutable-release URL binding, bounded network failures, cleanup and no mutation outside staging. Use injected local HTTP/transport fixtures; no real release publication or credential reads. Return the prepared root and cleanup handle; later wiring owns publication, updater lock/backoff and selection. Document exact public APIs for the packaging and updater workers. No runtime dependency unless justified to coordinator first.
