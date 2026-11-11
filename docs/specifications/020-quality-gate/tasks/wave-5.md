# Spec 020 wave 5: scope by check group, `prepare`, the pre-run print, and the wide-import study

Approved by the human on 2026-11-11:
- #172: leave out `manual` groups by default, and let the project configure the scope (spec D14).
- #174: "prepare: Yes" (spec D15).
- #175: "Approve study".

This wave runs:
- in parallel: 020-15a, 020-16b and the gh-175 study;
- after 020-15a and 020-16b are integrated: 020-15b, which also carries 020-16a.

Every build row:
- Read `docs/specifications/020-quality-gate/spec.md` whole first, D14 and D15 above all.
- Do not run `pnpm run build` or a full suite.
- Before you finish, read `squeal status --wait 60000 <changed paths>`, and run `pnpm run lint` and `pnpm run typecheck`. The four bundle-drift packaging tests are expected to fail.

020-15a and 020-16b both touch `collect.ts`, `types.ts`, `rule.ts`, `report.ts`, `gate/policy.ts`, `code-gate-text.ts` and `src/core/types/policy.ts`. In those files, make only small additive edits that hook in your new module. Put your logic in your own new file. Each of you sets `QUALITY_POLICY_VERSION = 4`, with a comment naming both gaps; the coordinator merges the two.

## 020-15a scope by check group

Use /worker. Shape: slice.

Outcome: `squeal code --base` runs only test files in scope (D14.1 to D14.3): non-`manual` groups by default, `gate.groups` at the base when set, plus `--group`.

Read: spec D14; `research/selection.md` Q1, Q2 and its row 020-15a; spec 019 D1 and `src/core/daemon/check-groups.ts` (`resolveGroups`).

Starting seam: a pure `src/core/code/gate/scope.ts` (new) that resolves the scope from the base's `checks`, `gate.groups` and `--group`, and places each test file in a group. First failing test: `test/code/gate/scope.test.ts`, with a `manual` group left out by default, `gate.groups` replacing the default, `--group` adding one, and an unknown name.

Owns: `src/core/code/gate/scope.ts`; hook-in edits in `collect.ts` (`select`), `gate/policy.ts`, `types.ts`, `rule.ts`, `evaluate.ts`, `report.ts`; `src/cli/code-gate-args.ts`, `code-gate-text.ts` (the verdict line), help in `src/cli/main.ts`; the `gate.groups` key in `src/core/types/policy.ts` and its loader under `src/core/daemon/policy*.ts`; their tests; the `squeal code --base` section of `commands.md` and the key in `policy.md` (skill references, with their copies).

Leave alone: the node:test entry keys (020-16b); `src/cli/code-gate.ts` beyond passing the scope through (020-15b).

Done when:
- the tests of research row 020-15a pass: scope resolution, evaluator goldens (a pass with a left-out loader, CRAP over with one, CC over with one, a changed left-out test file, the `coverage.exclude` skip), a collect fixture where the browser-shaped file does not run and `--group browser` runs it, and a CLI case where a branch marks a group `manual` only at the head and it still runs;
- a repository with no `checks` gives the same report as before, apart from the new fields.

## 020-16b `prepare` for node:test entries

Use /worker. Shape: slice.

Outcome: `squeal code --base` runs a node:test entry's `prepare` command, as declared at the base, before that entry's files (D15). The daemon does not open such an entry.

Read: spec D15 and D3; `research/build-wrapper.md` Q4 and its row 020-16b; `probes/build-wrapper/fixture`; `src/runners/node-test/run/run.ts`.

Starting seam: a `src/core/code/gate/prepare.ts` (new) that runs one entry's command with its own timeout inside the gate's deadline. First failing test: the probe fixture as a test fixture, where the helper behind the build is measured and passes.

Owns: `src/core/code/gate/prepare.ts`; hook-in edits in `collect.ts`, `gate/policy.ts` (the base read), `types.ts`, `rule.ts` (gap `not-prepared`), `report.ts` (`runs[].prepare`), `code-gate-text.ts`; the `prepare` key in `src/core/types/policy.ts` and `src/core/daemon/policy-node-test.ts`; the daemon's node:test entry set-up (skip and one note); their tests; README and `policy.md` (with copies) for the key.

Leave alone: `scope.ts` and `--group` (020-15a); `src/cli/code-gate.ts` beyond passing data through.

Done when:
- with `prepare`, the helper is measured and passes;
- a failing or timed-out `prepare` makes its files read `not-prepared`;
- a `prepare` only at the head makes them read `not-prepared`, with the note;
- `prepare` time counts in the budget;
- Squeal writes nothing outside what `prepare` writes;
- the daemon lists no file of an entry with `prepare` and notes it once.

## 020-15b the pre-run print (carries 020-16a)

Starts after 020-15a and 020-16b are integrated. The coordinator writes its baseline here then.

Use /worker. Shape: slice.

