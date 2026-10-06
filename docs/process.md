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
- **Judge**: one per fan-out question. Reads two or more findings files and names where they diverge; the output is the spec input, never an average.
- **Quality**: one per stretch of landed work, after a spec ships or about ten rows. Proposes drop candidates, board rows and small slices; edits nothing.
- **Reviewer**: one per wave. Changes no code. Labels every finding proven, plausible or unverified; only a proven break blocks. Writes `reviews/wave-N.md`: verdict, verification output, blockers, should-fix, nits, what fits, and inputs for the next wave.

## The loop for a feature

1. **Intent.** The human states the goal. The coordinator writes back its understanding and asks only the questions that change the design.
2. **Research first.** Open questions become researcher tasks run in parallel. Nothing is designed from memory when an experiment is cheap.
3. **Spec.** The coordinator writes `spec.md` from the findings, with numbered design sections (D1, D2, ...) that tasks and reviews cite. The human reviews it before any code.
4. **Board.** The spec is decomposed into waves of worker-sized rows, each with scope and a testable done-when. Wave 0 is the scaffold and shared interfaces; later waves build on reviewed interfaces.
5. **Wave.** Workers run in parallel with disjoint ownership. The coordinator verifies each tree (lint, typecheck, tests) in the worker's own worktree, cherry-picks or fast-forwards, runs the combined checks, lands on main, retires the worker.
6. **Review.** A reviewer closes the wave. Blockers become a fix wave (N.5) before the next wave starts; should-fix items fold into the next wave's briefs; every accepted deviation becomes a dated amendment line in `status.md` and an edit to the spec section.
7. **Proof.** The last waves are an end-to-end suite that runs the product the way it ships and a dogfooding report written to `lessons.md`, which resolves the spec's open questions with evidence. The spec moves to `shipped` when its goals hold in dogfooding with no blocker.

## Procedures

Each role's step-by-step procedure is a skill, so an agent loads only its own: `.claude/skills/{coordinator,worker,reviewer,researcher,judge,quality}/SKILL.md`, mirrored under `.agents/skills/` for other harnesses. This file describes the model; the skills carry the steps.

## Provenance

The model is mega.dev's "autonomous product development", whose reference implementation is [overment/limen](https://github.com/overment/limen). Limen injects vision and styleguide into every role and selects a short role preamble per spawn (`templates/<role>.md`, overridable per project); its roles are coordinator, worker, reviewer, researcher, judge and quality, and all six are skills here, rewritten from limen's preambles and shop manual on 2026-10-06 with our additions marked *(Squeal)*. Left out, with reasons: the picture role (an architecture map; no map exists here yet), the keeper role (fixes ticket front matter and board links that limen's strict check enforces; our board has no such check), team groups (several coordinators on one feature; one coordinator per spec is enough at this size), and Herdr tab mechanics (Cezar's cockpit is the window). Limen's research fan-out of two models plus a judge is the human's call here, because it is spend.
