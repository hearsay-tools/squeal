# Review: Cezar coverage repair (013-08/09/10)

Use /reviewer. Shape: review. Review the candidate SHA named in the dispatch, against its origin/main base. Own only `docs/specifications/013-vitest-runner/reviews/0.1.347.md`.

Outcome: decide whether the coverage repair satisfies 013 V1/V4 and 015 D8 without changing stored test meaning or weakening fidelity. Read those sections, the three task briefs and notes, and the candidate diff. Start at `src/runners/vitest/coverage.ts`, then `provider.mjs` and `reporter.ts`.

Check the exact provider-file permission on each Vite server, separate project roots and equal relative names, Vitest 4 and 5 call shapes, inspector/isolation exclusions, missing-provider startup errors, and bounded nested diagnostics. Assess key-check evidence and the proposed unchanged provider/adapter versions.

The Cezar probe mapped 390 files, but one navigation assertion timed out in two coverage-on batches, passed in one coverage-off batch, and passed alone with coverage on. Its cause is not established. Assess whether this is a proven regression, a plausible risk or insufficient evidence. Do not dismiss it as unrelated.

Done when: a committed verdict with evidence, blockers and limits. Use affected results and scoped tests; read candidate CI. No local full suite, checkpoint, bundle build or product edits. Avoid repeating the large Cezar probe.
