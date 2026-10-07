# 002 wave 1 briefs

Both rows run in parallel with 003 wave 1. Read `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/002-codex-adapter/spec.md` (as amended 2026-10-07) and `status.md`, and `research/wave-0-checks.md`, first.

## Contract between 002-12 and 002-13

Entries, built by 002-12 from `src/harness/codex/entries/<name>.ts` into `plugins/codex/dist/<name>.mjs`, and named by 002-13's `hooks.json`: `session-start`, `user-prompt-submit`, `pre-tool-use`, `post-tool-use`, `stop`, `subagent-start`, `subagent-stop`, `interrupt`, `session-end`. The CLI is `plugins/codex/dist/cli/squeal.mjs`, beside `front-desk.mjs`, as in the Claude Code plugin. The skill is copied by the build into `plugins/codex/skills/squeal/`. 002-13 creates `plugins/codex/.codex-plugin/plugin.json` with `"name": "squeal"` and a `version`; 002-12's build writes the root version into it when the file exists. Neither row writes `plugins/codex/dist/` or `plugins/claude-code/dist/`: the coordinator builds at integration.

## 002-12 Codex hook entries and build

Outcome: every Codex hook event has an entry on the shared hook code, and one build produces both plugins.

Read: spec 002 D2 to D5; `src/harness/shared/` and `src/harness/claude-code/` as 002-10 left them; `research/codex-hooks.md` findings 2 to 6 and `research/probes/codex-hooks/logs/`; `research/codex-sessions-and-wake.md` findings 3 and 7.

Shape: slice. Test first.

Seam: `src/harness/codex/input.ts`, the stdin parser (`session_id`, `agent_id`, `agent_type`, `turn_id`, `cwd`, `hook_event_name`, `tool_name`, `stop_hook_active`, `source`), then `output.ts` (the D3 shapes), then the entries. The root is the stdin `cwd`; no entry reads any `CLAUDE_*` variable (Codex passes its launcher's environment through). Then move the bundling in `src/harness/claude-code/build.ts` into `src/harness/build.ts`, a function that builds one plugin (hook entries, the CLI pair, plugin versions) and copies `src/runners/node-test/runtime/*.mjs` into `<plugin>/dist/node-test/` when that directory exists (003-13 creates it); `claude-code/build.ts` keeps `REPO_ROOT` and its exports for `test/e2e` and calls the shared function, and `src/harness/codex/build.ts` does the same plus the skill copy. `npm run build:plugin` builds both.

Owns: `src/harness/codex/**`, `src/harness/build.ts`, `src/harness/claude-code/build.ts`, the `build:plugin` script in `package.json`, `test/harness/codex/**`, `test/fixtures/codex-hooks/**`, `test/harness/plugin.test.ts` and `test/harness/bundle-helpers.ts` (extend the drift check and bundle helpers to the Codex plugin). Leave alone: `src/harness/shared/**` except additive exports you need (name each), `src/core/**`, `src/cli/**`, `plugins/**`, `.agents/**`, everything 003 owns.

Done when: recorded-JSON tests for every event under `exec`, app-server and the TUI (fixtures from the research logs); PostToolUse idempotent over three calls with one transition; deny once per regression on `apply_patch`, never on `Bash`; no block when `stop_hook_active` is true; Interrupt and a silent Stop end the turn; SessionStart output within 8,000 characters; a subagent's tool events deliver only to `(session_id, agent_id)`; bundled hooks built to a temp directory (as `SQUEAL_TEST_DIST` does) exit 0 silently with no store, no config and a newer schema, p95 under 80 ms at calm load (skipped above the existing load threshold); the Claude Code recorded-JSON tests unchanged; lint, typecheck, full suite green. Do not run `npm run build`.

Use /worker.

## 002-13 plugin package, init, status and trust hashes

Outcome: the Codex plugin is installable with Codex's own commands, and Squeal says what it needs.

Read: spec 002 D1, D4, D6, goal 8; `research/wave-0-checks.md` (all of it; `probes/wave-0-checks/bin/hash.mjs` is the hash port to productize, `logs/q3-trust.txt` and `q2-launcher-hashes.txt` the recorded values); `plugins/claude-code/hooks/hooks.json` for the `sh` fast-path function `s()`; `src/cli/init.ts`, `src/cli/main.ts`, `scripts/check-version-bump.ts`.

Shape: slice. Test first.

Seam: `plugins/codex/hooks/hooks.json`. First edit: the nine contract entries, every command one string with no `args` and `${PLUGIN_ROOT}` literal, `timeout: 2` (`interrupt` and `session-end`: 3); PreToolUse and PostToolUse with matcher `*` behind `s "$PWD"` (the 001 `s()` function, called with `$PWD` only, never `$CLAUDE_PROJECT_DIR`), the rest as `node "${PLUGIN_ROOT}/dist/<name>.mjs"`. Then `plugins/codex/.codex-plugin/plugin.json` (`name: "squeal"`), `plugins/codex/README.md`, `.agents/plugins/marketplace.json` (name `squeal`, one entry `squeal` at `./plugins/codex`); `.claude-plugin/marketplace.json` stays as it is. Then `src/cli/codex/` with the hash port and `launcherConfig()`; `squeal init --harness codex` (writes `squeal.config.json` if absent, prints `codex plugin marketplace add <source>`, `codex plugin add squeal@squeal` and the `/hooks` trust step, writes nothing under `~/.codex`) and `--print-launcher-config` (hook declarations plus a `hooks.state` table, keys `/<session-flags>/config.toml:<event>:<group>:<handler>`); `squeal status` adds one line when `CODEX_SESSION_ID` is set and the store has no consumer of that session; `check:version` treats `plugins/codex/` like `plugins/claude-code/`.

Owns: `plugins/codex/` except `dist/` and `skills/`, `.agents/plugins/marketplace.json`, `src/cli/**`, `scripts/check-version-bump.ts`, `test/cli/**`, `test/harness/version-bump.test.ts`, `test/plugins/codex/**`. Leave alone: `src/harness/**` (002-12), `src/core/**`, `.claude-plugin/**`, `plugins/claude-code/**`, everything 003 owns.

Done when: a test reads `hooks.json` and asserts exactly the nine entries, the timeouts, one-string commands, and that its handler hashes equal a pinned table (a changed declaration fails it with a message that users must trust again); the hash port reproduces the recorded `currentHash` values of `logs/q3-trust.txt`; the fast-path command run under `bash -c` exits 0 with no output in 10 ms p95 outside a Squeal repository and reaches `node` inside one (a subdirectory and a linked worktree included); `--print-launcher-config` output parses as Codex `thread/start` `config`; init touches nothing under a scratch `HOME/.codex`; the status line appears only with `CODEX_SESSION_ID` set and no consumer; `check:version` fails a `plugins/codex` change without a raise; lint, typecheck, full suite green. Do not run `npm run build`.

Use /worker.
