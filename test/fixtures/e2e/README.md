# End-to-end fixture

Static files of the repository `test/e2e/harness.ts` builds for each scenario. The harness writes the sources of `test/e2e/sources.ts` itself (`src/*.ts`, and `packages/demo/src/math.ts` for `node-test/`), with a counter comment, so every edit has content no stored result was produced from. `package.json`, `package-lock.json` and `node_modules` come from the harness's cached `npm install` of Vitest (`test/e2e/install.ts`).

- `project/`: `test/math.test.ts` (imports `src/math.ts`), `test/strings.test.ts` (imports `src/strings.ts`), `vitest.config.ts`, `_gitignore` (copied as `.gitignore`).
- `slow/`: `test/slow.test.ts`, added for scenarios that need a run still in flight at a hook. It sleeps `SLOW_MS` from `src/slow.ts` before asserting.
- `node-test/`: added over `project/` by `e2eSuite("node-test")` (spec 003). A copy of `test/fixtures/node-test/reference` without its `node_modules`: `packages/demo` with the scripts `test:unit` and `test:package` (`node --import ../../scripts/preload.mjs --import tsx --test ...`), `packages/util` as the workspace package `title.ts` imports, and the preload under `scripts/`. Its `vitest.config.ts` replaces `project/`'s so Vitest takes only `test/**`. Its install is a workspace root with these package manifests, so the lockfiles and `node_modules/@reference` links are npm's own, and tsx is installed beside Vitest. `squeal.config.json` is written by the plugin's own `squeal init`.

Every scenario runs once per plugin (`test/e2e/plugins.ts`): the same repository, beside a copy of the tracked files of `plugins/claude-code` or `plugins/codex` taken from the worktree (002-24). Hook inputs are the recorded JSON of `test/harness/recorded/` (Claude Code) and `test/fixtures/codex-hooks/` (Codex), not files here.
