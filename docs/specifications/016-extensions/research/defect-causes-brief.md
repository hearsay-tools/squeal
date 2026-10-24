# Research brief 016-09: what caused our defects

Use /researcher. Shape: survey. Outcome: what share of this project's defects came from the seams the internal half of 016 would remove, what share a shared correctness kit would have caught earlier, and what share neither touches, so that the human can decide whether the internal half is worth its risk. Follow the rules in `README.md`.

Read first: `seams.md` (seams S1 to S10, the 9 groups "Known seams" misses, F1.2, F4.3); `../status.md`, the two entries of 2026-10-24 that start "the human, asked before deciding" and "the human: measure first"; `docs/process.md` (reviews, blockers).

Items: every blocker and should-fix item in a FAIL review under `docs/specifications/*/reviews/`; every board row that repairs a defect (review repairs, dogfood defects, `gh-N` triage rows, the Later list); every GitHub issue (`gh issue list --state all`, read only). Count duplicates once. If there are more than about 400, sample by spec and state how.

Categories, one primary per item, a secondary where it fits:

- **A. Seam.** Gone or caught by construction under one contract: two paths for the same data (the injected observed store), a runner or harness named in core, CLI or `harness/shared`, a rule repeated per harness, spec and code drifting on the adapter contract, a cross-runner import.
- **B. Kit.** A validity error in one runner (stale pass, missed closure input, wrong completion, lost result) that a shared scenario would have caught before review: flip, recovery, transitive edit, file error, interrupted run.
- **C.** Runner knowledge no shared scenario reaches. **D.** Harness quirk. **E.** Core logic. **F.** Load, timing, environment, CI. **G.** Process, docs, evals.

Questions:

1. Counts per category and per spec, with review rounds and repair rows as cost.
2. Every A and B item with its file, its line and one sentence of why.
3. Two quoted examples per category, and the items you could not place.
4. The five costliest A or B items.
5. Does the share change over time, for example after 011's split on 2026-10-17?

Tag each classification `inferred` with the evidence read. Own `defect-causes.md` and `probes/defect-causes/`.
