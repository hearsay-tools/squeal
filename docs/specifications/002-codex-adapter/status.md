# 002 Codex adapter: status

Stage: approved (2026-10-07, by the human; waves on `docs/board.md`, briefs under `tasks/`)
Started: 2026-10-07

## Decisions so far

- Codex is the second harness, ahead of Pi and OpenCode, because the human's Cezar workers run on Codex today and get nothing from Squeal (ADR 0004, 2026-10-07).
- Researched and built in parallel with 003 (node:test runner). The two cross only at `squeal init` and the policy file; that seam is one later row, never a wave-1 row of either spec.
- The adapter implements `HarnessDelivery` from `src/core/types/delivery.ts` as the Claude Code adapter does. Nothing in `src/core` changes for a harness; a finding that seems to need a core change is an open question for the spec, not a decision.
- Cezar drives Codex through `codex app-server` (JSON-RPC over stdio), not `codex exec`. Both paths must work; the research says what each exposes.
- Codex has no idle wake (001 research, `claude-code-integration.md` section 7, docs only). The vision accepts pull at the next turn; whether any channel wakes an idle Codex session is a research question, not a goal.

## Amendments after approval

- 2026-10-07, at approval: open questions 1 to 3 are the wave-0 research row 002-11; 4 waits for a host where bubblewrap works; 5 is measured in dogfooding; 6 (a policy-gated `codex queue` wake) stays with the human and is not planned.

- 2026-10-07, wave 0 (002-10): the harness-neutral hook logic is `src/harness/shared/` (context, ensure, sweep, primer, text, deliver, deny, prompt, session, stop, waiter, hook); the Claude Code hooks keep their stdin fields, output shapes, fork detection and every `CLAUDE_*` read. No behaviour change; bundles rebuilt as 0.1.15.
- 2026-10-07, wave 0 (002-11, `research/wave-0-checks.md`): D1, D4 and goal 6 amended. The Codex plugin has its own `.agents/plugins/marketplace.json`; commands are one string with `${PLUGIN_ROOT}` literal; the fast path tests `$PWD` and never `CLAUDE_PROJECT_DIR`; plugin trust survives a version raise and a test pins the `hooks.json` hashes; `--print-launcher-config` emits `hooks.state` from a ported hash. SessionEnd at TUI exit is not guaranteed when the TUI's thread lives in Codex's managed daemon, so goal 6 leaves the TUI to expiry. Open questions 1 to 3 closed; row 002-17 added for trust through `config/batchWrite`.
- 2026-10-07, before wave 1 (coordinator): D2 amended. No `harness` field on the consumer record: nothing reads it, and it would be a schema step.

- 2026-10-07, wave 1 (002-12, 002-13), 0.1.16: the Codex plugin ships. `src/harness/build.ts` builds both plugins (hook entries, CLI pair, versions, the node:test runtime into `dist/node-test/`, and for Codex the skill copy); every bundle carries a `createRequire` banner for CommonJS dependencies (agreed with 003-12). `plugins/codex/hooks/hooks.json` passes `--disable-warning=ExperimentalWarning` to every `node`, decided before any user trusted the hooks, so `node:sqlite` never writes to a hook's stderr on Node 22. Decided by the workers and accepted: Stop with `stop_hook_active` ends the turn and delivers nothing, so news is never marked delivered unseen; UserPromptSubmit registers a missing consumer; the 8,000-character cap applies to the model-visible text; `--print-launcher-config` keys groups at index 0 and assumes no earlier launcher hook for the same event; the status line is human output only. Open for review 002-14: SubagentStart registers silently, so a Codex subagent gets no header or primer (D3 gave the event no output; whether Codex takes `additionalContext` there is untested); the 80 ms p95 was not measured at calm load (166 to 512 ms at load 70).

- 2026-10-07, review 002-14 (`reviews/wave-1.md`, PASS at 626b616): no blocker. S2 amends D3, SubagentStart injects the header and primer, `hooks.json` unchanged so no re-trust. S1 (the status line names a cause it cannot know), S3 (drift test timeout and Buffer comparison), N1 to N3 (launcher path and private marketplace source in the README, SessionEnd sweeping every location) are row 002-18; N4 (internal review threads with no `agent_id`) and N5 (Stop p95 76 ms against 80) are watched in 002-16. Latency verified: every Codex hook under 80 ms p95 at load 3.9, fast path 3.1 ms.

- 2026-10-07, wave 2 (002-18, 002-15), 0.1.19: SubagentStart injects the header and primer (D3 as amended); the status line names no cause it cannot know, and the optional silent PreToolUse registration was not taken, since it would register a consumer before it hears the primer; N3 accepted: Codex SessionEnd sweeps only its `cwd` (Codex gives it nothing else, `CLAUDE_PROJECT_DIR` is foreign there, the rollout format is unverified), and the next SessionStart sweep or expiry catches a consumer left in another repository. The e2e suite runs every scenario for both plugins, Codex hooks through `bash -c` from the archived `hooks.json` in the thread's `cwd`; the one Codex skip is `bin/squeal`, which Codex does not ship (D1). `squeal init --harness codex` seeds `nodeTest` like `squeal init`.

- 2026-10-07, decided by the human: build the trust command (row 002-17, `squeal init --harness codex --trust`), and install the plugin into the real `~/.codex` with its hooks trusted for dogfooding with a Cezar Codex worker (row 002-19). The coordinator orders 002-19 after 002-16's scratch proof and 002-17, so a defective plugin never reaches every Codex session on the machine.

