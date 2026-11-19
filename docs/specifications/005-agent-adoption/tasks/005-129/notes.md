# 005-129 and 005-130 notes: the fixed Codex plugin's skill texts (adapter 1.0.4) and the empty lint tools reason

Wave 32 (`../wave-32.md`). One worker for both rows. No build, no runtime version raise in this worktree: the committed `plugins/*/dist` bundles and `plugins/codex-runtime/runtime.json` (its sha256 of `skills/squeal/references/commands.md`) drift until the coordinator builds.

## Row 005-129: changed sentences

`plugins/codex/skills/squeal/SKILL.md`, the description. Now word for word the description of `plugins/codex-runtime/skills/squeal/SKILL.md`.

- Before: "Use when about to run tests (vitest, npm test) or to check whether a change broke something, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the suites its primer lists as covered; this says when to wait for their results and how to read its reports."
- After: "Use before you run tests yourself, when a test fails or a SQUEAL message reports a failure, to show that a test catches a bug (fails without the fix), or to compare test results with an earlier commit, in a repository that uses Squeal (it has squeal.config.json, or SQUEAL messages appear). Squeal already runs the tests in the background; this says which checks this repository defines, what to do instead of a hand run, how to retry a failure you did not cause, and how to read its reports."

`plugins/codex/skills/squeal/SKILL.md` and `plugins/codex/skills/setup/SKILL.md`, last paragraph, one phrase each:

- Before: "Under Codex `squeal` is not on the PATH: run the command the SQUEAL primer names, or `node --disable-warning=ExperimentalWarning "<runtime>/dist/cli/squeal.mjs"` with the runtime found above."
- After: "Under Codex `squeal` is not on the PATH: run the command the SQUEAL messages name, or `node --disable-warning=ExperimentalWarning "<runtime>/dist/cli/squeal.mjs"` with the runtime found above."

No other word of the fixed plugin changed. `hooks/hooks.json` and `seed/` are untouched. The setup skill's description already equals the runtime copy's.

### Do the messages name the command? Yes

- The start message (`src/harness/shared/primer.ts`, `primer(command)`): under Codex `command` is `codexCommand(env, cli)` (`src/harness/codex/main.ts:48`, `kept.ts:44`). It names the full command in the first command (`` `<command> checks` ``). Where the path would take the message past 1,500 characters, it names no CLI and says "These are commands of the CLI SQUEAL messages name." (`UNNAMED_CLI`).
- A FAIL report's last line (`Full output: <command> why '…'`) names it too (the runtime skill's Codex note says so).
- So "the command the SQUEAL messages name" is true; "the SQUEAL primer names" referred to a text 005-128 renamed out of the agent-read texts.

### Adapter version 1.0.3 to 1.0.4

As commit `236275066`: `CODEX_ADAPTER_VERSION` in `src/harness/codex/build-adapter.ts`, `plugins/codex/.codex-plugin/plugin.json`, and the pin in `test/harness/codex/packaging/adapter.test.ts`. Amendment line added to `../../../002-codex-adapter/status.md`. No test and no `check:version` asks for a seed refresh.

New test: `test/harness/codex/packaging/skill-description.test.ts` (2 cases, `squeal` and `setup`): the fixed plugin's description equals the runtime copy's. It fails on the old fixed text. `adapter.test.ts` already compares the built plugin's skill files with the committed ones; no test compared the fixed and runtime descriptions before.

### Point 3: does Codex's hook approval depend on the skill files? No

- Trust is a hash of each handler's declaration only. `src/cli/codex/hash.ts` ports Codex 0.160.1's `hook_hash` (`codex-rs/hooks/src/engine/discovery.rs`) and `version_for_toml`: the identity is `{event_name, matcher, hooks: [{type, command, timeout, async, statusMessage?, additionalContextLimit?}]}` (`../../../002-codex-adapter/research/wave-0-checks.md` 3). The key is `squeal@hearsay:hooks/hooks.json` (`PLUGIN_KEY_SOURCE`).
- The commands use `${PLUGIN_ROOT}` unexpanded (`node --disable-warning=ExperimentalWarning "${PLUGIN_ROOT}/dist/session-start.mjs"`), so the plugin version in the cache path does not enter the hash either.
- `research/codex-sessions-and-wake.md` row 4 and line 102: a plugin's skill loads without trust.
- So by the ported code, 1.0.4 changes no trust hash, and users should not need to approve the hooks again. `adapter.test.ts` "keeps exactly ten handlers at their positions, with the committed trust hashes" passes. Caveat: the port was checked against Codex 0.160.1; a later Codex that fingerprints the whole plugin is not ruled out, and I did not run Codex. `research/wrapper-install-flow.md` 5 says "changing a bundled skill would invalidate wrapper trust"; that sentence is about the wrapper design, and its source is not cited there. The human's approval of "one off hooks approval" therefore covers a cost that, by our code, may not occur.

## Row 005-130: changed sentences

`src/cli/checks-text.ts`, `never()`: with lint on and `lint.tools` empty, a lint check's line now reads:

- Before: "Runs: never: a check above it owns each of its tools"
- After: "Runs: never: lint.tools is empty (squeal.config.json)"

Its `Selects` line stays "lint, every tool in lint.tools". New CLI case in `test/cli/checks.test.ts`: "says a lint check never runs when lint.tools is empty".

`references/commands.md` line 19, in all three runtime copies (`plugins/claude-code`, `plugins/codex-runtime`, `plugins/pi`), because its list of reasons became incomplete:

- Before: "`never`, with the reason, for a lint check Squeal does not run (lint off, or checks above it own its tools), which then has no run command."
- After: "`never`, with the reason, for a lint check Squeal does not run (lint off, no lint tools, or checks above it own its tools), which then has no run command."

No `SKILL.md` body and no start message changed.

## Checks

- `pnpm run lint`: "Checked 3751 files in 1306ms. No fixes applied."
- `pnpm run typecheck`: exit 0.
- `pnpm run check:version origin/main`: "version bump: plugins/codex-runtime changed but package.json version 0.1.565 is not greater than 0.1.565: bump the patch version so installed plugins update", exit 1. That is the runtime raise the coordinator does. `versionBumpProblem` collects every problem and prints them all; no adapter problem is printed, so the adapter rule (1.0.3 → 1.0.4) is satisfied.
- `squeal status --wait 600000 <changed paths>` at revision 6, after 601 s: 149 pass (`test/cli/checks.test.ts` among them), 178 queued for CPU (host busy), 4 known failures, all build drift expected without a build:
  - `test/harness/codex/runtime-release/limits.test.ts`: "runtime file skills/squeal/references/commands.md does not match its sha256" (`plugins/codex-runtime/runtime.json`, rebuilt by the build).
  - `test/harness/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`: "cli/squeal.mjs differs from the build" (bundles carry `checks-text.ts`).
- Direct runs, one at a time with `timeout 900`, because the queue waited for CPU: `pnpm exec vitest run test/harness/codex/packaging/skill-description.test.ts` 2 passed; `pnpm exec vitest run test/harness/codex/packaging/adapter.test.ts` 8 passed.

## For the coordinator

- The build must refresh `plugins/codex-runtime/runtime.json` and every CLI bundle; the four failures above should then pass.
- `plugins/codex` committed files are hand edits; `build:codex-adapter` copies them, and `adapter.test.ts` compares the build with them.
