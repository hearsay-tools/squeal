# Squeal: instructions for agents

Read these before any work, in this order:

1. `docs/process.md`: how work happens here (roles, the research-spec-board-wave-review loop, hard rules).
2. `docs/vision.md`: why Squeal exists and the decision filter for features.
3. `docs/styleguide.md`: code, naming, spec and agent-work conventions.
4. `docs/board.md`: what is running, planned and done. Coordinators own it; workers never edit it.
5. The spec you are working against under `docs/specifications/NNN-*/spec.md`, with its `status.md` amendment log.

Roles are skills: coordinating a wave, integrating workers or folding a review is `/coordinator`; implementing one board row is `/worker`; reviewing a wave's commit range is `/reviewer`; answering a research topic before a spec is `/researcher`; weighing several findings files on one question is `/judge`; scanning landed work for what to remove or unify is `/quality`. They live in `.claude/skills/` and are mirrored under `.agents/skills/`.

Verification: `npm run lint`, `npm run typecheck`, `npm run build`, and the Vitest suite through Squeal: `squeal run --all --wait`, a full-suite checkpoint that re-runs only the test files without a current result (in Codex, use the absolute `squeal` command the SQUEAL messages name; give it up to 10 minutes). Paste the output in your final message. From 0.1.132 its first line is the verdict, and it exits 1 on known failures and 3 when Squeal has no verdict; an older Squeal exits 0 even when tests fail, so read its `Known failures` line. Run `npx vitest run` yourself instead when `squeal` is unavailable, no daemon is validating, the checkpoint is abandoned, or you doubt a Squeal result, and say which. Reviewers and CI still run `npx vitest run` as the independent check; a reviewer on this host runs it at `--maxWorkers=4` under the full-run lock: `flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4`. The coordinator runs no full suite of its own before review: CI's full suite on the candidate and the reviewer's locked run are the full-suite checks (human, 2026-10-23). Product changes reach main only after a passing review of the candidate (`docs/process.md`, steps 5 and 6, and test runs on a shared host). `plugins/claude-code/dist` is committed and CI fails when it drifts from the build.
