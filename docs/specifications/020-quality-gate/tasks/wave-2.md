# Spec 020 wave 2: the small rows, exceptions, and the design surveys

Approved by the human on 2026-11-10 ("All of them, go"): rows 020-07 to 020-13 and 011-311. This wave runs:

- in parallel, on disjoint files: 020-09, 020-11, 020-12, 020-13 and 011-311;
- three design surveys for 020-07, 020-08 and 020-10, which read and probe only.

The build rows of 020-07, 020-08 and 020-10 start in wave 3, from their surveys.

Every build row:
- Read `docs/specifications/020-quality-gate/spec.md` whole first.
- Do not run `pnpm run build` or a full suite.
- Before you finish, read `squeal status --wait 60000 <changed paths>`, and run `pnpm run lint` and `pnpm run typecheck`. Failures in the four bundle-drift packaging tests are expected.

## 020-09 exceptions

Use /worker. Shape: slice.

Outcome: `squeal code --base <ref> --exceptions <file>` applies D8: inherited and approved exceptions, read from a file the consumer verified, keeping the measured scores.

Read: spec D5 to D8; `research/quality-gate.md` Q6 (in spec 015); `src/core/code/gate/{evaluate,report,types}.ts`, `src/cli/code-gate.ts`.

Starting seam: a pure `applyExceptions(report-in-progress, entries, baseCounts)` in `src/core/code/gate/exceptions.ts`. Its first failing golden tests cover the #167 cases:
- an inherited CC exception not worsened is accepted;
- the same exception worsened is a violation;
- an approved new violation is accepted;
- an entry with a wrong body hash or base commit is unused;
- an incomplete function stays incomplete.

Base CC comes from the base counts 020-02 already makes. Expose them through `ChangedSet`, an additive contract change you may make in `types.ts`, and say so in your final message.

Owns: `src/core/code/gate/exceptions.ts` (new), `evaluate.ts`, `report.ts`, `types.ts` (additive only), `changed.ts` (only to expose the base counts), `src/cli/code-gate*.ts`, `test/code/gate/exceptions*.test.ts`, `test/cli/code-gate*.test.ts`, and the `squeal code --base` section of `plugins/claude-code/skills/squeal/references/commands.md` with its copies.

Leave alone: `collect.ts`, `src/core/code/crap/`, README.md (020-11).

Done when:
- golden tests cover every D8 rule;
- one end-to-end test exits 0 with an accepted violation, and one exits 1 with a worsened one;
- an exceptions file that does not parse exits 2;
- `QUALITY_POLICY_VERSION` is 2.

## 020-11 a pinned runtime for CI

Use /worker. Shape: finish.

Outcome: D9. A project can run `squeal code --base` in CI from a pinned, verified Squeal with no harness and no agent session, and the README shows how.

Read: spec D9; `research/quality-gate.md` Q7; `install.sh`; `src/harness/codex/runtime-release/`; `scripts/package-codex-runtime.ts`; `docs/specifications/018-ci-and-shared-results/tasks/018-08-squeal-results-trial.yml`, which runs the CLI from a tag clone.

Starting seam: try the documented commands yourself against release `squeal--v0.1.423`, in a scratch directory under `$TMPDIR`, with `HOME` set there.
- Run the CLI from the downloaded runtime asset after checking its SHA-256, then from the tag clone.
- If the runtime asset cannot start the CLI without a harness, add the smallest supported entry point and a test for it.

Owns: `README.md` (one new section), any new small entry point with its test, and `test/` files for the README commands if you add any.

Leave alone: `src/core/code/gate/`, `commands.md` (020-09).

Done when:
- the README section's commands ran as written against 0.1.423, and your final message shows the output;
- a wrong SHA-256 is refused;
- the cache key names both the version and the SHA-256.

## 020-12 the counter reads `\x` inside `String.raw` as a parse error

Use /worker. Shape: survey, then repair if it is small.

Outcome: `test/keys/validity/compare.test.ts` counts with no error range, or a short note says why that cannot be fixed here and what it would take.

Read: spec 015 D3; `src/core/code/count/` (tree-sitter grammars, `withCodeTree`); `test/keys/validity/compare.test.ts:279`.

Starting seam: a failing test in `test/code/count/` with the smallest `String.raw` template that holds `\x`. Then find out whether the grammar, its version or Squeal's use of it is wrong. A fix may be a grammar version raise, a narrow rewrite that keeps offsets, or a change in how errors are scoped. Any change to counts raises `COUNTER_VERSION`; say whether yours does.

Owns: `src/core/code/count/`, `test/code/count/`, and the grammar package versions in `package.json` and `pnpm-lock.yaml`, if a raise fixes it.

Leave alone: `src/core/code/gate/`, `src/core/code/crap/`.

Done when:
- the test passes and the CC of every other `src/` function is unchanged, compared before and after over this repository;
- or the note is committed under `docs/specifications/020-quality-gate/tasks/020-12/`.

## 020-13 the version-sensitive rule reads any quoted `"--test"` as node's flag

