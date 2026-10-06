# Squeal: instructions for agents

Read these before any work, in this order:

1. `docs/process.md`: how work happens here (roles, the research-spec-board-wave-review loop, hard rules).
2. `docs/vision.md`: why Squeal exists and the decision filter for features.
3. `docs/styleguide.md`: code, naming, spec and agent-work conventions.
4. `docs/board.md`: what is running, planned and done. Coordinators own it; workers never edit it.
5. The spec you are working against under `docs/specifications/NNN-*/spec.md`, with its `status.md` amendment log.

Roles are skills: coordinating a wave, integrating workers or folding a review is `/coordinator`; implementing one board row is `/worker`; reviewing a wave's commit range is `/reviewer`; answering a research topic before a spec is `/researcher`; weighing several findings files on one question is `/judge`; scanning landed work for what to remove or unify is `/quality`. They live in `.claude/skills/` and are mirrored under `.agents/skills/`.

Verification: `npm run lint`, `npm run typecheck`, `npm run build`, `npx vitest run`. Paste the output in your final message. `plugins/claude-code/dist` is committed and CI fails when it drifts from the build.
