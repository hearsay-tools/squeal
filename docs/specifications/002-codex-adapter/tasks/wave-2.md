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

## 002-17 trust through Codex

Outcome: `squeal init --harness codex --trust` shows the user the Squeal hooks Codex has not trusted and, on their yes, has Codex trust them, so no `/hooks` step is needed. Approved by the human 2026-10-07.

Read: spec 002 D1 (trust) and goal 8; `research/wave-0-checks.md` finding 3 and its probes `bin/as-trust.mjs` and `logs/q3-trust-api.txt` (the exact protocol: `initialize`, `initialized`, `hooks/list` with `cwds`, then `config/batchWrite` with `keyPath: hooks.state."<key>".trusted_hash`, `value: currentHash`, `mergeStrategy: "replace"`, `reloadUserConfig: true`); `src/cli/codex/init.ts`, `launcher.ts`, `hash.ts`.

Shape: slice. Test first. Seam: a new `src/cli/codex/trust.ts` that spawns `codex app-server` from the worktree root (`CODEX_HOME` and `PATH` as the user's environment has them), lists the hooks whose `pluginId` is `squeal@squeal`, and returns the untrusted or modified ones with event, command and `currentHash`. `initCodex` with `--trust`: after its usual output, print those hooks; on a terminal ask one yes/no question (default no); `--yes` answers yes without asking; with no terminal and no `--yes`, print and exit 1 changing nothing. On yes, one `config/batchWrite` for exactly those hooks, then list again and print each hook's new status. Codex writes its own config; Squeal never opens a file under `CODEX_HOME`. Plugin not installed: say so with the two install commands, exit 1. `codex` not on `PATH`, or app-server failing or silent for 10 s: one line, exit 1. Kill the app-server on every path.

Owns: `src/cli/codex/trust.ts`, the `--trust` and `--yes` wiring in `src/cli/codex/init.ts` and `src/cli/main.ts` (its usage text), `test/cli/codex-trust.test.ts`, a section in `plugins/codex/README.md`, the `init` line in `plugins/claude-code/skills/squeal/references/commands.md`. Leave alone: `hooks.json` (pinned), `src/harness/**`, `src/core/**`, `src/runners/**`.

Done when: unit tests against a stub app-server (a script speaking the JSON-RPC lines) cover yes, no, `--yes`, no terminal, nothing to trust, plugin missing, `codex` missing, a silent app-server; a live test, skipped when `codex` is not on `PATH`, installs the plugin from this checkout into a scratch `CODEX_HOME` with `codex plugin marketplace add` and `codex plugin add`, runs `--trust --yes`, and shows every Squeal hook `trusted` in `hooks/list`, with the scratch `CODEX_HOME/config.toml` changed only by Codex, a scratch `HOME/.codex` untouched, and no bypass flag anywhere; lint, typecheck, full suite green. Never touch the real `~/.codex`. Do not run `npm run build`.

Use /worker.

## 002-21 inline `/review` threads are not consumers

Outcome: a Codex thread that runs under the main agent's `session_id` without an `agent_id`, such as an inline `/review`, never takes, marks or blocks on the main agent's reports.

Read: `lessons.md` defect 2 and its N4 section (the field table), spec 002 D2 as amended, `src/harness/codex/` (input, handlers, hook), 001 D9 on forks.

Shape: repair. Seam: `src/harness/codex/input.ts`, one predicate `isUnservedThread(input)`: `agent_id` absent, `transcript_path` present, and its file name not ending in `<session_id>.jsonl`. Then every handler returns no output and touches no store for such an input (UserPromptSubmit, PreToolUse, PostToolUse, Stop, SessionStart, SessionEnd, Interrupt). Fixtures under `test/fixtures/codex-hooks/review/` built from `research/probes/proof/logs/n4inline2.stdin.jsonl` (trim prompts).

Owns: `src/harness/codex/**`, `test/harness/codex/**`, `test/fixtures/codex-hooks/**`. Leave alone: `src/harness/shared/**` and `src/core/delivery/**` (the other coordinator's 001-112 is running there), `plugins/**`, `test/e2e/**` (002-20).

Done when: with an undelivered `PASS -> FAIL` for `(session_id, main)`, the review thread's recorded UserPromptSubmit, PreToolUse on `apply_patch` and PostToolUse print nothing and leave it undelivered, and the main thread's next PostToolUse delivers it; a main-thread input without `transcript_path` behaves as today; the bundled hooks' p95 test is unchanged; lint, typecheck, full suite green. Do not run `npm run build`.

Use /worker.

## 002-20 Codex transitions e2e flake

Outcome: `test/e2e/transitions.test.ts` for Codex passes under load, with the cause of its intermittent failure named.

Read: the board row, `attachments/codex-transitions-flake.txt`, `test/e2e/harness.ts` (`settle`, `edit`), `test/integration/node-test.test.ts` `settle` (fixed in 0.1.22 for the same shape), 001 D2 on `runnerPartPending`.

Shape: repair. Reproduce first: run the file under load (for example several copies of the suite or a CPU burner beside it) until the Codex case fails, and record what the store holds at that moment (revisions, runs and their revisions). Then fix the cause in the harness if it is the harness, and name it; if it is the product, stop and report to the coordinator with the evidence instead of fixing.

Owns: `test/e2e/**`. Leave alone: everything under `src/` and `plugins/`.

Done when: the cause is named with evidence; the Codex and Claude Code transitions cases pass 10 times in a row under load; lint, typecheck, full suite green.

Use /worker.

## 002-19 dogfooding report

Outcome: a section "Dogfooding with a Cezar Codex worker" in `lessons.md` that says, with evidence, what Squeal told a real Cezar Codex worker and what the worker did with it.

The session: on 2026-10-08 the Codex plugin 0.1.24 was installed into the real `~/.codex` and trusted (`status.md`). A Cezar worker on `--backend codex --model gpt-6.1-sol` then did row 003-27 in worktree `/home/agent/projects/squeal/.ai/cezar/worktrees/c7896f0e-662d-4172-adaf-81b907da8afe` (removed since), Squeal worktree id `b2baa0c8131a6dc2`, Codex thread `01a1188e-2475-7030-aa81-c1396f0402c1`, from 00:48 to about 01:00 local time, at load 66 to 85.

Sources, read only: the Codex rollout `~/.codex/sessions/2026/10/08/rollout-2026-10-08T00-48-51-01a1188e-2475-7030-aa81-c1396f0402c1.jsonl`; Cezar's run log `/home/agent/projects/squeal/.ai/cezar/runs/c7896f0e-662d-4172-adaf-81b907da8afe.ndjson` and its `-artifacts/`, `.handoff.md`, `.facts.json`; the shared store `/home/agent/projects/squeal/.git/squeal/store.sqlite` opened read-only (`consumers`, `revisions`, `runs`, `results`, `meta` rows for that worktree id). Never open `~/.codex/auth.json` or `config.toml`, never write the store.

Shape: survey. Answer: (1) every Squeal text the model received (SessionStart header and primer, PostToolUse deltas, denies, Stop blocks, "Not validated" lines), each with its time and the tool call it followed; (2) what the agent did next each time, and whether it ran the tests itself and why (it was told to run the full suite by its brief: say whether Squeal's reports changed what it ran); (3) hook latencies the rollout or store show; (4) anything false, late, repeated or missing, against spec 002 goals 1 to 8; (5) defects, numbered after the existing ones. Short transcript excerpts, trimmed, no secrets.

Owns: `docs/specifications/002-codex-adapter/lessons.md` (a new section only) and throwaway extraction scripts under `research/probes/dogfood/` with a README. No product code.

Done when: the section has a verdict per goal (held, not shown, broken), the excerpts that prove it, and the defects; committed.

Use /worker.

## 002-22 a Codex agent can run Squeal; latency tests report under load

Outcome: every Squeal text a Codex agent receives names a command that runs in its shell, and the two bundled-hook latency tests always report.

Read: `lessons.md` "Dogfooding with a Cezar Codex worker", defects 4 and 6; spec 002 D1 as amended 2026-10-08; `src/harness/shared/primer.ts`, `src/harness/codex/output.ts` (the primer tail and the cap), where the FAIL report's `Full output: squeal why ...` line is built (`src/core/delivery/format.ts` or the shared hooks), `plugins/codex/skills/squeal/` (built from `plugins/claude-code/skills/squeal/` by `src/harness/codex/build.ts`).

Shape: repair. Seam: make the CLI command a parameter of the texts, with `squeal` as the Claude Code default (its plugin puts `bin/squeal` on PATH) and, under Codex, `node "<PLUGIN_ROOT>/dist/cli/squeal.mjs"` from the hook's `PLUGIN_ROOT`, quoted for a shell; when `PLUGIN_ROOT` is absent, fall back to the path of the running bundle's sibling `cli/squeal.mjs`. The skill under Codex: the build rewrites `squeal ` command examples in its copy to say "the command the primer names", or adds one line saying so; pick the smaller change and say why. Then defect 6: each latency test runs fewer cold runs when the load is above its threshold and returns its table well inside its timeout; it asserts only below the threshold, as now.

Owns: `src/harness/codex/**`, `src/harness/shared/primer.ts` and the one place the `squeal why` line is formatted (additive parameter only), `src/harness/codex/build.ts`, `test/harness/codex/**`, `test/harness/latency.test.ts` (the 001 coordinator's file, test only; its session had ended, so taken here), `test/harness/primer*.test.ts`. Leave alone: `plugins/codex/hooks/hooks.json` (its hashes are pinned; no command changes), `src/core/scheduler/**`, `src/runners/**`.

Done when: a recorded Codex SessionStart's primer, run in `bash -c` from a directory with no `squeal` on PATH and `PLUGIN_ROOT` set to a built plugin, names a command that prints status; a Codex FAIL report's last line likewise; every Claude Code text byte-identical to today (their tests unchanged); both latency tests finish inside their timeouts with a parallel load of 2 extra suite copies and still assert below the threshold; the hooks.json hash pin test passes unchanged; lint, typecheck, full suite green. Do not run `npm run build`.

Use /worker.