Outcome: D14.4. Before the first run, stderr shows the selection by runner and group, the left-out groups, the setups that will run, and each changed path that no runner can load, with the ways out. With `--json`, stdout holds only the JSON object: every other write to standard output, by Squeal, a test setup or a child that inherits standard output, goes to stderr (#182, folded in by the human 2026-11-11). Lead for #182: run collection in a child process whose standard output is the parent's stderr, and return the report on an extra pipe; `research/issue-182.md` has the probe.

Read: spec D14.4; `research/selection.md` Q3, Q4 and row 020-15b; `research/build-wrapper.md` Q3 and row 020-16a.

Starting seam: a `selected(summary)` callback in `collect.ts`, called after selection and before the first run. First failing test: a fixture whose global setup writes a marker, where the selection line comes before the marker on stderr.

Owns: `collect.ts` (the callback), `src/cli/code-gate.ts`, `code-gate-text.ts`, `test/cli/code-gate*.test.ts`.

Done when:
- the tests of rows 020-15b and 020-16a in the two findings files pass;
- `--json` stdout parses whole when a global setup writes to stdout in process, and when it starts a child with `stdio: "inherit"` that writes to stdout (`research/issue-182.md`'s probe as a test); that output appears on stderr.

## gh-175 study: complete evidence for a widely imported file

Use /researcher. Shape: survey. Read-only on the product. The budget is about 90 minutes.

Outcome: `research/wide-import.md`, with a design proposal for a new spec section and a row split (files, order, tests per row).

The human approved the study on 2026-11-11, with one limit: **no change to when evidence counts as complete.** An unfinished loader never makes a pass (D3.4, D5).

Start from `research/issue-175.md`. Questions:
1. Where does the time go when one changed file selects about 1,800 test files: selection, setup, per-file run, coverage mapping? Measure on a synthetic fixture, then on a scratch copy of cezar under `/tmp` at the commit #175 names, if the load allows.
2. Ordering: which order of the selected files completes the most changed functions within the budget? For example, order by function, so that one function's loaders finish together.
3. An estimate before the run: can the gate tell, from stored durations, that the budget will not cover the selection, and say so at once, with the ways out?
4. Reuse: how much of such a selection would the stores (D11.7) and CI parts (D13) cover today, and what would raise it?
5. How do D14's scope and `gate.groups` change the count?

Rules: skip a live probe while the one-minute load is above 24, and record the load beside every timing. Do not start a 25-minute gate run. Write nothing in `~/projects/cezar`. Own only `research/wide-import.md` and `research/probes/wide-import/`.

## 020-15a+16b I: integrate 020-16b onto 020-15a

Use /worker. Shape: finish. Baseline: local branch `w5/int`, which is main plus 020-15a's five commits (`738f6e489..25effeddc`, cherry-picked).

Outcome: one branch with both rows, where each keeps its intent: D14's scope and gap `left-out`, and D15's `prepare` and gap `not-prepared`.

Start: `git cherry-pick -x c84d79c27^..8cf21227f` (020-16b's ten commits, on `cez/26adafd0`). The first commit conflicts in `code-gate-text.ts`, `collect.ts`, `gate/policy.ts`, `report.ts` and `types.ts`. Keep both sides. `QUALITY_POLICY_VERSION` stays 4, with one comment naming both gaps. In `collect.ts`, the left-out files of 020-15a are never prepared or run; a `prepare` runs only for selected in-scope files.

Read: spec D14 and D15; `tasks/020-15a/notes.md`; 020-16b's notes under `tasks/020-16b/`.

Owns: every file the two rows touched.

Done when:
- every test both rows added passes, with `test/code/gate/`, `test/cli/code-gate*`, the policy and daemon tests they touched, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts`;
- one new test where a scope leaves out a node:test entry's file and its `prepare` does not run;
- if `gate.groups` sits on the key validity path as `prepare` did, it gets its own case in `test/keys/validity/cases/`;
- lint and typecheck are clean; `squeal status --wait 60000 <changed paths>` shows only bundle drift, or load retries you name;
- no `pnpm run build`.

## 020-18 say which changed functions were left out (#177)

Starts with 020-15b, after the integration above. Baseline: the integrated branch.

Use /worker. Shape: slice.

Outcome: spec D16. The report lists the touched functions that D2 does not judge, each with its reason, and the text verdict line counts them. Selection does not change.

Read: spec D2 and D16; `research/issue-177.md` and its probe `probes/issue-177/fixture.sh`.

Starting seam: `changedFunctions` in `src/core/code/gate/changed.ts`, at the `atBase.has(count.bodyHash)` skip. Collect what it skips, with the reason, into an additive `ChangedSet.omitted`. First failing test: the probe's fixture in `test/code/gate/changed*.test.ts`, with its seven left-out functions and their reasons.

Owns: `changed.ts`, an additive field in `types.ts`, the `omitted` field in `report.ts` and its pass-through in `evaluate.ts`, the verdict line in `code-gate-text.ts`, their tests, the report fields in `commands.md` (with copies). 020-15b also edits `code-gate-text.ts`; keep your edit to the verdict line.

Done when:
- the fixture reports 3 judged and 7 left out, each with the right reason;
- a function no changed line touches is not listed;
- the JSON golden test shows `omitted`; the text shows the count only when it is above 0;
- `QUALITY_POLICY_VERSION` is unchanged.