- 2026-10-07, 002-17, 0.1.22: `squeal init --harness codex --trust [--yes]` lists the Squeal hooks Codex has not trusted (untrusted or modified), asks one yes/no question (default no; no terminal and no `--yes` changes nothing and exits 1), and on yes has Codex trust exactly those through app-server `config/batchWrite`; Squeal opens no file under `CODEX_HOME`. A live test installs the plugin from the checkout into a scratch `CODEX_HOME` and shows every hook trusted with no bypass flag. Row 002-20 filed for an intermittent Codex transitions e2e failure.

- 2026-10-07, 002-16 (`lessons.md`): the plugin works in real Codex sessions: six proof items proven under `codex exec` and app-server threads driven as Cezar drives them, 142 hook runs with none failed or timed out and the slowest 375 ms; no agent ran Vitest itself, each re-issued a denied edit. Defects 1 (symlinked `node_modules`) and 3 (a hung daemon is silent at the boundary) are core, rows 001-111 and 001-112 of the other coordinator. Defect 2 amends D2: an inline `/review` thread carries the parent's `session_id` and no `agent_id`, and only its `transcript_path` file name (ending in its own thread id) and `turn_id` differ, so a hook whose transcript file name does not end in the `session_id` is not a consumer (row 002-21). N5 not measured at calm load (load 7 to 41; Stop p95 74 to 86 ms at load 9 to 17). Note for 002-19: the TUI's managed app-server downloaded and ran Codex 0.161.0.
- 2026-10-08, 003-24's S2 bound and 002-21 decided by the coordinator; 002-19 waits for 002-21.

- 2026-10-08, 002-21 (0.1.24): a Codex hook with no `agent_id` whose `transcript_path` file name does not end in `<session_id>.jsonl` is answered silently before any store is opened, in `runCodexHandler`, so every entry is covered; the recorded `/review` payloads are fixtures. 002-20: the Codex transitions flake is a product race, not the harness. `buildSnapshot`, `squeal status --wait` and Stop's wait read the revision and the known states without one read transaction, so under load a status can pair a new revision with the previous revision's states (12 of 12 with a widened window; 1 of 12 had `runnerPartPending` already false, so a harness check would not close it). Relayed to the 001 coordinator with the opt-in red test `test/e2e/torn-status.test.ts` (`SQUEAL_PROBE_TORN_STATUS=1`).

- 2026-10-08, 002-19 started (approved by the human 2026-10-07): the Codex plugin 0.1.24 installed into the real `~/.codex` from the main checkout `/home/agent/projects/squeal` with `codex plugin marketplace add` and `codex plugin add squeal@squeal`, its hooks trusted with `squeal init --harness codex --trust --yes`; a Cezar Codex worker does row 003-27 as the dogfooding task. Uninstall: `codex plugin remove squeal@squeal`.

- 2026-10-08, 002-20 closed at 0.1.27: with 001-116's read transactions on main, the opt-in probe `SQUEAL_PROBE_TORN_STATUS=1 npx vitest run test/e2e/torn-status.test.ts` passes (it widens the window that failed 12 of 12 before), and `test/e2e/transitions.test.ts` passed 10 times with a second copy running beside each, 20 runs and 80 test executions, at load 4.6 to 7.5. Not repeated at the load 20 to 100 where the flake was first seen; the probe is the deterministic evidence.

- 2026-10-08, 002-19 (`lessons.md` "Dogfooding with a Cezar Codex worker"): a real Cezar Codex worker (gpt-6.1-sol, row 003-27) ran with the plugin installed and trusted in the real `~/.codex`. Goals 1, 2, 4, 6 and 8 held, 3, 5 and 7 were not exercised (no regression, Cezar forbids subagents, no hook timing is recorded in a Cezar session), none broke. The agent read the skill on its own but still ran Vitest three times, since Squeal's first result for its new test took 2 min 7 s on a cold baseline at load 80 and its brief required the full suite. Defects: 4, `squeal` is not on a Codex agent's PATH while the primer tells it to run `squeal status --wait` (D1 amended; row 002-22); 5, tests that load sources or plugins in a child process kept stale results in this repository (its `squeal.config.json` declares those inputs now); 6, the Claude Code latency test dies at its own timeout under load (row 002-22).

- 2026-10-08, 002-22 (0.1.29): under Codex the primer, a FAIL report's `why` line, the status pointer and the `requireFullSuite` Stop reason name `node "<PLUGIN_ROOT>/dist/cli/squeal.mjs"` (the running bundle's sibling when `PLUGIN_ROOT` is absent), through an optional `HookDeps.command` that defaults to `squeal`, so every Claude Code text is unchanged; the Codex copy of the skill gains one line saying the same. Both latency tests run one round of 5 cold runs per hook above load 4 or in CI and report, asserting only below the threshold. `hooks.json` unchanged, so no re-trust.

## Research

Complete 2026-10-07: `research/codex-hooks.md`, `research/codex-sessions-and-wake.md`, every question tagged, experiments on Linux only. The spec is written from these files.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `../../decisions/0003-delivery-model.md`, `../../decisions/0004-codex-and-node-test-next.md`
- Prior findings: `../001-core-loop/research/claude-code-integration.md` (section 7), `../001-core-loop/research/pull-advances-push.md` (question 4), `../001-core-loop/research/daemon-under-harnesses.md`
- Spec 001 D9, the Claude Code adapter this one mirrors: `../001-core-loop/spec.md`
