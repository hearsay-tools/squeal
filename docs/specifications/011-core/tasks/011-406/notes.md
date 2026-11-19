# 011-406 and 011-407: notes (wave 123 W3)

Worker cb891575, 2026-11-19. Two commits: 011-406 (folder selection), then 011-407 (Status JSON reference, help pointer, these notes).

## 011-406: what was built

- `src/cli/named-selection.ts`: a named path that resolves (against the cwd, or its real path) to a real folder inside the worktree selects the listed test files under it, by `at-keys-narrow.ts` `selects` ("the path or below it"; `""` is the root). Order per path: an exact listed test file first, then a folder, then readers (closures). A folder is never sent to the daemon as a source path (`sourcePaths` skips it).
- `src/cli/named-path-lines.ts`: `Directory: <folder>; it selects the N listed test files under it` ("at least" while partial).
- `src/cli/named-file-lines.ts`: an empty folder reads `no listed test file is under the folder <folder>`; a path not on disk that is a prefix of listed test files adds `; it is not a file or folder; N listed test file(s) start(s) with it: a, b; name them` (the first five, then `and N more`).
- Promotion and focus are unchanged: `ownNamedFiles` (wait/named.ts) matches exact paths only, so a folder's files are not promoted or focused. Not edited.
- `fixedSelection` (verdict.ts) is unchanged: `directory` is not `test-file`, so a folder is already on the "can grow" side. Not edited.

## Decisions the brief did not settle

1. The root is shown as `.` in `selection.paths[].path` and `unmatched` (internally `""`). `.`, `..` from a sub-folder and the absolute root all give `.`.
2. An empty folder has `kind: "directory"`, `selects: 0`, and is in `selection.unmatched` (so `reason: unmatched`, exit 3, and a wait returns at once as `outcome: unmatched`). Its text is its own (`no listed test file is under the folder X`), not the closure text.
3. The prefix hint is given only when the path is not on disk and selects nothing. A deleted source path that closures still hold keeps selecting as before. A real file (source) that happens to prefix a test file gets no hint.
4. The hint names at most five files, then a count.
5. A folder outside the worktree stays unmatched, as any outside path.
6. Folder detection reads the disk (`statSync`) at each selection read, as the brief says "real folder"; a folder created during a wait is seen at the next poll.

## Type and JSON changes (additive)

- `NamedPath.kind` gains `"directory"` (src/cli, the only `NamedPath` type).
- `UnmatchedPath` gains optional `folder?: true` and `startsWith?: readonly string[]` (text only; not in the JSON payload).
- JSON: `selection.paths[].kind` may be `"directory"`; `selection.unmatched` may hold a folder or `.`.
- Exported `folderPath(root, cwd, path)` in named-selection.ts.

## 011-407

- `## Status JSON` in `plugins/{claude-code,codex-runtime,pi}/skills/squeal/references/commands.md`, byte-identical. The Codex seed copy already differed from the others before this row and no test compares it; left alone.
- The reason list follows `selectionResult`'s order (verdict.ts), which is the precedence: no-daemon, lapsed, on-hold, paused, focused, unmatched/not-run (no path selects a file), unsynced, unlisted, pending, not-current, then (with every file current, no failure) not-run, unmatched. `fail` comes after the class reasons: a pending file gives `pending` even with a known failure elsewhere in the selection.
- The section covers only `selection`; lint status fields (017-33's `linting.cpuWait`) are not named, per the coordinator.
- `status --help` (main.ts) names folders and points to the section.
- `plugins/*/dist` holds the help text: it drifts until the coordinator's build (no build in the worker's tree, per the wave rules).

## Proposed spec amendments (plain text; the coordinator lands them)

005 D2, after "A test-file path selects itself. Any other path selects the test files whose closure holds it.": "A path that is a real folder in the worktree (`.` the root) selects the listed test files under it, and only them; source files under it are not expanded. Files a folder selects are not promoted, asked or focused; only a test file named by its own path is. A folder with no listed test file under it selects nothing (exit 3). A path that is neither a file nor a folder selects nothing; its message names the listed test files whose path starts with it, and selects none of them." (row 011-406, gh-169)

011 C15, the named-path kinds: "`directory`: a real folder, which selects the listed test files under it (`Directory: <folder>; it selects the N listed test files under it`). A folder's selection can grow with the listing, like a source path (`fixedSelection` false)." (row 011-406)

011 C6, status JSON: "The skill's `references/commands.md`, section "Status JSON", is the published contract of `selection`: `code`, `result`, `reason` with its precedence, `outcome`, `complete` (not a verdict), `verdict`, `testFiles`, `paths`, exit codes 0/1/2/3, and the unavailable-store shape (`available: false`, no `selection`). Empty or unparseable output from a killed command is not a Squeal answer. `status --help` points to it." (row 011-407, gh-242)

## Checks

See the final report for the `squeal status --wait` output; direct runs:

- `timeout 300 pnpm exec vitest run test/cli/status-wait-folder.test.ts`: 10 passed.
- `timeout 600 pnpm exec vitest run test/cli/status-wait-mixed.test.ts test/cli/named-partial-selection.test.ts test/cli/named-file-lines.test.ts test/cli/selection-paths.test.ts test/cli/status-wait-folder.test.ts`: 36 passed.
- `timeout 600 pnpm exec vitest run test/harness/skill-wait.test.ts test/cli/main.test.ts test/cli/checks.test.ts test/harness/shared/skill-pytest.test.ts`: 40 passed.
- `pnpm run typecheck`, `pnpm run lint`: clean.
- e2e: `grep` of `test/e2e` for the changed paths found only comments ("closure holds"); no e2e file imports them, so none was run.

## `squeal status --wait` evidence

`squeal status --wait 560000` on the eight changed paths (`src/cli/named-selection.ts`, `named-file-lines.ts`, `named-path-lines.ts`, `main.ts`, `test/cli/status-wait-folder.test.ts`, `test/cli/main.test.ts`, `test/harness/skill-wait.test.ts`, `plugins/claude-code/skills/squeal/references/commands.md`), revision 13, last read about 16:20 UTC on 2026-11-19: 496 test files selected; 480 current, 16 still pending (queued, waiting for CPU on a busy host), no verdict (exit 3). Six known failures, all build output drift that the coordinator's bundle build clears (no build in a worker's tree):

- `test/harness/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/codex/packaging/runtime.test.ts` ("has the bundles exactly as ... produces them"): `cli/squeal.mjs differs from the build`, from the `status --help` text in `main.ts`.
- `test/harness/codex/packaging/runtime.test.ts` ("its manifest as the build writes it") and `test/harness/codex/runtime-release/limits.test.ts`: `runtime file skills/squeal/references/commands.md does not match its sha256`; `plugins/codex-runtime/runtime.json` is rewritten only with the bundles.

No other failure among the 480 current files.
