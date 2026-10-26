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
- 2026-10-26, the coordinator: survey 017-02 landed (`research/lint-seams.md`, researcher dfbda77f). A per-file lint check fits spec 015's code path, not the test path: it reuses the code pass's trigger, its delivery slot and the rule that a code check is never a known failure and never denies an edit. It needs its own store file and table, a key from `checkKey` over a lint environment (tool and version, resolved config, config files), a fingerprint column and its own policy section. `lint.enabled` defaults to false and does not depend on `complexity.enabled`. A probe through Squeal's real sink showed the test path's harm: a false `FAIL -> FAIL` on an inserted line, a hidden fix, a known failure, and the file dropped from complexity counting.
