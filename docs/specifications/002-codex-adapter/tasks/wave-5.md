# Wave 5: one installed plugin

Use /worker. Read spec 002 D7–D9, status.md, `wave-5-contract.md` and foundation notes 002-29/002-30. Three disjoint rows run in parallel. Test first, commit coherent pieces, use Squeal affected checks plus lint/typecheck. No committed plugin build, version raise, full suite, release or board/spec/status edits. Parent generates final artifacts. Keep peer 005-88 spawn files unchanged.

## W1 — 002-31, slice: fixed plugin build

Deliver independent adapter/seed and runtime builds. Start `src/harness/codex/build.ts`; first regression: building runtime B leaves the fixed plugin and seed A byte-identical.

Own Codex build source and helpers, necessary additive `src/harness/build.ts` changes, package.json scripts (no version/dependencies), new release packager script, scripts/check-version-bump.ts, relevant CI build/drift paths, non-generated Codex manifests/declarations/static skill bridges/README, src/cli/codex/launcher.ts, and harness Codex/build/version/hash tests including test/cli/codex.test.ts and codex-hash.test.ts. Notes tasks/002-31/notes.md. Do not edit installers, CLI update/setup/runtime command or runtime-update modules; full skills source remains elsewhere.

Done: scratch runtime/adapter builds, independent version guards, reproducibility, ten hooks, launcher config env/quoting, current-runtime manifest roundtrip, exact-commit release assets and ordinary fixed-plugin byte stability pass. Report shared e2e fixture changes for the proof row. Explicit adapter generation and root version raise belong to parent integration.

## W2 — 002-34, slice: updater and CLI

Deliver one runtime updater and readiness contract. Start new runtime-update coordinator; first test an interrupted or concurrent update preserving current and session pins.

Own new src/harness/codex/runtime-update/, src/harness/codex/runtime-entry.ts startup trigger, new src/cli/codex/runtime.ts, registration in src/cli/main.ts, src/cli/update.ts and necessary setup plan/harness/flow/status integration, plus focused new tests and existing update/setup/status tests. Notes tasks/002-34/notes.md. Leave adapter, artifact validator, build/package/scripts, launcher.ts, shell installer and launcher source untouched.

Done: lock/retry/deadline, no downgrade, offline preservation, pin stability, startup background-only scheduling, codex-runtime command, explicit update, setup readiness and adapter/runtime version reporting tests pass. Follow the exact shell-facing CLI contract in wave-5-contract.md. Other harnesses unchanged; no silent trust writes or production endpoints in tests. Source-only verification may report expected bundle drift separately.

## W3 — 002-35, slice: installer and launcher

Deliver one-component install and usable short CLI. Start install.sh's Codex path; first fixture installs only one plugin and proves runtime provisioning failure cannot report success.

Own install.sh, plugins/claude-code/bin/squeal-launcher (source), README.md installation guidance, test/cli/launcher*.test.ts, install-sh*.test.ts, install-fixture.ts, and focused shell fixtures; notes tasks/002-35/notes.md. Leave generated launcher copies, package/build files, CLI TypeScript and other rows' tests unchanged.

Done: fixed/legacy Codex layouts, one-plugin bootstrap/provision, session-pinned launcher resolution, missing pin errors, spaces, rerun/uninstall and other harness regressions pass. Follow codex-runtime CLI in wave-5-contract.md; use stubs for parallel unit checks and describe combined-test needs. Distinguish adapter/runtime versions and retain full runtime argv. Bump launcher format only, not root version. Do not install into real user homes or publish anything.
