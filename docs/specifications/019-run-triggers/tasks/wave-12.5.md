# Wave 12.5: repair of cand/0.1.412 (row 019-52, review B1 and S1)

One worker, shape: repair. Use /worker.

**Outcome.** The narrow command a named wait prints runs exactly the left files it names, and the help states the full edit rule.

**Read.** `reviews/0.1.412.md` B1 and S1; spec 019 D6 "Narrow run" (the 019-52 sentence, amended in this wave).

**B1 (coordinator's decision, 2026-11-06).** Do not print the wait's source paths. Print the left test files' own paths: a test file path selects itself, so the command runs exactly what the clause lists. In `leftGroupText` (`src/cli/status-wait-groups.ts`): with up to 10 left files of the group (the files the clause already names), the command is `squeal run <group> <left test file>... --wait 60000` and the clause may say it runs them now. With more than 10, name `squeal run <group> --wait 60000` for the whole group, as before 019-52, and nothing narrower. Keep shell quoting, Codex naming, and the stop-group requirement wording. The `LeftGroup.paths` field and the unmatched-path filter then have no use; remove them if nothing else reads them.

**S1.** `src/cli/main.ts:143`: say that a source selects its namesakes, or with none its direct importers, then the `runner.tierSize` shortest other direct importers, as `plugins/claude-code/skills/squeal/references/commands.md:122` says. Pin it in `test/cli/main.test.ts`.

**Tests.** Replace the 4-path and 1-path cases with left-file counts of 1, 3, 10 and 11. Add the review's source-reader case: `src/core.ts` read by three manual-group tests, `tierSize` 1. A named wait on `src/core.ts` prints a command, the command is executed as printed through the real scheduler (as `test/scheduler/narrow-run.test.ts` and `test/daemon/run-group-paths.test.ts` drive it), and all three files run.

**Owns.** `src/cli/status-wait-groups.ts`, `src/cli/status-paths.ts`, `src/cli/status-wait-paths.ts`, `src/cli/status-wait-lines.ts`, `src/cli/main.ts`, their tests. **Leave alone:** `docs/`, versions, bundles, `test/hash`, `test/keys`. No `pnpm run build`.

**Done when.** The source-reader test fails on 68924c8ef and passes after. Lint, typecheck, `squeal status --wait 60000 <changed paths>` reported; do not wait past the files the change reaches.
