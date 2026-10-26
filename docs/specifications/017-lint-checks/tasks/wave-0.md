# Wave 0: the lint check's data layer, no ESLint

The human approved spec 017 on 2026-10-26. This wave builds what every later wave stands on, with no ESLint and no daemon wiring: the types, the policy keys, the store, the fingerprint and the transitions. One worker, claude opus xhigh.

## 017-03 types, policy keys, store, fingerprint and transitions

Use /worker. Shape: slice. Outcome: Squeal has a lint check's data layer: a `(path, "eslint")` check with D2's outcomes, fingerprint and transitions, the D1 policy keys, and D6's `lint.sqlite`, created only while `lint.enabled` holds.

Read: spec 017 goals 1 and 4, D1, D2 and D6; `research/lint-seams.md` F2.1, F2.2, F4.3 and Q5; 015 D4 and D5; `src/core/code/store/` and `src/core/daemon/policy-code.ts` as templates (read only).

Starting seam: a new `src/core/types/lint.ts`. First edit, as a lead: a failing test that feeds 016-33's ESLint outputs (`docs/specifications/016-extensions/research/probes/diagnostic-identity/out/js/s0` to `s7` `.json`) through the fingerprint and the transition function, and expects the a-set column of `research/diagnostic-identity.md` Q2.

Owns: `src/core/types/lint.ts`; `src/core/lint/**` (new); a new `src/core/daemon/policy-lint.ts` with `LINT_SHAPE`, and only the lines that add `lint` to `src/core/types/policy.ts` (type and defaults) and spread `LINT_SHAPE` in `src/core/daemon/policy.ts`; `test/lint/**` (new); a key-validity case if the loader change needs one.

Leave alone: `src/core/code/**` and `src/core/delivery/**` (015's; wave 2 brings them to 015 first); `src/core/daemon/daemon.ts` (the pass is wave 1); `code.sqlite` and the main store's schema; `evals/`; the bundles.

Done when:
- with no `lint` section, the policy has D1's defaults and nothing creates `lint.sqlite` (goal 1);
- the store opens only when enabled, round-trips a result with its findings, shares `results` by key and keeps states, transitions and views per worktree, and refuses a newer `user_version`;
- one test per row of D2's transition table, and the replay above gives the a-set transitions (goal 4); the added and removed match names the findings;
- `squeal status --wait 60000` is green on `test/lint/` and every test of the files you touched; `test/keys/key-format.test.ts` passes, or compare-refs at `squeal--v0.1.342` gives equal keys and uncovered 0;
- lint and typecheck pass. No `npm run build`, no full suite.
