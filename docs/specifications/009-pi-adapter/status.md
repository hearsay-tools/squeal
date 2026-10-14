# 009 Pi adapter: status

Stage: draft (research)
Started: 2026-10-14

## Decisions so far

- 2026-10-14, the human: start working on Pi support. This is the board's Later entry "009 Pi and OpenCode adapters", narrowed to Pi. A second coordinator started OpenCode the same day and landed first as spec 008 (`008-opencode-adapter`), so Pi is 009 and its rows 009-01 and 009-02; this research ran as "008" until the renumbering, and the commits it cites (`ef5938de`, `d99c28b9`) are on the coordinator branch before the rebase onto main. The two adapters share `src/harness/shared/` and stay independent specs.
- The adapter implements `HarnessDelivery` (`src/core/types/delivery.ts`) as spec 002 did for Codex; a finding that seems to need a core interface change is an open question for the spec, not a decision.
- Pi 1.0.4 has no hook processes: extensions run in the Pi process for the session's life (`docs/extensions.md`). Research measures what that changes against 002's per-event hook processes: a held daemon connection, mid-turn injection, and idle wake.
- Research probes run Pi only as the throwaway user `squeal-e2e`, with a scripted fake provider and no model credentials (`research/README.md`).
- Dispatch: two researchers in parallel, Opus on `pi-extension-events`, Astra on `pi-sessions-and-packaging` (board Standing models). Both done 2026-10-14; findings in `research/`.
