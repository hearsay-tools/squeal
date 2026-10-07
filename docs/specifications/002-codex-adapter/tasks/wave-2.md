# 002 wave 2 briefs

Both rows run in parallel with 003 wave 2 and with another coordinator's 001 wave 11 (001-104, 001-105 in `src/core/keys/`, `src/core/scheduler/lockfiles.ts`, `src/runners/vitest/`): stay out of those. Read `docs/vision.md`, `docs/styleguide.md`, the spec as amended, `status.md` and `reviews/wave-1.md` first. Do not run `npm run build`; the coordinator rebuilds at integration.

## 002-18 review follow-ups

Outcome: the Codex adapter says only true things in `squeal status` and tells subagents what the main agent hears.

Shape: repair. Seam: `src/cli/codex/status.ts:24-32` (S1), then `src/harness/codex/handlers.ts:89-93` and `output.ts:33` (S2: SubagentStart returns `additionalContext("SubagentStart", ...)` with the text `startSession` returns, within the 8,000-character cap), then `expectSameFiles` in `test/harness/bundle-helpers.ts` (S3: `Buffer.equals` with the file name in the message, the `BUILD` timeout on the Codex drift test), then N1 and N2 as two README lines, N3 (SessionEnd passes every location the Claude Code adapter passes to `endSession`).

Owns: `src/cli/codex/**`, `src/harness/codex/**`, `test/cli/codex*.test.ts`, `test/harness/codex/**`, `test/harness/bundle-helpers.ts`, `test/harness/plugin.test.ts` (timeout only), `plugins/codex/README.md`. Leave alone: `plugins/codex/hooks/hooks.json` (its hashes are pinned and must not change), `src/harness/shared/**`, `src/core/**`, `test/e2e/**` (002-15).

Done when: the review's S1 sequence (session-start, user-prompt-submit, pre-tool-use on `Bash` with no store, then `CODEX_SESSION_ID=<id> squeal status`) prints no claim that the hooks did not run; a recorded SubagentStart returns the header and primer; the hash pin test passes unchanged; lint, typecheck, full suite green.

Use /worker.

## 002-15 e2e over both plugins

Outcome: the end-to-end suite runs the shipped Codex plugin the way it ships, beside the Claude Code one.

Shape: slice. Seam: `test/e2e/harness.ts`, where `git archive HEAD plugins/claude-code` unpacks the plugin and hook bundles are driven by recorded JSON. Parametrize the plugin (directory, entry names, recorded inputs from `test/fixtures/codex-hooks/`, the env each harness sets: Codex hooks get no `CLAUDE_*` and run in the thread's `cwd`), then run transitions, lifecycle, policy and worktrees for both where the event exists. Codex has no PostToolBatch, waiter or SubagentStart output yet: map PostToolBatch scenarios to PostToolUse, skip waiter ones for Codex with a reason, and do not assert SubagentStart's output (002-18 changes it).

Owns: `test/e2e/**`, `test/fixtures/e2e/**`. Leave alone: everything under `src/`, `plugins/`, other tests.

Done when: every e2e file runs for both plugins where the scenario applies, with each Codex skip named; the Claude Code cases unchanged; green at calm load on Node 22 and 24 (nvm is installed; the committed bundles are what run).

Use /worker.
