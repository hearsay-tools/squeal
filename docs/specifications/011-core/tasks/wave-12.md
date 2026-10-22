# Wave 12 of spec 011

The human, 2026-10-22: items 1 to 3 in parallel, and a digest for gh-70 to gh-74 now. Item 1 (011-99, with a load measurement in about a day) already runs under coordinator 3800fd79 (worker 796bfe06), so this wave has two code rows and the digest. Each starts from main with 0.1.256. 005-74 and 005-75 are spec 005 rows; their brief is here so that the wave has one file.

## W1: 011-32, then 011-34, the daemon handoff after an upgrade (gh-47)

Use /worker. Shape: slice, two commits or more, 011-32 first.

Outcome: after a plugin upgrade, each worktree gets exactly one successor daemon, and `start` and `status` name the handoff while it runs.

Read board rows 011-32 and 011-34, `tasks/011-30/design.md` sections 2 and 4 with R2 and R4, and spec 011 C6, C8 and C9 with their amendments since 2026-10-20 (011-65's restart handover and 011-20's stop mark landed after the design: read their notes under `tasks/`).

Seam: a new `src/core/delivery/handoff.ts` for the `daemon-handoff:<worktree>` claim, then `ensure`, `ensureIfStale` and `successor`. A lead: write the six-boundaries test from 011-32's done-when first.

Owns: `src/core/delivery/`, the daemon's `#register` and lock wait, `src/core/status/` for the stopping reading, `src/cli/start.ts`, the skill's `commands.md`, the evals parsers the row names, their tests, `test/daemon/handover-tier.test.ts`, notes under `tasks/011-32/` and `tasks/011-34/`. Not yours: the launcher (W2), the 011-99 test files, the board, spec text, bundles, version.

Done when: both rows' done-when hold; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.

## W2: 005-74 and 005-75, one launcher change

Use /worker. Shape: slice, one commit per row.

Outcome: a command through the launcher starts Node once, and the harness-skew notice names the version the launcher runs.

Read board rows 005-74, 005-75, 005-73 and 005-76, `reviews/0.1.247.md` S1, and spec 005 D3 on the launcher.

Seam: `plugins/claude-code/bin/squeal-launcher`, now the only source; the build copies it to the other three plugins (005-76). Lines 88 to 95 for 005-74; the `node -e` lookup for 005-75. A lead: let the CLI entry do the lookup the shell now asks Node for, so one process does both.

Owns: `plugins/claude-code/bin/squeal-launcher`, the CLI entry the lookup moves into, `test/cli/launcher.test.ts` and the launcher's other tests. Raise the launcher's format line (format 5 since 014-33) if installed copies must be replaced to get the change; say which in the notes. Not yours: W1's files, `install.sh` beyond its launcher copy, the board, spec text, bundles, version. Do not run `npm run build` in your tree: copy-identity tests that need a rebuild are the coordinator's.

Done when: both rows' done-when hold, with the process count and the CPU per `squeal --version` in `tasks/005-75/notes.md`; lint, typecheck and `squeal run --all --wait` pass (bundle drift and copy identity excepted), their output in your summary.

## D1: triage digest for gh-70 to gh-74

Use /worker. Shape: survey, docs only.

Outcome: `docs/triage/2026-10-22-digest.md` lets the human decide the five proposed friction rows in one round.

Read `docs/process.md` "Issue triage", the board's Triage rows gh-70 to gh-74, their research files (`011-core/research/issue-70.md`, `issue-72.md` to `issue-74.md`, `002-codex-adapter/research/issue-71.md`), the GitHub issues (`gh issue view <n> --comments`), and `docs/triage/2026-10-21-digest.md` as the model.

Write the digest: group the five rows by theme, name overlaps with planned rows (for example gh-72 and 011-32/011-34, gh-70 and 005-73), and give one recommendation per group with what it costs. Say what is already shipped. Commit that one file. No board, spec or code edits, and no reproduction runs.
