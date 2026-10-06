# Wave 7.5 worker briefs

From `reviews/wave-7.md`. Both `--backend claude --model opus --effort high`, never Fable, from the current main, in parallel on disjoint files. 001-58 (defect 12) shares `src/runners/vitest/adapter.ts` with 001-56 and is dispatched after 001-56 lands.

## 001-56 add rule covers every resolution path

Use /worker. Shape: repair.

Outcome: after an add, no cached transform is reused that the old `invalidateAll` would have dropped, so no add leaves a wrong pass or a closure missing the new file.

Read: `reviews/wave-7.md` B1, S1, S2, N1, N3, N4 and "Inputs for the next wave" 1 to 3; spec D3, D4; Goal 3.

Seam: `src/runners/vitest/stale.ts` `staleTransforms`. First edit: rule 1 of B1 (stale every module with a dep that is not a path and not a Node builtin), then rules 2 (an `enforce: "pre"` plugin passed at `createVitest` in `adapter.ts` `#start`, recording ids whose source uses `import.meta.glob` or a template-literal dynamic import) and 3 (deps under `base + "/"`). S2: feature-detect `invalidationState` once per instance; when missing, invalidate every cached transform and persist one note.

Own: `src/runners/vitest/`, `test/runners/vitest/`, `test/fixtures/vitest/`, the D4 paragraph in `spec.md`, the 001-53 line in `status.md` (correct the figures, S1) plus one dated line. Leave `squeal.config.json` alone (001-57). Agreed with the coordinator: for the S2 note, add an optional `notes?: readonly string[]` to `InvalidateResult` in `src/core/types/runner.ts` and forward each to `context.note` in `src/core/scheduler/refinement.ts` right after `invalidate`, as one standalone commit naming this agreement. Do not run `npm run build` or touch `plugins/claude-code/dist`; a bundle-drift failure is expected, name it.

Done when: the five probe rows of B1 are tests in `structural.test.ts` asserting `affected` and the run outcome; the S2 fallback and the soft-invalidated-then-add case are tests; N1 query stripping is tested; `structural-cost.test.ts` still passes its `cold / 4` guard and reports the ratios; D4 names the three rules and the local and CI figures.

## 001-57 declared inputs for runtime-reading tests

Use /worker. Shape: slice.

Outcome: tests that read files at runtime re-run when those files change, so Squeal never keeps a stale result for them across a bundle rebuild.

Read: `reviews/wave-7.md` "Inputs for the next wave" 4; spec D3 and D11 (`inputs` map); `src/core/daemon/policy.ts`.

Seam: a new committed `squeal.config.json` at the repository root with only the `inputs` map the review proposes (defaults for everything else). Then check that `test/fixtures/vitest/.tmp/` scratch copies are excluded from the watcher (gitignored is enough per D2); if not, add the ignore.

Own: `squeal.config.json`, `.gitignore`, and a new test file under `test/policy/` or `test/e2e/` if one is needed. Leave `src/runners/vitest/` and `test/runners/vitest/` alone (001-56).

Done when: a test (through `loadPolicy` and closure assembly, real store) shows a change under `plugins/claude-code/dist` re-keys exactly `test/harness/plugin.test.ts` and `test/e2e/shipped-plugin.test.ts` (it archives the plugin) and no other test file; a write under `test/fixtures/vitest/.tmp/` produces no revision; `loadPolicy` on the committed file reports no problems.

## After 001-56 and 001-57 land

001-57 landed `6bd9c37..1c31c38`; 001-56 landed `615674a..1d66d1d`, bundles `94f468b`. Three rows in parallel, disjoint files, all `--backend claude --model opus --effort high`.

## 001-59 re-review of 001-56

Use /reviewer. Range `96a14e7..94f468b`. Output `reviews/wave-7.5.md`. Second and last round on this slice.

Outcome: whether `reviews/wave-7.md` B1, S1, S2, N1, N3, N4 are closed, and whether the new rules opened anything.

Read: `reviews/wave-7.md`, spec D3 and D4 as amended, `src/runners/vitest/stale.ts`, `dynamic.ts`, `graph.ts`, the `invalidate` branch of `adapter.ts`, `test/runners/vitest/structural*.test.ts`.

Probe at least: re-run the five B1 probe rows against the candidate; rule 3 leaving out an added `index` file (the worker's claim that Vite reads `package.json` first); the added `package.json` case; the source scan on a file Vite serves but that is not on disk; the `invalidationState` fallback note reaching `notes.<worktreeId>`; the cost on the 1,000-module fixture. Do not re-check what `reviews/wave-7.md` "What fits" lists.

## 001-58 runner-environment failures are not test results

Use /worker. Shape: slice.

Outcome: a broken runner environment never stores a `fail` under a key, so no worktree inherits failures that its code does not cause.

Read: `lessons.md` "A dependency install under a running daemon" and defect 12; spec D5 (runner failure is a state), D8, D10; `src/runners/vitest/run.ts` and `results.ts` (how a file-level error becomes a result).

Seam: where the adapter turns a file-level error into a check result. First edit: classify an error raised while the runner loads modules (ENOENT under the instance's own temp directory, and module-loader errors that name no project file) as a runner failure: the files `unknown`, one note, nothing stored, the instance recreated. A test file's own syntax or import error stays a `fail`. Then recreate the instance when the worktree's installed lockfile appears or changes. Spend at most 20 minutes establishing what deleted the temp directory (`npm ci`, `git checkout`, another instance's `close()`); record the finding or "not established" in your report.

Own: `src/runners/vitest/`, `test/runners/vitest/`, `test/fixtures/vitest/`, `src/core/scheduler/` only if recreation needs a trigger there, D5 and D8 paragraphs in `spec.md`, one dated line in `status.md`. No store schema change: if you need one, ask first. Leave `lessons.md` (001-54) and `reviews/` (001-59) alone. Do not run `npm run build` or touch `plugins/claude-code/dist`.

Done when: a fixture whose Vitest temp directory is removed under a running instance yields `unknown` and no stored result, then passes after recreation; a second worktree with the same keys inherits nothing from it; an install into a worktree with no `node_modules` recreates the instance; a test file with a real import error still records `fail`.
