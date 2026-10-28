# Issue 123: named-row filters for focused parity waits

Triage research for [hearsay-tools/squeal#123](https://github.com/hearsay-tools/squeal/issues/123), "Support named-row filters for focused parity waits" (filed 2026-10-28 from a Codex session on Squeal 0.1.374). Researcher 0b9f5530, 2026-10-28, bounded to 20 minutes. No design and no implementation here.

**Verdict.** The capability the issue asks for exists since 0.1.286 (rows 011-144 to 011-146, gh-64): `squeal status --wait <ms> <path>... --check <text>...` runs the selected checks first and keeps a focused outcome apart from the file's own verdict. The original command did not use `--check`. Two real gaps remain. (1) A focused-only wait over more than 20 unknown test files can fail to settle: the `focused:<worktree>` meta row keeps 20 files, so the oldest files' outcomes are dropped and the wait ends at its deadline with exit 3. The issue's command named 56 files. (2) `--check` matches substrings only. The issue's row family `U(2|3|7|12|13|19)[a-z]*` needs one text per row (` U2 `, ` U2c `, ...); a shorter text such as ` U2` also selects `U20` and `U21`. Gap 1 exposes a conflict between C5's bounded history and C15's completion condition; gap 2 is an enhancement.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| Q1 | Do existing focused checks support named-row selection through Squeal? | Yes, by full-name substring, repeatable, OR'd, per test file named by its own path; outcome kept apart from file verdicts | read in official docs (011 C4, C5, C6, C14, C15; 013 V4); verified by experiment, 0.1.374 |
| Q2 | Is regex matching missing? | Yes. A text is escaped before Vitest's `testNamePattern`; a regex text selects nothing | read in official docs (013 V4); verified by experiment |
| Q3 | Is multi-file matching missing? | Multi-file is supported in principle; above 20 files the probe wait did not settle | verified by experiment; read in source code |
| Q4 | Would `--check` have served the original incident? | Not fully: 56 files exceed the 20-file cap. Each row family can be expressed by enumerated texts | inferred from Q3 and cezar's test names |
| Q5 | Does focused selection keep ordinary full-file provenance? | Yes: a focused run stores no result, key, state, duration or checkpoint; the file's own run decides | read in official docs (C4, C5); verified by experiment (output text) |

## Findings

**F1. The API exists and is documented to agents.** C15 "Focused checks" (added 2026-10-23, row 011-135): `--check` selects "the checks of each test file selected by its own path whose full name holds one of the texts". C4 runs them in a focused tier ahead of other classes; C5 keeps the newest focused run per file in `focused:<worktree>`, never as a result; C6 prints `Focused (not counted):`; C14 gives `RunOptions.checks` and `RunnerAdapter.focuses`; 013 V4 turns texts into one escaped `testNamePattern` per file. The Claude Code and Codex skills' `references/commands.md` describe `--check` (`plugins/codex-runtime/skills/squeal/references/commands.md`). Tag: read in official docs and source, repository at 0.1.374 (`8b43591b6`).

**F2. The original incident did not use `--check`.** The issue's command was `squeal status --wait 60000 packages/cezar/src/core/*-parity.test.ts packages/cezar/src/workflows/*-parity.test.ts`, a plain named wait over 56 files, which waits for whole-file runs. That wait reported 47 pending behind a running tier. Why the worker did not use `--check` is not determined: the issue does not say, and the session is not replayed. Tag: read in the issue. 56 matches the file count in `~/projects/cezar` at `991c14b96`: inferred (same glob, local checkout, not the incident's commit `cfb6cbbb`).

**F3. A focused-only wait above 20 unknown files times out.** Probe phase A named 24 fast files with six texts. 20 files got a focused outcome (each `run alone in 0.2 s`); `rows-01` to `rows-04` printed `no focused outcome yet`, and the wait ran to its 120 s deadline, exit 3. Cause, read in source: `writeFocused` (`src/core/scheduler/focused-row.ts:121`) keeps `[...kept, ...runs].slice(-FOCUSED_FILES)` with `FOCUSED_FILES = 20`; C15's outcome is `focused` only "once each such file has a focused outcome at its current key", and a run is not repeated for the dropped files. The spec bounds the row (C5, "at most 20 files") but not the files of a `--check` wait. A focused variant over 56 unknown files could lose 36 outcomes to the same cap. Full-file results can still satisfy C15; this is not proof that every wait above 20 files times out. Tag: verified by experiment on 0.1.374; read in source code.