Use /worker. Shape: repair.

Outcome: `test/version-sensitive.test.ts` tells node's own `--test` argument apart from a string that merely contains `--test`. The test files of `squeal code --base` then spell the flag plainly.

Read: `test/version-sensitive.test.ts` (`QUOTED_TEST`, `NAMES_NODE_TEST`, `RUNS_NODE_TEST`); `test/cli/code-gate-fixture.ts` (`TEST_FLAG`) and its users.

Starting seam: a case in the rule's own tests where `["code", "--base", "main", "--test", "x"]` is not a sign of node:test, and `spawn(node, ["--test", ...])` is. Lead: require node's flag to appear in a node argument list, such as after `process.execPath` or `"node"`, or as the first array element. Keep every file that is listed today listed: compare the rule's output before and after.

Owns: `test/version-sensitive.test.ts`, `test/version-sensitive.txt` (no new entries expected), `test/cli/code-gate-fixture.ts`, and `test/cli/code-gate*.test.ts`. For those last two, you may only replace `TEST_FLAG`.

Leave alone: everything under `src/`.

Done when:
- the rule's before and after lists are equal;
- `TEST_FLAG` is gone;
- the rule's tests cover both cases.

## 011-311 plain wording for "runner part pending" and "feed late"

Use /worker. Shape: slice.

Outcome: the wording in board row 011-311, as the human proposed it, in every place that prints these two delays.

Read:
- board row 011-311 (`docs/board.md`);
- spec 011's status text decisions: `docs/specifications/011-core/spec.md`, and row 011-200 for the late feed;
- memory note: the evals parsers must round-trip `formatStatus`, `formatRegistration` and `formatDelta`, plain and hook JSON (`evals/` parser gate).

Starting seam: `src/core/state/header.ts` (`runnerPartText`), `src/core/delivery/header.ts` (`incompleteText`, `livenessSentence`), `src/core/status/feed-late.ts` (`lateText`), `src/core/status/format-status.ts`, `src/cli/status-wait-lines.ts`, `src/harness/shared/stop-text.ts`.
- First failing test: the cezar message from the row, which says both things at once, must read as the row's single "Squeal is behind: …" sentence.
- The sentence names the project's runner (Vitest, node:test, pytest), not always Vitest.
- No message may use "current" for revision coverage.

Owns: those source files, their tests, the evals parsers that read these lines, and the docs lines in `plugins/claude-code/skills/squeal/references/*.md` that quote them, with their copies. In `commands.md`, change only the lines that quote this wording; 020-09 owns its `squeal code --base` section.

Leave alone: `src/core/code/`, `README.md`.

Done when:
- each place prints the new sentence;
- the evals parsers' gate passes against the real formatters;
- `squeal status --wait 60000 <changed paths>` is current apart from bundle drift.

## Surveys for wave 3

Use /researcher. Shape: survey. Read-only on the product. Each survey owns only its findings file and `probes/<topic>/` under `docs/specifications/020-quality-gate/research/`. Each has a budget of about 90 minutes. Each ends with a design proposal for spec D10 and a row split: files, an order, and tests per row.

### survey-020-07 daemon parity

Questions:
1. Where do the daemon's code states come from: `src/core/code/pass/`, `crap/judge.ts`, `crap/file.ts`?
2. How can the daemon call `evaluate()` (`src/core/code/gate/evaluate.ts`) for CRAP and complexity without changing what it delivers? Deliveries are 015 D5 and D6.
3. What changes when test files are counted in the daemon? Count the functions and the cost.
4. What changes when a file with no loader reads unknown? Cover the daemon states, the status lines and #165 (Python).
5. How can `--base` read the stores (counts by blob, coverage records by result key) and run only what is missing, with no daemon running?

Findings go to `research/daemon-parity.md`.

### survey-020-08 CI evidence

Questions:
1. Can the `ci record` hook (`src/runners/vitest/ci-record.ts`, `ci-runtime/*.cjs`) add Squeal's coverage provider before Vitest starts its workers? This was open question 2 of the research. Try it on a scratch fixture.
2. Map the records inside the hook, and give their cost per test file.
3. What is the part format change (`squeal-ci-part/4`, in `src/core/ci/parts.ts`), and how does `--base --parts <dir>` select and check records, by tested tree, blob and versions?
4. What happens to a project whose CI also runs `--coverage`?

Coordinate through the coordinator only. Spec 018's coordinator owns `ci record`, so propose and change nothing there.

Findings go to `research/ci-evidence.md`.

### survey-020-10 child-process coverage

Questions:
1. How do the daemon (Vitest provider, node:test adapter) and the gate collect `NODE_V8_COVERAGE` from children under `coverage.children: true`?
2. Where does the D8 recorder delete the variable today?
3. Map with `ownRecord`, as `research/quality-gate.md` Q4 did.
4. What is the CPU cost, and how are truncated files handled?
5. Which existing tests break when the variable is visible?

Start from `015-coverage-complexity/research/child-processes.md` and `issue-144.md`.

Findings go to `research/child-coverage.md`.
