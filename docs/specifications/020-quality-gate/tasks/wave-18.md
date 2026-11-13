# Wave 18 (the human, 2026-11-13: architecture rows "Build both")

Two rows that remove duplicate logic between the gate and `ci export`, with no change in behaviour. They touch neighbouring files (`src/core/ci/export.ts` in both), so they run one after the other: 020-52 first, then 020-51 from main after 020-52 lands. Source: the architecture review of 2026-11-12 (session af6c0b3f), cards 12 and 11. Check rules as in `tasks/wave-17.md`: targeted tests only, no full suite, no `pnpm run build` in a worker tree. Write notes in `tasks/wave-18-<row>/notes.md`.

## 020-52: one rule for "may this CI part stand for a run here" (card 12)

Use /worker. Shape: slice (a refactor). Read the board row 020-52, spec 020 D13.2 (the reasons list, row 020-49) and 018's export rules, `reviews/0.1.427.md` B1, `reviews/0.1.427-r2.md` B1 and `reviews/0.1.444.md` B3 (what the split broke).
- Today one shared rule (`reuseRefusal`, `src/core/ci/export-check.ts:119`) sits beside private rules in each reader: the gate (`src/core/code/gate/parts.ts`, `parts-environment.ts`) and `ci export` (`src/core/ci/export.ts`, `export-check.ts`, `export-inputs.ts`). Make one module own the decision for one test file and its reason (the reasons of D13.2), and have both readers call it. Where the two readers differ on purpose, the module takes that as a named option; say each one in your notes.
- First edit, as a lead: list every refusal branch in both readers side by side in your notes, then move the gate's per-file branches in `parts.ts` behind one function that `export-check.ts` also calls.
Owns: `src/core/code/gate/{parts,parts-environment,parts-refused}.ts`, `src/core/ci/{export,export-check,export-inputs,inputs}.ts`, one new module under `src/core/ci/` or `src/core/code/gate/` (your choice, said in notes), their tests.
Done when (tests): every existing parts, export and `ci` test passes with no assertion changed (imports may move); each refusal reason of D13.2 comes from the one module; a test per deliberate difference between the readers; no change to report fields, stderr text, exit codes or exports.

## 020-51: one keying path for the gate and `ci export` (card 11)

Not dispatched yet: it starts from main after 020-52 lands. Brief written then.
