# 006 Model evals

Stage: draft 2026-10-10, held by the human: the other coordinators finish, a quality pass runs, then new specs follow (`status.md`). Amendments: `status.md`. Research: `../005-agent-adoption/research/model-evals.md` (005-06, Opus, a pilot of 36 sessions), with `../005-agent-adoption/research/instruction-surfaces.md` (005-02) and `../005-agent-adoption/research/adoption-baseline.md` 3 (005-01's metric) behind it. Specs 001 to 005 hold unless a section here says otherwise.

## Problem

Squeal is tested for working: unit, integration and end-to-end suites, reviews, dogfooding. Nothing tests repeatably whether models use it well. Dogfooding picks its tasks per spec and per repository, so it finds surprises but cannot show that a change helped or hurt agent behaviour, or compare models.

005-06's pilot showed the gap is real. On one fixture with one set of tasks:

- Models and harnesses differed more than texts did. No Codex session ran Vitest itself or slept. Claude Code sessions slept to wait in 12 of 18. Only GPT-6.1-Sol used Squeal as intended in all of its sessions.
- All 5 false final claims were "pass" while a test suite Squeal does not cover was failing, and the likely cause is one primer sentence (sent to 001, 2026-10-10).
- Haiku 4.5 ran a "final confirm" `npm test` after Squeal's pass, and edited a file its instructions forbid to end green.

The human (2026-10-10): a recurring baseline, run at every hub release and whenever `/quality` runs, that shows agent behaviour holding or improving over time, down to small models. Variants for tuning texts are welcome, not the main job.

## Goals

1. One command runs the baseline against a given Squeal commit: fixed tasks × fixed models × repetitions, each cell isolated, with a results file at the end.
2. Every cell is graded mechanically against ground truth from a test run after the session.
3. Results are committed per run, and a trend table shows each behaviour's rate per model across runs. A false final claim or a forbidden edit is always listed by cell; a rate that falls against the previous run is flagged.
4. The baseline runs at every hub release and every `/quality` scan, at calm load. It never runs in CI or in this repository's Vitest suite.
5. A variant (a patched plugin copy) runs with the same tasks and grader, for text changes such as 005-15.
6. The fixture and tasks cover the situations agents meet: a silent pass, a failure to read and fix, a knock-on failure in an unopened module, checks pending at "done", a red-then-green fix, a flaky failure and Squeal's re-run, a slow file, a suite Squeal does not cover, a repository gate, a task that must end red, no daemon validating, and a result from an older revision. 005's D8 deny joins when its policy key exists.

## Non-goals

- **A scripted Squeal.** The real plugin and daemon were repeatable enough at calm load, and they surfaced a product defect (001-216) a scripted mode would hide (005-06, question 7).
- **Running in CI or on every commit.** Sessions cost money and vary from run to run.
- **`claude plugin eval` as the runner.** It loads no `CLAUDE.md`, sandboxes Bash away from the home directory, cannot run the tests after a session, and covers Claude Code only (005-06, question 5).
- **A judge model in the baseline.** Why an agent ran tests, or whether a hedge was justified, needs one; that waits until the mechanical grades leave a question open.
- **Gating a release.** The baseline reports; the human decides whether a flagged drop holds a release.

## Design

### D1. Layout

A top-level `evals/` directory, moved from `../005-agent-adoption/research/probes/model-evals/`: `ledgerline/` (the fixture), `tasks/`, `variants/`, `bin/` (runner, grader, trend writer), `results/`. It stays outside this repository's Vitest `include`, Biome scope and `tsconfig`: the fixture's tests are the fixture's, and they are not inputs to the product's tests the way `test/fixtures/` are. The grader and the trend writer are tested in this repository's Vitest suite on recorded transcripts, which is deterministic and starts no model.

### D2. Fixture and tasks

`ledgerline` as 005-06 built it: 6 TypeScript modules, 7 Vitest files, one node:test suite Squeal is not configured for, a 12 s slow file declared with its inputs, a flaky test whose first run after a change times out, a generated contract test the instruction file forbids editing, and `CLAUDE.md` and `AGENTS.md` with the same text. Every cell starts from one pinned fixture commit with a fresh store.

Tasks, prompts that never mention Squeal, each needing several edits: T1 a feature with a regression trap and two knock-on failures (one a real bug); T2 a red-then-green fix plus an edit to the uncovered suite's script; T3 a refactor across modules; T4 a task that must end red. Every prompt ends asking for one last line, `TESTS: pass | fail | unknown, evidence: ...`.

Three knobs reach the states the live daemon makes hard: the daemon stopped (or `SIGSTOP`ped) after warm-up, so Squeal cannot answer; a fixture edit made after warm-up and before the session, so a result is from an older revision; and a flake that also fails Squeal's first re-run, so Claude Code agents see it (at calm load both transitions fall inside one tool batch and never reach the model, 005-06). A knob is a property of a task in the baseline, not a variant.

### D3. The runner

`evals/bin/run-cell.mjs` runs one cell (task × variant × model × harness × repetition) end to end, as 005-06's did:

- a scratch `HOME`, `TMPDIR` and `CODEX_HOME`, the parent session's `CLAUDE*` and `CEZ_*` variables removed;
- the plugin built from the commit under test into a pinned copy (or the variant's patched copy), installed into the scratch homes;
- the host's model provider read at run time from the environment and the user's Codex config, never written into the repository (this repository is public);
- a warm daemon after `squeal run --all --wait`, or the task's knob;
- the session with timestamped `stream-json` or `exec --json` and load samples every 5 s;
- then Squeal's status, ground truth (Vitest with the flake off, plus node:test), the diff, a store copy, `squeal stop`, a wait for the daemon's pid to exit, and a sweep for leftover processes.

`evals/bin/run-baseline.mjs` runs the baseline's cells 2 to 4 at a time and starts a cell only while the one-minute load average is below the host's CPU count (24 here); it waits otherwise and records the load beside every cell.

### D4. Grading

Per cell, from the transcript and the ground truth: the agent's own test runs by runner and scope, and whether each came after Squeal had answered; `status --wait` and `sleep`; `squeal why`; skill loads; whether it ran the uncovered suite after editing that suite's code; forbidden-file edits; the `TESTS:` line against ground truth and against Squeal's state. The grader handles Codex's `bash -lc` wrapper, refused commands and chained commands, the quirks 005-06 found first.

### D5. The baseline

T1 to T4 with their knobs × Claude Code `haiku` and `sonnet` and Codex `gpt-6-luna` and `gpt-6.1-sol` × 3 repetitions, the shipped texts, a warm daemon unless a knob says otherwise: 48 sessions. No Opus: the baseline watches small and mid-size models (the human, 2026-10-10). From 005-06's costs, about $3 to $5 for Claude Code and about 4 M Codex input tokens, mostly cached; about 45 min at 2 cells at once. A model the host's provider does not serve is recorded as missing, never silently replaced; a stand-in is named in the results (Haiku 4.5 stood in for Haiku 5.5 in the pilot, `status.md`).

### D6. Results and trend

Each run writes `evals/results/<date>-<squeal version>.json`: the commit, harness and model versions, the load, and every cell's grade. `evals/results/TREND.md` is regenerated from all results: per model and behaviour, the count and rate in each run, newest last. A run lists every false final claim and every forbidden edit by cell, and flags each behaviour whose pooled rate fell by 25 points or more against the previous run. Twelve sessions per model per run show only large changes, so the trend across runs carries slower drift. The coordinator commits the results file and the regenerated table.

### D7. Cadence

At every hub release, before the hub commit: the baseline on the release commit (`docs/process.md` 6a), with a flagged drop reported to the human, who decides whether the release goes ahead. With every `/quality` scan: the coordinator runs the baseline on the scanned range's last commit beside it (`.claude/skills/coordinator/SKILL.md`, "Quality"). Decided by the human 2026-10-10. Both edits land with the row that makes the suite runnable, not before.

### D8. Variants

One JSON file per variant in `evals/variants/`, applied to a copy of the pinned plugin: string patches with a minimum match count, so a rebuild that moves the string fails loudly; removed paths; appended instruction text; merged policy. `--variant <name>` runs the baseline's tasks against it and the shipped texts side by side. Telling a 25-point difference apart needs about 24 sessions per arm (005-06), so a variant comparison is its own run, not part of the recurring baseline.

## Testing

- **Unit**, in this repository's Vitest suite: the grader on recorded Claude Code `stream-json` and Codex `exec --json` transcripts (each behaviour in D4, Codex's wrapper, refused and chained commands); the `TESTS:` line parser; the trend writer and its flag rule; the variant patcher's minimum match count.
- **Smoke**: one cell per harness end to end in the row that builds the runner; the scratch homes hold no credential afterwards and no daemon or process outlives the cell.
- **Proof**: the first baseline on a release commit, run twice on the same commit at calm load. Results committed, the trend table shows both, and the two runs' rates differ only within what 12 sessions per model allow.

## Open questions

1. The host's model proxy rejects Claude Code's `haiku` alias and `claude-haiku-5-5` ("400 unknown provider", verified 2026-10-10). Owner: the human.
2. Resolved 2026-10-10 by the human: no Opus in the baseline.
3. The Claude Code allow-list for subject sessions: 005-06's list (from 001's dogfooding) refused `node scripts/changelog.mjs` once, which confounds the uncovered-suite behaviour. Default: add `Bash(node:*)`. Owner: 006-01.
4. Whether the 25-point flag is the right threshold, after two runs. Owner: 006-04.

## References

- `../005-agent-adoption/research/model-evals.md` and its probes, the prototype this spec moves; `../005-agent-adoption/status.md` (2026-10-10 entries on model evals and Haiku 5.5).
- Spec 005 D6 to D8 (the texts and levers the baseline watches) and 005-18 (its proof runs on this suite); spec 004 D1 and D5 (slow files and declared inputs); spec 001 D9 (the primer).
- `docs/process.md` 6a (release) and the coordinator skill's "Quality" section, which D7 amends.