**F4. Substring matching over-selects numbered rows; regex is not read.** Phase B: `--check ' U2'` on one file selected `U2`, `U2c`, `U20` and `U21` (4 checks, 2.6 s, the last two sleeping rows). Phase C: `--check ' U(2|3|7|12|13|19)[a-z]* '` gave `No check of test/rows-02-parity.test.ts holds " U(2|3|7|12|13|19)[a-z]* " ... (the run collected 13 checks)`. Exact families need one text per row with surrounding spaces. Cezar's parity names have the form `` `${runner} U2 ci and timer open: ...` `` (`packages/cezar/src/workflows/waits-parity-cells.testkit.ts:439`), and its rows include `U2c U2p U2t U2w U20 U20a ... U7d U7f U7h U7k U7m U7q U7w`. The issue's six families come to about 20 texts: possible, error-prone. Tag: verified by experiment (Vitest 4.1.10); cezar names read in source code at `991c14b96`.

**F5. Provenance is preserved.** Every focused block ends `A first run each, not re-run; the file's own run (13 checks) decides.`; status still listed `not current: 24 of 24 test files (24 unknown)` after the focused runs, with no result stored. A `--check` wait asks no whole-file run of an unknown file (C15, row 011-207: "a `--check` wait ... stay[s] lookup-only"). Tag: verified by experiment; read in official docs.

**F6. Speed on the probe.** Unmanaged control, `vitest run test -t ' U(2|3|7|12|13|19)[a-z]* '`: 24 files, 216 passed, 96 skipped, 4.3 s wall. The daemon's focused runs took 0.2 s each for 7 checks per file. Only the 20-file cap kept the wait from returning. The probe's rows are trivial; cezar's 240 rows took 244 s with `--maxWorkers=2`. Tag: verified by experiment, one run, beside the host's own load.

## Probe

`research/probes/issue-123/run.sh`, output in `output.txt`. Squeal 0.1.374 (copy of the installed plugin), Vitest 4.1.10, Node v24.22.1, 24 CPUs, one-minute load 15.24 at start (2026-10-28T17:10Z); refuses to run when load ≥ CPUs. Fresh `/tmp/i123-*` with its own `HOME` and `XDG_RUNTIME_DIR`; its daemon stopped and the directory removed at the end. Commands:

```sh
npx vitest run test -t ' U(2|3|7|12|13|19)[a-z]* '
squeal status --wait 120000 test/*-parity.test.ts --check ' U2 ' --check ' U3 ' --check ' U7' --check ' U12 ' --check ' U13 ' --check ' U19 '
squeal status --wait 60000 test/rows-01-parity.test.ts --check ' U2'
squeal status --wait 60000 test/rows-02-parity.test.ts --check ' U(2|3|7|12|13|19)[a-z]* '
```

The original Cezarion incident was not replayed.

## Recommendation for Squeal

- Treat F3 as a defect in 011 C5/C15: a `--check` wait over N files must settle once each file has an outcome, whatever N. Options for the spec: the wait's files are never dropped from the row while the wait is open; or the row's cap is at least the files of open waits; or the CLI refuses or splits above the cap with a stated limit. The cap also matters for `squeal status` with no wait.
- Treat regex or word-bounded matching (F4) as a separate enhancement, decided by the human. Tradeoff: a regex is one argument for row families and matches the issue's workaround, but Vitest 4 joins names by a space, not ` > ` (013 V4, row 011-173), so a raw regex needs its own post-filter rule. A whole-word or row-token text form is narrower.
- Relation, for the parent's duplicate check: gh-64 (closed) delivered the capability; this issue is new in F3 and F4.

## Open questions

1. Why the Codex worker did not use `--check` (skill text not read, or read and judged unfit): not determined, because the session was not replayed.
2. Whether cezar's parity files were each fast at the incident (a slow file gets no focused run): not determined; cezar's `slow.include` names only `packages/web/e2e/*.e2e.ts` today (read in `~/projects/cezar/squeal.config.json`).
3. The real wall time of a focused tier on cezar's 56 files: not measured.

## Sources

- Issue: `gh issue view 123 --repo hearsay-tools/squeal`, read 2026-10-28.
- `docs/specifications/011-core/spec.md` C4 (focused tier), C5 (focused row), C6 (status lines), C14 (`RunOptions.checks`), C15 (Focused checks, 011-206/207 amendments); `docs/specifications/013-vitest-runner/spec.md` V4; `docs/board.md` rows 011-143 to 011-146, 011-171; repository at `8b43591b6`.
- `src/core/scheduler/focused-row.ts:28,121`; `src/core/scheduler/focused.ts:30`; `plugins/*/skills/squeal/references/commands.md:51`.
- Cezar: `~/projects/cezar` at `991c14b96`, `packages/cezar/src/workflows/waits-parity-cells.testkit.ts`, `squeal.config.json`.
- Probe: `research/probes/issue-123/`.

Coordinator review: the probe output is a bounded excerpt, and its JSON extraction failed. The saved `exit 0` for phase C is the shell pipeline status, not the Squeal exit code. No JSON field or phase-C exit-code conclusion is drawn. The direct control selected 216 tests, while the six focused texts selected seven per file (168 total); their times are not an equivalent-selection benchmark.
