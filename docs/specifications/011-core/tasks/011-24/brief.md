# 011-24 brief: design, status organized around the verdict

Approved by the human on 2026-10-20 (`docs/triage/2026-10-20-digest.md`, groups A and B). Spec text only, now; code rows are numbered after the human accepts the design and run after 011-22 lands.

Use /worker. Shape: survey, docs only: a design draft for the human. Outcome: one file, `tasks/011-24/design.md`, that the human can accept as amendments to 011 C6 and C15 and 005 D2.

Read: the board's 011-24 row; 011 C4, C5, C6, C15 and `status.md`; 005 D2; the findings `research/issue-{38,39,40,41,42,43,44,45}.md` and `../004-slow-suites/research/issue-46.md`; 011-10's row (verdict last); the human's direction at the end of `issue-44.md`.

Seams to read, not edit: `src/cli/status-command.ts`, `src/cli/status-wait-lines.ts`, `src/cli/status-wait-paths.ts`, `src/core/status/` and the registration header and Stop formatters.

The design answers, each with one recommendation and, where the choice is the human's, at most three options:

1. The order and length of `squeal status`, a named wait and `status <path>...` without `--wait`: verdict, outstanding work, actionable failures; notes behind a flag; full worktree status still reachable; the verdict still the last line of a wait.
2. Stale and pending counts, in checks and test files, beside `Known failures` in status, the header and Stop, and in `--json`.
3. For each selected file without a verdict, the command that advances it, or the honest absence of one: stale under lookup-only, timed out, inside a running backlog tier, slow, unmatched (its resolved base), and a running slow file's shared-environment hint.
4. Every text that must change with it: primer, skills, help, eval pins, and the parsers that round-trip the formatters.
5. The code rows, with seams and owners.

Before and after samples, rendered from the formatters or derived from the tests, for each scenario in those findings.

Out of scope: gh-45's request to call an unchanged-key failure stale (declined, C4); per-file caps and load-waiting retries (gh-43, held); interrupting a running tier (001-381); scheduler changes.

Owns `tasks/011-24/` only. Leave alone: spec, status, board, product code. No daemon, suite or build; a scratch script that calls the formatters on seeded snapshots is fine. Done when design.md answers 1 to 5 with samples and is committed. Stop: the human's dated acceptance; code rows come after it.
