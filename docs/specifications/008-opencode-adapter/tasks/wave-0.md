# 008 wave 0: the plugin and bridge, and the OpenCode test fixture

Two rows in parallel, on disjoint files. Read `../spec.md` (approved 2026-10-14) and `../status.md` first, then the research the row names. Use /worker. Test first. Never run `opencode` as the agent user and never touch `~/.config/opencode`, `~/.local/share/opencode` or `~/.cache/opencode`: until 008-11's isolation check passes, real OpenCode runs only as `squeal-e2e` (`../research/README.md`, rules; the model and key handling are there too) or in CI. Spec 009's wave 0 (`../../009-pi-adapter/tasks/wave-0.md`, `src/harness/pi/`, `test/helpers/pi.ts`) solved the same problems for Pi; read it before designing anything it already solved.

## 008-10 plugin, bridge and the OpenCode package

Outcome: `plugins/opencode/` is an OpenCode plugin package whose committed bundle, loaded in Bun without `node:sqlite`, registers a session's consumer through a per-event `node` bridge with deadlines, and never holds OpenCode.

- Spec: D1 (package layout only; `install.sh` is a later row), D2, D4, D6, D8, and D3's `chat.message` registration (no delta yet), `session.deleted` and `dispose` only. Research: `opencode-plugins.md` 1, 2 and 6; `opencode-sessions-and-wake.md` 3 to 6.
- Shape: slice.
- Seam: `src/harness/opencode/` (new), modelled on `src/harness/codex/` (hook process entries) and `src/harness/pi/host.ts` (deadlines). First edit: a bridge client that spawns `node <entry>` in its own process group, writes one JSON event, and resolves `null` at its deadline with the group killed, with a test whose bridge never answers.
- Owns: `src/harness/opencode/**`, `plugins/opencode/**`, `test/harness/opencode/**`, the `build:plugin` script line in `package.json`, `scripts/check-version-bump.ts`, the CI drift line in `.github/workflows/ci.yml` (add `plugins/opencode/dist`), and one `GUARDED_WITHIN` line in `test/keys/key-sources.ts` for `src/harness/opencode/build.ts`. In `src/harness/shared/` only what D6 allows, with the Claude Code, Codex and Pi suites unchanged.
- Leaves alone: `test/fixtures/opencode/**`, `test/helpers/opencode*.ts`, `package.json` dependencies and `package-lock.json` (008-11). Do not raise the version or `KEY_FORMAT_VERSION`; the key-format pin failure your `build:plugin` edit causes is expected, and the coordinator re-pins at integration. Name it in your final message.
- Done when: unit tests show a stalled bridge gives silence within the deadline and leaves no process; a non-zero exit, bad JSON, a missing store, config or `node` are silent; a hook never throws; the fast path returns no hooks outside a Squeal repository; `chat.message` registers a root once and a child as `(root, child)`; `shell.env` sets `OPENCODE_SESSION_ID`, `OPENCODE_AGENT_ID` and `PATH`; `dispose` leaves no handle that keeps Node alive; a build test asserts `dist/plugin.mjs` imports no `node:sqlite` and loads in plain Node against a stub `client`; the bridge's per-call p50 and p95 measured and recorded with the load average (spec open question 3, against 002's 80 ms p95); lint, typecheck, `npm run build` (in your tree; do not commit `dist` drift you cannot explain) and the full suite green.

## 008-11 the scripted-provider OpenCode fixture and wave-0 checks

Outcome: a test can start the real OpenCode 1.18.35 with no credentials and no network, script the model's tool calls, and assert what reached each model request; open questions 1 and 2 are answered.

- Spec: Testing (first two bullets), open questions 1 and 2. Research: `opencode-plugins.md` 3; `opencode-sessions-and-wake.md` 4; their probes under `../research/probes/`.
- Shape: slice.
- Seam: `test/fixtures/opencode/scripted-provider.ts`, a local HTTP server speaking the OpenAI-compatible chat API (streamed) that plays planned tool calls and records every request; then `test/helpers/opencode.ts`: start OpenCode in `run` or `serve` with the provider configured in the run's `opencode.json`, every variable the isolation check names set into a temp run directory, overrides refused, and the recorded requests returned.
- Owns: `test/fixtures/opencode/**`, `test/helpers/opencode*.ts`, `test/harness/opencode-fixture.test.ts`, `package.json` `devDependencies` (`opencode-ai` and `@opencode-ai/plugin` pinned to `1.18.35`) and `package-lock.json`, `docs/specifications/008-opencode-adapter/research/wave-0-checks.md` and `research/probes/wave-0-checks/`.
- Leaves alone: `src/**`, `plugins/**`, the `build:plugin` script (008-10).
- Checks, as `squeal-e2e` only:
  1. Isolation: snapshot that user's `HOME` (paths, sizes, mtimes), run OpenCode with the fixture under `run` and `serve`, report every path written or read outside the run directory, and the set of variables that confines it. The helper skips outside CI unless the check found none; say which.
  2. Whether OpenCode loads the provider with no package fetch (no network).
  3. Open question 1: does `opencode plugin file:<dir> -g` copy the package into its cache or link it; does `file:<v2> -g --force` replace the `file:<v1>` entry in the global config; what is left of v1.
  4. Open question 2: does a text part added to `output.parts` in `chat.message` reach the model's request (a probe plugin; the scripted provider records it).
- Done when: `opencode-fixture.test.ts` scripts a `write` then a final text under `run` and `serve` and asserts the tool result reached the second request; it passes in CI on Node 22 and 24 (push your branch and report the run); `wave-0-checks.md` committed with every check tagged; lint, typecheck and the full suite green.
