# 017 lint checks: status

Stage: draft (research)
Started: 2026-10-26

## Decisions so far

- 2026-10-26, the human, after spec 016's experiments 016-33 (`../016-extensions/research/diagnostic-identity.md`) and 016-34 (`../016-extensions/research/binding-cost.md`): "First check: ESLint (Recommended)". Squeal's first check that is not a test is a project's own ESLint, run live after each edit. The options were ESLint, TypeScript type errors, Ruff and any tool through a report file.
- 2026-10-26, the coordinator's starting points, from those two findings files, for the research to confirm or change:
  - One check per file per tool. It holds the file's whole set of findings, replaced at each run, with a failure fingerprint of the sorted rule and message of every finding and no line (016-33 a-set). A notice names the findings added and removed, as evidence only.
  - The provider runs warm in its own worker thread, never in the daemon's thread: in-thread, a blocking provider stopped the daemon's timers and a throwing timer ended it (016-34 finding 4). Its scheduling hints are declared data, not calls (016-34 finding 3).
  - Typed rules make a file's findings depend on the whole program (016-33 Q4), so a file's key must hold the program's files when such rules are on.
  - Nothing changes for a project that does not turn the check on.
