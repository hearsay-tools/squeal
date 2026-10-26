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
- 2026-10-26, the coordinator: research 017-01 landed (`research/eslint-provider.md`, researcher 222a90cb). ESLint 9 and 10 are 77.5% of downloads and 13 of 15 surveyed repositories that lint with ESLint use flat config. A warm worker gave the CLI's results over 200 edits only with three reload levels: the kept instance for a source edit, a new instance for a config or ignore change, a new worker thread when a file the config loads, a plugin, a shareable config or a tsconfig changes; typed rules also need changed program files linted first. `calculateConfigForFile` plus package versions is not a sound key: it missed 6 of 12 input changes (the file, local rule code, plugin code, an import target read by an untyped rule, a typed program file, the tsconfig). A worker cannot `chdir`, so `cwd` is passed to ESLint. A warm worker held about 290 to 320 MB.
