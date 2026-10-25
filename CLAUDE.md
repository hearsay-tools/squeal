# Squeal: instructions for agents

Read these before any work, in this order:

1. `docs/process.md`: how work happens here (roles, the research-spec-board-wave-review loop, hard rules).
2. `docs/vision.md`: why Squeal exists and the decision filter for features.
3. `docs/styleguide.md`: code, naming, spec and agent-work conventions.
4. `docs/board.md`: what is running, planned and done. Coordinators own it; workers never edit it.
5. The spec you are working against under `docs/specifications/NNN-*/spec.md`, with its `status.md` amendment log.

Roles are skills: coordinating a wave, integrating workers or folding a review is `/coordinator`; implementing one board row is `/worker`; reviewing a wave's commit range is `/reviewer`; answering a research topic before a spec is `/researcher`; weighing several findings files on one question is `/judge`; scanning landed work for what to remove or unify is `/quality`. They live in `.claude/skills/` and are mirrored under `.agents/skills/`.

Verification: use Squeal's affected-test results during work. Before finishing a code change, read `squeal status --wait 60000 <changed-path>...` (in Codex, use the absolute `squeal` command the SQUEAL messages name). Run lint, typecheck, build and tests outside Squeal's coverage as the change requires. If Squeal is unavailable, no daemon validates or its result is doubtful, use `npx vitest run` with explicit test paths for the relevant tests and say why. Workers, coordinators and reviewers do not run a full suite or request a full-suite checkpoint for routine completion or review (human, 2026-10-25). CI keeps its full-suite runs on candidate and main pushes; no PR is needed. Before release through the hub, require passing full-suite CI for the exact release commit. If CI cannot provide that evidence, use one independent local full run on that commit: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. A known CI failure must be resolved before release; a local pass does not override it. Report the commands and actual results, including pending or unknown affected checks; never claim an unrun suite passed. Product changes still require a passing candidate review before main (`docs/process.md`, steps 5 and 6). `plugins/claude-code/dist` is committed and CI fails when it drifts from the build.
