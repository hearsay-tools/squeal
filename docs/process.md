# How work happens in this repository

The operating model is the one from mega.dev's "autonomous product development", run with Cezar as the orchestrator. This file is the entry point for any coordinator session. Humans own `vision.md`, `styleguide.md` and this file; agents maintain everything else.

## Files that carry context

| File | Owner | Purpose |
| --- | --- | --- |
| `docs/vision.md` | human | Why Squeal exists. Every feature passes its decision filter. |
| `docs/styleguide.md` | human | Code, naming, spec and agent-work conventions. |
| `docs/process.md` | human | This file. |
| `docs/board.md` | coordinator | Current and planned tasks, grouped in waves. Workers never edit it. |
| `docs/specifications/NNN-*/` | coordinator and workers | One folder per feature: `spec.md`, `status.md` (stage and amendment log), `research/`, `reviews/`, `tasks/`, `lessons.md`. |
| `docs/decisions/` | coordinator | ADRs for decisions that span specs. Supersede, never edit history. |

## Roles

- **Coordinator**: the Cezar parent session. Reads the human's intent, runs research, writes the spec, keeps the board, dispatches waves, integrates worker commits, folds reviews back into the spec. Never writes product code itself beyond integration fixes.
- **Researcher**: one worker per research topic. Read-only on the product; writes one findings file under `research/` with every finding tagged `verified by experiment`, `read in official docs`, `read in source code` or `inferred`. Throwaway probes live under `research/probes/`.
- **Worker**: one worker per board row. Disjoint file ownership from the other workers of its wave. Test first. Final message lists decisions the spec did not settle and any type change.
- **Reviewer**: one worker per wave. Changes no code. Writes `reviews/wave-N.md`: verdict, verification output, blockers, should-fix, nits, what fits, and inputs for the next wave.

## The loop for a feature

1. **Intent.** The human states the goal. The coordinator writes back its understanding and asks only the questions that change the design.
2. **Research first.** Open questions become researcher tasks run in parallel. Nothing is designed from memory when an experiment is cheap.
3. **Spec.** The coordinator writes `spec.md` from the findings, with numbered design sections (D1, D2, ...) that tasks and reviews cite. The human reviews it before any code.
4. **Board.** The spec is decomposed into waves of worker-sized rows, each with scope and a testable done-when. Wave 0 is the scaffold and shared interfaces; later waves build on reviewed interfaces.
5. **Wave.** Workers run in parallel with disjoint ownership. The coordinator verifies each tree (lint, typecheck, tests) in the worker's own worktree, cherry-picks or fast-forwards, runs the combined checks, lands on main, retires the worker.
6. **Review.** A reviewer closes the wave. Blockers become a fix wave (N.5) before the next wave starts; should-fix items fold into the next wave's briefs; every accepted deviation becomes a dated amendment line in `status.md` and an edit to the spec section.
7. **Proof.** The last waves are an end-to-end suite that runs the product the way it ships and a dogfooding report written to `lessons.md`, which resolves the spec's open questions with evidence. The spec moves to `shipped` when its goals hold in dogfooding with no blocker.

## Rules the first feature taught

- Workers run on Opus or cheaper, never Fable. Always pass `--model` on spawn.
- Worker briefs are saved verbatim under `specifications/NNN-*/tasks/wave-N.md` before dispatch, so a new coordinator session can dispatch them unchanged.
- Workers may ask the coordinator through a Cezar request; the coordinator answers with a decision, not a discussion, and relays anything a sibling worker needs.
- Do not run `npm run build` inside a worker's worktree: Cezar's destroy then fails to verify it. Rebuild once on the coordinator branch after integrating a wave, and commit the bundles before running the end-to-end suite, which archives from HEAD.
- Generated files (`plugins/claude-code/dist`) are committed; CI fails if they drift from the build.
- A spawn that returns a transport error may still have created the worker. Check `worker inspect` before retrying.
- The handoff file is updated after every landing with what is running, what to do on wake, and what is still open.
