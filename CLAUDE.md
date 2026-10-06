# Squeal: instructions for agents

Read these before any work, in this order:

1. `docs/process.md`: how work happens here (roles, the research-spec-board-wave-review loop, hard rules).
2. `docs/vision.md`: why Squeal exists and the decision filter for features.
3. `docs/styleguide.md`: code, naming, spec and agent-work conventions.
4. `docs/board.md`: what is running, planned and done. Coordinators own it; workers never edit it.
5. The spec you are working against under `docs/specifications/NNN-*/spec.md`, with its `status.md` amendment log.

If you are a Cezar worker, your board row and brief define your scope and file ownership; stay inside them and ask the coordinator through a Cezar request when something outside is needed.

Verification: `npm run lint`, `npm run typecheck`, `npm run build`, `npx vitest run`. Paste the output in your final message; claims without output do not count. `plugins/claude-code/dist` is committed and CI fails when it drifts from the build.

Spawning workers: Opus or cheaper, never Fable; always pass `--model`.
