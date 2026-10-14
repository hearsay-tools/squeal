# 009 wave 0: the extension host and the Pi test fixture

Two rows in parallel, on disjoint files. Read `../spec.md` (approved 2026-10-14) and `../status.md` first, then the research files the row names. Use /worker. Test first. Never run `pi` as the agent user and never touch `~/.pi`: until 009-11's isolation check passes, real Pi runs only as `squeal-e2e` (`../research/README.md`, rules) or in CI.

## 009-10 extension skeleton, delivery host and the Pi package

Outcome: `plugins/pi/` is a Pi package whose committed bundle registers a session's consumer through the shared code running in a worker thread, with deadlines, and never holds Pi.

- Spec: D1 (package layout only; `install.sh` is wave 1), D2, D4, D6, and D3's `session_start` and `session_shutdown` only. Research: `pi-extension-events.md` 6 and 7, `pi-sessions-and-packaging.md` 3 to 6.
- Shape: slice.
- Seam: `src/harness/pi/` (new), modelled on `src/harness/codex/build.ts` and `src/harness/shared/context.ts`. First edit: a `DeliveryHost` that posts a request to a `worker_threads` worker and resolves `null` at its deadline, with a test where the worker never answers.
- Owns: `src/harness/pi/**`, `plugins/pi/**`, `test/harness/pi/**`, the `build:plugin` script line in `package.json`, `scripts/check-version-bump.ts` and the CI drift line in `.github/workflows/ci.yml` (add `plugins/pi/dist`). In `src/harness/shared/` only what D6 names: a caller-supplied `HarnessProcess` and consumer, with the Claude Code and Codex suites unchanged.
- Leaves alone: `test/fixtures/pi/**`, `test/helpers/pi*.ts`, `package.json` dependencies and `package-lock.json` (009-11). Do not raise the version; the coordinator does at integration.
- Done when: unit tests show a stalled worker gives silence within the deadline, a dead worker is replaced, a missing store or config is silent, duplicate `session_start` registers once, `session_shutdown` unregisters and leaves no handle that keeps Node alive; `dist/extension.mjs` imports in plain Node against a stub `pi` API; the round-trip cost per call measured at calm load and recorded with the load average; lint, typecheck, `npm run build` (in your tree; do not commit `dist` drift you cannot explain) and the full suite green.

## 009-11 the fake-provider Pi fixture

Outcome: a test can start the real Pi 1.0.4 with no credentials, script the model's tool calls, and assert what reached each model request.

- Spec: Testing (first two bullets), open question 5. Research: `pi-extension-events.md` (its `probes/pi-extension-events/probe.ts` is the starting point), `pi-sessions-and-packaging.md` 4.
- Shape: slice.
- Seam: `test/fixtures/pi/fake-provider.ts`, from `../research/probes/pi-extension-events/probe.ts`'s `registerProvider` part; then `test/helpers/pi.ts`: start Pi in `-p`, `json` or `rpc` with its own temp `PI_CODING_AGENT_DIR`, `PI_OFFLINE=1`, `-e` for the fake provider and any extension under test, and return the recorded requests.
- Owns: `test/fixtures/pi/**`, `test/helpers/pi*.ts`, `test/harness/pi-fixture.test.ts`, `package.json` `devDependencies` (`@earendil-works/pi-coding-agent` pinned to `1.0.4`) and `package-lock.json`, `docs/specifications/009-pi-adapter/research/wave-0-checks.md`.
- Leaves alone: `src/**`, `plugins/**`, the `build:plugin` script (009-10).
- Isolation check (open question 5), as `squeal-e2e` only: snapshot that user's `HOME` (paths, sizes, mtimes), run Pi with the fixture and `PI_CODING_AGENT_DIR` in `-p`, `json` and `rpc`, and report every path written outside the temp dir in `research/wave-0-checks.md`. The helper skips outside CI unless the check found none; say which in your final message.
- Done when: `pi-fixture.test.ts` scripts a `write` then a final text in each mode and asserts the tool result reached the second request; it passes in CI on Node 22 and 24 (push your branch and report the run); `wave-0-checks.md` committed; lint, typecheck and the full suite green.
