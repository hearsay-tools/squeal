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

## 002-16 proof in a scratch Codex home

Outcome: evidence that the shipped Codex plugin does what spec 002's goals say, in real Codex sessions, written to a new `lessons.md` in this spec folder.

Shape: survey (proof). Use the installed Codex CLI 0.160.1 with the host's model provider, as `research/probes/codex-hooks/README.md` did: a scratch `CODEX_HOME` under `/tmp` holding a filtered copy of the provider settings and no credentials (the provider reads its key from the environment), never `~/.codex/auth.json`, never an edit under `~/.codex`. Install the plugin from this repository with `codex plugin marketplace add <this checkout>` and `codex plugin add squeal@squeal` into that `CODEX_HOME`, then trust its hooks with the hashes `squeal init --harness codex --print-launcher-config` computes, or through the TUI's `/hooks`; never `--dangerously-bypass-hook-trust`. Work on a scratch git repository with a small Vitest suite and `squeal.config.json`.

Prove, in one `codex exec` run and one app-server thread driven the way Cezar drives it (`research/probes/codex-hooks/bin/as.mjs` shows how): (1) SessionStart registers `(session_id, main)` and injects the header and primer; (2) an edit that breaks a test yields a `PASS -> FAIL` through PostToolUse in the same turn, and the fix its `FAIL -> PASS`; (3) a subagent's tool calls deliver only to `(session_id, agent_id)`, and SubagentStart gives it the header and primer; (4) the next `apply_patch` after an undelivered regression is denied once; (5) SessionEnd unregisters at `exec` end and at stdin EOF; (6) every hook exits 0 within its budget with no daemon. Also: `reviews/wave-1.md` N4 (does an internal `/review` thread fire tool hooks without `agent_id`, and what does it receive) and N5 (Stop p95 at calm load). Record what the agent did with the reports, as 001's `lessons.md` does.

Owns: `docs/specifications/002-codex-adapter/lessons.md` and throwaway probes under `docs/specifications/002-codex-adapter/research/probes/proof/` with a README. No product code. Stop every daemon you start.

Done when: `lessons.md` has a verdict, setup, one section per proof item with transcript excerpts or hook logs, and defects named and numbered; every item proven or explicitly "not shown, because".

Use /worker.
