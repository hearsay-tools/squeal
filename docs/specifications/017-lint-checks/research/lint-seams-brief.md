# Research brief 017-02: where a lint check enters Squeal's core

Use /researcher. Shape: survey. Outcome: for a per-file ESLint check, which parts of Squeal's core it reuses as they are, which need a new field or kind, and which assume a test, with spec 015's code checks (complexity, coverage) as the nearest existing check that is not a test. Follow the rules in `README.md`.

Read first: `../status.md`; spec 015 `spec.md` D1 to D7; spec 016 `research/seams.md`, `research/diagnostic-identity.md` and `research/binding-cost.md`; 011 C3, C4, C5, C8 and C14; `src/core/types/runner.ts`.

Questions:

1. **015's path.** How a code check is named, keyed, stored, scheduled (the daemon's pass), shared between worktrees, given states and transitions, told to the agent and gated. Cite files and lines at your HEAD.
2. **Fit.** For a check that is one file and one tool, holding the file's set of findings with a fingerprint of rule and message and no line: list each part that reuses as is, each that needs a new field or kind, and each place that assumes a test (a runner name, a test file, a closure), with file and line.
3. **Scheduling.** Where a lint provider attaches to the scheduler (011 C4, C14), given that its hints are declared data and it runs in its own worker thread. What a whole-program input (typed rules) needs from keys (011 C3) and the shared observed sets (016 D4).
4. **The agent's surfaces.** What status, the delivered lines, the blocked write, the end-of-turn check, `squeal code` and the evals parser (`evals/lib/squeal-text.mjs`) would print for a lint check, and what changes for a project that does not turn it on.
5. **Policy.** Where `lint` would sit in `squeal.config.json`, with 015 D1 and its default change in 0.1.341 as the template.

Own `lint-seams.md` and `probes/lint-seams/`.
