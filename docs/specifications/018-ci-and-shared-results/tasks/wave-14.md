# Spec 018 wave 14: Squeal on Node 26

The human, 2026-11-11: "Node 26: Yes". Row 018-36.

## 018-36 Squeal's tests pass on Node 26, and CI runs them there

Use /worker. Shape: repair.

Outcome: the tests that fail only on Node 26 pass there for a product reason fixed (or a test assumption corrected, said which), and Squeal's CI runs the suite on Node 26.

Evidence (this host, Node 26.13.0; they pass on Node 24.22.1): `test/daemon/handover.test.ts`, `handover-gap`, `handover-tier`, `step-down`, `step-down-keeps` ("the successor serving not met in 60000 ms"); `start-short`, `start-handoff` ("expected null to match object { squealVersion }"); `resumed-after-signal` ("held at store-open not met", "A daemon is starting" missing); `test/runners/vitest/harness.test.ts` "CI still re-keys"; `test/runners/vitest/observe-fidelity.test.ts` (ERR_INVALID_PACKAGE_CONFIG). Row 018-30 already taught `squeal ps` the Node 26 thread name `node-MainThread` (`src/core/ps/reads.ts` NODE_COMMS); look for other places that read a process's name or `/proc` fields the same way.

Starting seam: run `test/daemon/start-short.test.ts` on both Nodes (`/home/agent/.nvm/versions/node/v24.22.1/bin/node node_modules/vitest/vitest.mjs run <file>` and the v26.13.0 binary) and find where the daemon record comes back null.

Items, each with the failing test first named: one cause per commit; the CI job: one job that runs the full suite on Node 26 for `main` and `cand/**` pushes, with its added minutes stated in the commit message.

Owns: `src/core/daemon/*`, `src/core/ps/*`, `src/runners/vitest/*` for the two runner tests, those tests, `.github/workflows/ci.yml`. Leave alone: `src/core/shared/*`, `src/core/status/*`, `ci/`.

Done when: the listed files pass on Node 26 and still on Node 24 (direct runs with explicit paths, both binaries); lint, typecheck. No build, no full suite locally.
