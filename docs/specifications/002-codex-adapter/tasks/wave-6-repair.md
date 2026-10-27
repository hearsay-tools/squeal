# Wave 6 repair: candidate 0.1.368

Repair only proven B1/B2 in reviews/0.1.368.md. The parent owns generated output, version changes, final combined proof, candidate CI and narrow re-review. No worker changes docs/board.md or sibling files. Use OpenAI models only.

## 002-38 — repair: one current-selection owner

Use /worker. Read review B1 and its exact process reproduction, fixed-plugin D7–D9 and wave-4/5 contracts. Own src/harness/codex/adapter/ (except build files), src/harness/codex/runtime-update/, their test/harness/codex/adapter and runtime-update tests/helpers, and tasks/002-38/notes.md. Start at chooseNew and selectCurrent.

Make every current writer use one atomic, monotonic selection rule. Cover seed retained/new publication and updater retained/staged publication; read the actual winner when selecting/pinning and reporting update outcome. Keep retention without selection unchanged. Preserve pins, invalid/missing-runtime diagnostics, abort admission and hook budgets. The network updater lock cannot stall hooks for a download. An unlocked reread is insufficient. Do not widen into unrelated harnesses.

Done: deterministic real-process bootstrap/update interleaving fails before and passes after; neither writer downgrades current; concurrent seeds, retained/staged updates, pin preservation and bounded contention have meaningful checks. Run affected checks, lint/typecheck. No committed build/version changes or full suite. Report new APIs, lock lifetime/busy behavior and exact evidence. Parent deliberately regenerates adapter after integration.

## 002-39 — repair: independent proof identities

Use /worker. Read review B2 and exact later-release reproduction, D7–D9 and tasks/002-33/notes.md. Own test/e2e/codex-shipped-fixture.ts, codex-fixed-plugin.test.ts, codex-installer.test.ts, codex-migration.test.ts, focused new codex proof helpers/tests and tasks/002-39/notes.md. Leave shared harness/plugins fixtures and all product/generated files unchanged unless parent agrees.

Separate adapter, frozen seed, current release and synthetic next-runtime identities. Read identities from their own manifests. Assert seed fallback before provisioning and actual current runtime after provisioning; preserve A/B pin proof. Do not hardcode adapter 1.0.0: parent may deliberately raise it for B1. Exercise an ordinary built newer runtime with unchanged older seed, installer artifact download and real released-launcher migration. Keep availability guard, scratch isolation and fixture transport limits explicit. Local temporary build is permitted solely for the later-release proof; no committed generated output or full suite.

Done: candidate and older-seed/newer-runtime proof pass without rewriting fixed plugin. Add a regression which prevents version conflation returning. Run explicit excluded e2e paths, affected read, lint/typecheck; record results and any limits. Do not fix B1 here.
