# End-to-end fixture

Static files of the repository `test/e2e/harness.ts` builds for each scenario. The harness writes `src/*.ts` itself, with a counter comment, so every edit has content no stored result was produced from. `package.json`, `package-lock.json` and `node_modules` come from the harness's cached `npm install` of Vitest.

- `project/`: `test/math.test.ts` (imports `src/math.ts`), `test/strings.test.ts` (imports `src/strings.ts`), `vitest.config.ts`, `_gitignore` (copied as `.gitignore`).
- `slow/`: `test/slow.test.ts`, added for scenarios that need a run still in flight at a hook. It sleeps `SLOW_MS` from `src/slow.ts` before asserting.

Every scenario runs once per plugin (`test/e2e/plugins.ts`): the same repository, beside a copy of the tracked files of `plugins/claude-code` or `plugins/codex` taken from the worktree (002-24). Hook inputs are the recorded JSON of `test/harness/recorded/` (Claude Code) and `test/fixtures/codex-hooks/` (Codex), not files here.
