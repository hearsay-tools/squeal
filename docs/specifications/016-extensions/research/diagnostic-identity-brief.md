# Research brief 016-33: what one linter or type-checker check is

Use /researcher. Shape: research. Outcome: for linters and type checkers, which unit Squeal should store as one check (one finding, or one file or scope with its whole set of findings), measured on real tool output across recorded edits. Follow the rules in `README.md`.

The human (2026-10-26) chose to decide the first new check kind after this experiment and 016-34. `check-protocol-judgment.md` divergence 1 left this choice open, with the 016 coordinator as owner.

Read first: `check-protocol-judgment.md` (divergence 1, spec input 7); `check-protocol.md` and `check-protocol-astra.md` on diagnostic identity; `plugin-mechanisms.md` on the manifest tier; 011 C3 (keys) and C5 (transitions); `docs/vision.md`.

Questions:

1. **Candidates.** State each unit exactly: (a) one check per file per tool, holding the file's whole set of findings, which is replaced at each run; (b) one check per finding, with a content anchor from rule, message, line text and an occurrence index, and no line number; (c) the tool's own fingerprint where it gives one (SARIF `partialFingerprints`).
2. **Replay.** Run TypeScript `tsc --noEmit`, ESLint and Ruff in a scratch directory under `/tmp` on a small fixture. Apply these edits: insert a line above a finding; rename a variable that a message names; add a second, identical finding; fix one of two identical findings; move a function to another file; fix the last finding. For each candidate, give the transitions an agent would see (for example `FAIL -> PASS` on the fix, and no new failure on the inserted line), as a table.
3. **What the agent reads.** Per candidate, how many notices each edit produces, and whether a fixed finding can read as still failing or a new one can stay hidden.
4. **Inputs.** Per tool, what besides the file decides its findings (config files, plugin versions, other files that type information reaches). Only what the candidate choice depends on.

Own `diagnostic-identity.md` and `probes/diagnostic-identity/`. Tools go into the scratch directory, never into the worktree's `package.json`. No timings.
