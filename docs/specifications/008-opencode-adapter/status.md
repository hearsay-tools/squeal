# 008 OpenCode adapter: status

Stage: approved (2026-10-14, the human); waves on `docs/board.md`, briefs under `tasks/`.
Started: 2026-10-14

## Decisions so far

- 2026-10-14, the human: start working on OpenCode support. The board's Later list paired Pi and OpenCode as one spec; this spec is OpenCode only, and Pi stays on the Later list. OpenCode is the third harness, after Claude Code (spec 001) and Codex (spec 002). Cezar already runs OpenCode workers (1.18.35 on this host), which get nothing from Squeal today, the same reason ADR 0004 gave for Codex.
- The adapter implements `HarnessDelivery` from `src/core/types/delivery.ts`, as the Claude Code and Codex adapters do. Nothing in `src/core` changes for a harness; a finding that seems to need a core change is an open question for the spec, not a decision.
- The harness-neutral hook logic is `src/harness/shared/` (002 D5). The OpenCode adapter reuses it; what reads OpenCode's own payloads and output shapes lives in `src/harness/opencode/`.
- OpenCode extends through in-process plugins (JavaScript or TypeScript run by OpenCode's Bun runtime), not through hook commands as Claude Code and Codex do. ADR 0003 named it as offering cleaner in-process push. Whether the shared code can run in that process at all (it imports `node:sqlite`, `node:net` and `node:child_process`), or the plugin must hand each event to a Node process or the daemon, is a research question, not a decision.
- An idle wake is a research question, not a goal, as it was for Codex: the vision accepts pull at the next turn.
- Probes that run a real OpenCode never reach the real `HOME` (2026-10-11 lesson: environment-variable scratch homes are not isolation). They run as the throwaway OS user `squeal-e2e`, or the topic answers from docs and source only.
- 2026-10-14, the human: probes run OpenCode on `cliproxy/gpt-6-luna`; researchers mixed, Astra (Codex `gpt-6-astra`) on `opencode-plugins`, Opus on `opencode-sessions-and-wake`.
- 2026-10-14, the human, after research: ship the idle wake. The plugin wakes an idle session once per news through its own `client.session.promptAsync` wherever the process stays open (`serve`, the TUI); under `opencode run` and Cezar's auto-ending steps the message is stored and read at the next resume. Not bound to how Cezar counts turns, as 009 decided for Pi ("Cezar is just one use case").
- 2026-10-14, coordinator, from both findings: a thin auto-loaded plugin hands each event to a short Node process running `src/harness/shared/`, as the Codex hooks do; OpenCode's embedded Bun 1.3.14 has no `node:sqlite` (008-01 Q6). No held daemon socket and no core change.
- 2026-10-14, the human: install as Pi does (009 D1): `install.sh` unpacks `plugins/opencode/` into a versioned directory and runs OpenCode's own `opencode plugin file:<dir> -g`; no npm. OpenCode 1.18.35 has no remove command (`opencode plugin --help`, run as `squeal-e2e`), so how an update replaces the older entry is open question 1.

## Amendments after approval

- 2026-10-14, at approval, the human: the spec stands as drafted. Wave 0 (008-10, 008-11) dispatched; the `install.sh` row waits for 009's install rows (shared files).
- 2026-10-14, wave 0 (008-10, 008-11), 0.1.176, coordinator accepting the workers' decisions and folding `research/wave-0-checks.md`:
  - D1 amended (open question 1 closed): `--force` does not replace a `file:` entry, so both versions would load; `install.sh` installs `file:<...>/squeal/opencode/current` once and updates by repointing that link, keeping older directories a running process names, as for Pi.
  - D3 amended (open question 2 closed): a part added in `chat.message` reaches the model if it carries a `prt` id; without one OpenCode fails the prompt, so the plugin derives the id or adds nothing. `noReply` is not needed.
  - Testing amended: the isolation check found nothing outside the run directory, so `runOpenCode` runs locally as the agent user, not only in CI.
  - 008-10: the plugin's OpenCode types are a local copy of `@opencode-ai/plugin` 1.18.35 (`src/harness/opencode/api.ts`), now also a devDependency for a later switch; `dist/plugin.mjs` is its own esbuild pass without the Node banner, which imports `node:module`; a failed or missed registration leaves the consumer unregistered, so the next message retries; no sweep of a session's other consumers at registration, since one left by an earlier process ends with it (001 D10).
  - Open question 3 not answered: the bridge measured only at load 32 (p95 98 ms bare, 148 ms registering); re-measured at calm load before wave 1's review.
  - `KEY_FORMAT_VERSION` 10 (unreleased) re-pinned for the `build:plugin` line; `src/harness/opencode/build.ts` joins `GUARDED_WITHIN`.
