# 009 Pi adapter: status

Stage: approved (2026-10-14, the human); waves on `docs/board.md`, briefs under `tasks/`.
Started: 2026-10-14

## Decisions so far

- 2026-10-14, the human: start working on Pi support. This is the board's Later entry "009 Pi and OpenCode adapters", narrowed to Pi. A second coordinator started OpenCode the same day and landed first as spec 008 (`008-opencode-adapter`), so Pi is 009 and its rows 009-01 and 009-02; this research ran as "008" until the renumbering, and the commits it cites (`ef5938de`, `d99c28b9`) are on the coordinator branch before the rebase onto main. The two adapters share `src/harness/shared/` and stay independent specs.
- The adapter implements `HarnessDelivery` (`src/core/types/delivery.ts`) as spec 002 did for Codex; a finding that seems to need a core interface change is an open question for the spec, not a decision.
- Pi 1.0.4 has no hook processes: extensions run in the Pi process for the session's life (`docs/extensions.md`). Research measures what that changes against 002's per-event hook processes: a held daemon connection, mid-turn injection, and idle wake.
- Research probes run Pi only as the throwaway user `squeal-e2e`, with a scripted fake provider and no model credentials (`research/README.md`).
- Dispatch: two researchers in parallel, Opus on `pi-extension-events`, Astra on `pi-sessions-and-packaging` (board Standing models). Both done 2026-10-14; findings in `research/`.
- 2026-10-14, coordinator, writing `spec.md` from both findings: a Squeal handler must not run `node:sqlite` on Pi's main thread, because Pi has no handler timeout and the store's busy timeout would freeze the TUI and the RPC stream; D4 puts the shared code in a worker thread with per-event deadlines (a choice of the coordinator, measured in wave 0). The final `turn_end` of a run delivers nothing so the end-of-run continuation carries the news (research 009-01 found a final-turn entry waits for the next prompt). No held daemon socket. Install through `install.sh` and `pi install <local dir>`, not a git install of this repository.

## Amendments after approval

- 2026-10-14, at approval, the human: the spec stands as drafted. Open question 1, idle wake in Cezar: "Cezar is just one use case"; the implementation is not bound to how Cezar works. The coordinator decided from that and 001's precedent: wake is armed in every Pi mode that stays open (`tui`, `rpc`), never under `-p` or `json`, with no launcher case and no policy key; D5 and D9 amended.
