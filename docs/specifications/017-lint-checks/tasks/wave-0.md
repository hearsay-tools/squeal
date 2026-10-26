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

## Review of the wave 0 candidate (017-03)

Use /reviewer. The candidate is `cand/0.1.344` at `c1ed6c5ad`. The range is `9b90ea310..c1ed6c5ad`: seven commits of worker f2e5cb23, the coordinator's spec amendment (D1, D2, D6), and the version raise with the bundle commit. Write `docs/specifications/017-lint-checks/reviews/0.1.344.md` and commit it alone on your branch.

Read: spec 017 goals 1 and 4, D1, D2, D5 (stale) and D6, as amended; the 017-03 brief above; `tasks/017-03/notes.md`; `research/lint-seams.md` F2.2, F2.3 and F4.3; 016 `research/diagnostic-identity.md` Q2 and Q3.

Check, with proof where you can:
1. Off by default: with no `lint` section, nothing creates or opens `lint.sqlite`, and the policy, status and delivery of a project are as at `9b90ea310`.
2. Separation: `LintCheckId` is in neither `CheckId` nor `CodeCheckId`, nothing writes to the main store or `code.sqlite`, and no file under `src/core/code/` or `src/core/delivery/` changed.
3. The transitions: the replay of 016-33's seven ESLint outputs gives the a-set column; each row of D2's table has a test; the fingerprint keeps duplicates and holds no line; the two-stage match names the right findings, and say where it can still name the wrong one.
4. The store: it refuses a newer `user_version`, reports corruption, shares `results` by check and key, and keeps states, transitions and views per worktree. Say whether a reader that later meets a new outcome or kind fails safe.
5. Stored keys: the policy loader is on the key-validity path. `test/keys/key-format.test.ts` passes, and compare-refs at `squeal--v0.1.342` gives equal keys, uncovered 0, with `KEY_FORMAT_VERSION` unchanged.

Run lint, typecheck, `test/lint/`, `test/daemon/policy.test.ts`, `test/types.test.ts` and `test/keys/key-format.test.ts` on Node 22 and Node 24. No local full suite and no `squeal run --all` (human, 2026-10-25): read the candidate's CI run 40325880957 for full-suite coverage, and report its result as you find it. Label findings proven, plausible or unverified. Only a proven break blocks. Verdict: PASS or FAIL.
