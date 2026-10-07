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

## Research

Complete 2026-10-07: `research/codex-hooks.md`, `research/codex-sessions-and-wake.md`, every question tagged, experiments on Linux only. The spec is written from these files.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADRs: `../../decisions/0001-typescript-vitest-claude-code.md`, `../../decisions/0003-delivery-model.md`, `../../decisions/0004-codex-and-node-test-next.md`
- Prior findings: `../001-core-loop/research/claude-code-integration.md` (section 7), `../001-core-loop/research/pull-advances-push.md` (question 4), `../001-core-loop/research/daemon-under-harnesses.md`
- Spec 001 D9, the Claude Code adapter this one mirrors: `../001-core-loop/spec.md`
