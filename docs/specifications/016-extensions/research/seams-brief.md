# Research brief 016-01: Squeal's seams today

Use /researcher. Shape: survey. Outcome: a map of the runner, check and harness contracts as they are at HEAD, and of what would have to move for a runner, a check or a harness adapter to live outside this repository. Follow the rules in `README.md`.

Read first: 011 C3 (keys), C4 (validity), C8 (hook contract), C12 (recorder), C14 (adapter contracts) and "Known seams"; `src/core/types/runner.ts`, `src/core/types/delivery.ts`; 015's `spec.md` D1 to D5 (complexity as a check type).

Questions:

1. **Runner contract.** Each member of `RunnerAdapter` and what the core assumes beyond it. Check each "Known seams" line at HEAD and find the ones it misses: every import from `src/runners/*` or `src/harness/*` into `src/core` or `src/cli`, and every place that names a runner or a harness by string. Give file and line.
2. **Shared machinery.** What the three runners share and what each built alone: module graph and closure, environment hashing, the recorder, the warm instance, focus, slow lanes. Which parts a new runner would reuse as a toolkit (a Jest or Mocha runner, a Go runner), and which are runner-specific.
3. **Check types.** Is 015's complexity a provider behind one contract with the runners, or a parallel path? What a linter (ESLint, Ruff) or a type checker (`tsc`) would need that neither has: diagnostics per location, project-wide checks, check identity without a test name.
4. **Harness contract.** What each of the four adapters implements, what `src/harness/shared` gives them, what is duplicated, and how each is built and packaged. Could a fifth adapter be written outside the repository against the CLI and JSON alone?
5. **Keys.** How `adapterVersion`, `KEY_FORMAT_VERSION` and `test/keys/key-format.test.ts` protect results today, and what an out-of-tree runner would have to supply to keep them.
6. **Size.** For each seam, what would move, ranked by size (files and lines) and by risk to shipped behaviour.

Own `seams.md` and `probes/seams/`.
