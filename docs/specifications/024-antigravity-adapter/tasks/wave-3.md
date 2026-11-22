# Spec 024 Wave 3: end-to-end suite and bundled Node hook latency (row 024-07)

Read first: `docs/process.md`, `docs/styleguide.md`, `docs/specifications/024-antigravity-adapter/spec.md`, `docs/specifications/024-antigravity-adapter/status.md`, `docs/specifications/024-antigravity-adapter/reviews/0.1.603.md` ("Inputs for the next wave"), and `test/e2e/{plugins.ts,harness.ts,shipped-plugin.test.ts,transitions.test.ts,policy.test.ts,lifecycle.test.ts,worktrees.test.ts}` plus `test/harness/codex/latency.test.ts`.

## Row 024-07: End-to-end suite and Node hook latency

### Goal
Prove the committed `plugins/antigravity/` tree end to end against a real Squeal daemon and real Vitest fixture, using recorded `test/fixtures/antigravity-hooks/*.json` payloads and executing the exact commands from `plugins/antigravity/hooks.json` with `cwd = <plugin-root>` (matching Antigravity's real plugin hook runner), plus add the bundled Node hook latency test (`< 80 ms` p95 at calm load).

### File ownership
- `test/e2e/plugins.ts`
- `test/e2e/harness.ts`
- `test/e2e/shipped-plugin.test.ts`
- `test/e2e/transitions.test.ts`
- `test/e2e/policy.test.ts`
- `test/e2e/lifecycle.test.ts`
- `test/e2e/worktrees.test.ts`
- `test/e2e/antigravity.test.ts` (new)
- `test/harness/helpers.ts` (only if `hookText` needs to read Antigravity's `injectSteps[0].systemMessage.systemMessage` shape)
- `test/harness/antigravity/latency.test.ts` (new)
- `test/harness/antigravity/helpers.ts` (if shared build helper is needed for latency test)
- `test/version-sensitive.txt` (only if `test/version-sensitive.test.ts` requires an entry/exemption for a new file)

Do NOT edit `src/`, `plugins/`, `package.json`, `docs/board.md`, or run `pnpm run build`. If a test exposes a real product defect in `src/` or `plugins/`, stop and message the coordinator with the reproduction before touching product code.

### Requirements

1. **`test/e2e/plugins.ts` and `test/e2e/harness.ts`**:
   - Add `ANTIGRAVITY` (`name: "antigravity"`, `boundary: "PreInvocation"`, `editTool: "write_file"`, `bin: false`, `init: ["init", "--harness", "antigravity"]`) and `antigravityEnvironment(copy)` (isolated `HOME`, `PLUGIN_ROOT: copy`, `PLUGIN_DATA: <copy>.data`, `PATH` with `dirname(process.execPath)` first, no `CLAUDE_*`/`CODEX_*`).
   - Run Antigravity hooks via `sh -c <command>` with `cwd = copy` (the plugin root, matching spec 024 D4) using the exact command strings from `<copy>/hooks.json` (so `./hooks/run` and `./hooks/run --if-squeal` execute for real), passing recorded `test/fixtures/antigravity-hooks/*.json` with `cwd: root` and `workspacePaths: [root]` (and mapping `{ session_id }` override to `conversationId` when scenarios pass `session_id: OTHER_SESSION`).
   - Map scenario `HookName`s cleanly:
     - `"session-start"` -> `SessionStart` (`session-start.json`)
     - `"post-tool-batch"` -> `PreInvocation` (`pre-invocation-after-tools.json`, `invocationNum: 1`)
     - `"pre-tool-use"` -> `PreToolUse` (`pre-tool-use-write-file.json`)
     - `"stop"` -> `Stop` entry 0 (`stop.json`); also expose a helper or event option for `stop-slow` (`Stop` entry 1) and `pre-invocation-first` (`invocationNum: 0`) for Antigravity-specific tests.
     - `"session-end"` -> Antigravity has no `SessionEnd` hook (spec 024 D2); return silent `{ stdout: "", stderr: "", code: 0, ms: 0 }` so shared cleanup and `shipped-plugin.test.ts` work cleanly.
   - Parse Antigravity's JSON output in `E2E.hook` (and `hookText` in `test/harness/helpers.ts`):
     - `injectSteps[0].systemMessage.systemMessage` -> `text`
     - `{ decision: "deny" | "continue", reason }` -> `text = reason`, and preserve `json.decision`.
   - Keep `PLUGINS = [CLAUDE_CODE, CODEX]` unchanged so the unrelated runner-matrix e2e files do not multiply CI runtime by 1.5x; export `ALL_PLUGINS = [...PLUGINS, ANTIGRAVITY]` (or `PLUGINS_WITH_ANTIGRAVITY`) and parametrize the five core harness e2e files over it:
     - `test/e2e/shipped-plugin.test.ts` (note: check `hooks.json` at plugin root for `antigravity` vs `hooks/hooks.json` for `claude-code`/`codex`, and keep `antigravity` using `bundled` runtime).
     - `test/e2e/transitions.test.ts`
     - `test/e2e/policy.test.ts` (handle both `json.hookSpecificOutput?.permissionDecision === "deny"` and Antigravity's `json.decision === "deny"`, and `json.decision === "block" | "continue"` for `Stop`).
     - `test/e2e/lifecycle.test.ts`
     - `test/e2e/worktrees.test.ts`
   - In `E2E.cleanup()` (`test/e2e/harness.ts`), ensure any Antigravity daemon spawned from `<PLUGIN_DATA>/versions/<version>/dist/cli/squeal.mjs` is ALSO cleanly stopped and killed (check `FixtureCli` / `cliIdentity` so no leaked daemon fails `afterAll`!).

2. **`test/e2e/antigravity.test.ts` (new, real daemon + archived committed `plugins/antigravity`)**:
   - **D1 `$PLUGIN_DATA` version copy survival**: run `SessionStart` with `PLUGIN_ROOT` and `PLUGIN_DATA`, confirm the copy exists at `<PLUGIN_DATA>/versions/<version>/` and `<PLUGIN_DATA>/bin/squeal`, confirm the running daemon's command line is inside `<PLUGIN_DATA>/versions/<version>/dist/cli/squeal.mjs`, delete `PLUGIN_ROOT` entirely (simulating an in-place plugin replacement), and confirm the daemon still validates an edit, `PreInvocation` still delivers `PASS -> FAIL` (via the retained copy or restored plugin), and `<PLUGIN_DATA>/bin/squeal status --json` succeeds.
   - **D3 sequential `Stop` -> `stop-slow` slow hold and guards**: with a slow fixture (`slow: true`), verify:
     - When `fullyIdle: false`, `stop` stays silent and writes no handoff, and `stop-slow` exits immediately with empty stdout (does not hold).
     - When `terminationReason: "USER_CANCELED"`, `stop` stays silent and `stop-slow` exits immediately.
     - On a normal silent `stop` (`fullyIdle: true`, `terminationReason: "NO_TOOL_CALL"`) with a failing/running slow check under `stop.holdSlow` / `stop.blockOnKnownFailures`, `stop` writes the handoff and exits silently, then `stop-slow` waits and emits `{"decision":"continue","reason":...}`.
     - After continuation (`executionNum: 1`), `stop` suppresses repeat news/non-required blocks.
   - **D2 subagent consumer isolation**: two distinct `conversationId`s in one worktree register independently and receive independent `PASS -> FAIL` deliveries and edit denies.
   - **D3/D8 `PreToolUse` `run_command` opt-in deny**: with `testCommand.denyWhenCurrent: true`, a current test command in `CommandLine` is denied once (`{"decision":"deny","reason":...}`), and a non-test command or repeated call emits empty stdout (never `{}`).
   - **D6 `squeal status` unregistered diagnostic**: running the shipped CLI with `ANTIGRAVITY_CONVERSATION_ID` for an unregistered conversation appends the `Antigravity:` line with the install command.
   - **D1 live `plugin validate --json`**: when `antigravityCli(process.env)` is found, run `<cli> plugin validate --json <archived-copy>` in an isolated `HOME` and assert `components: { hooks: 1, skills: 1 }` and 0 errors / 0 warnings.

3. **`test/harness/antigravity/latency.test.ts` (new, spec 024 goal 7)**:
   - Mirror `test/harness/codex/latency.test.ts`: 50 files x 10 checks seeded store, live socket, best of up to 3 rounds of 20 cold runs at calm load (`loadavg()[0] <= 4 && !process.env.CI`), asserting `< 80 ms` p95 for `session-start`, `pre-invocation` (first, after-tools delivering, after-tools silent), `pre-tool-use` (edit denying, `run_command` silent), and `stop` (delivering, silent). Above load 4 or in CI, report the table and do not assert.
   - Build or run the bundled entries cleanly (either building into a temp dir as `buildCodexBundles()` does, or running `plugins/antigravity/dist/`).

### Verification
- Run targeted Vitest on:
  - `test/harness/antigravity/latency.test.ts`
  - `test/e2e/antigravity.test.ts`
  - `test/e2e/shipped-plugin.test.ts`
  - `test/e2e/transitions.test.ts`
  - `test/e2e/policy.test.ts`
  - `test/e2e/lifecycle.test.ts`
  - `test/e2e/worktrees.test.ts`
  - `test/version-sensitive.test.ts`
  - `test/policy/repository-inputs.test.ts`
- Pass `SQUEAL_ANTIGRAVITY_BIN` pointing to an Antigravity CLI (when available on the host under `$HOME/.local/share/hearsay-squawk/tools/antigravity/`) when running `test/e2e/antigravity.test.ts` to verify live validation too (never hardcode any home path in any file!).
- Run `pnpm run lint`, `pnpm run typecheck`, and `pnpm run check:private origin/main HEAD`.
- Do NOT run a full test suite or `squeal run --all`.
