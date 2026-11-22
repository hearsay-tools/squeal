# Spec 015, Wave 31: row 015-128 (`squeal impact`, real-edit gateway diagnostics, `childProcess` fix, stale-key fallback)

Spec: `docs/specifications/015-coverage-complexity/spec.md` (section `### D11`, amended 2026-11-22) and `docs/specifications/015-coverage-complexity/status.md`.

Two disjoint slices run in parallel. Neither worker runs `pnpm run build` (coordinator builds plugin bundles after integration).

## W1: Core analysis, stale-key fallback, CLI rename and alias, and tests (`claude` / `opus` / `high`)

- **Outcome:** Implement the 2026-11-22 Spec 015 D11 amendment across core analysis, store fallback reader, CLI command (`squeal impact` with hidden deprecated `squeal reach` alias), text/JSON `v: 2` formatting, and unit/store tests.
- **Spec sections:** `docs/specifications/015-coverage-complexity/spec.md` (`### D11`, including the 2026-11-22 amendment), `docs/vision.md`, `docs/styleguide.md`.
- **Shape:** slice.
- **Starting seam:** `src/core/reach/read.ts:63` (drop `ModuleSets` / `modules.of(ref)` from `childProcess`, add newest-stored fallback for missing current-key closures/walks via a new helper in `src/core/store/import-graph.ts` while keeping `readImportGraph` and `closureFor` strict) and `src/core/reach/pairs.ts:166` (evaluate `importPair` when the stored walk reaches the path before `child process` and `runtime read`). Then add `window.rerunSeconds`, `editShare`, aggregate `gateways` (`src/core/reach/gateways.ts` to keep modules under ~300 lines), factual `runtime read` / `child process` diagnostics, `stale` reporting, JSON `v: 2`, and `squeal impact` + hidden `squeal reach` alias in `src/cli/main.ts` and `src/cli/reach*.ts`.
- **Owns:** `src/core/store/import-graph.ts`, `src/core/reach/**`, `src/cli/reach.ts`, `src/cli/reach-format.ts`, `src/cli/reach-proposals.ts`, `src/cli/reach-text.ts`, `src/cli/main.ts`, `test/reach/**`, `test/runners/node-test/child-daemon.test.ts`, `test/scheduler/import-rewalk.test.ts`.
- **Leave alone:** `docs/**`, `plugins/**`, `bench/**`, `package.json`, `src/core/delivery/closure.ts`. Do not run `pnpm run build` or `vitest` full suite.
- **Done when:**
  - Tests cover: `childProcess` restricted to `observedDirect.` (not `observedModules.`); import-walk precedence over `runtimeRead`/`childProcess`; `window.rerunSeconds` and `editShare`; aggregate `gateways` across `setup` root (`chain[0]`), `test helper`, `barrel`, `declared input`, shared `transitive` hub, `runtime read` `observed path` (e.g. `package.json`), and `broad test reader` (tests with `>= 10` module runtime reads grouped by folder/file, e.g. `test/daemon/*`); factual `runtime read`/`child process` notes (no blanket "by design" on `runtime read`); labeled newest-stored fallback on stale-key worktrees (`stale` in JSON and header in text) while `readImportGraph` stays strict; `squeal impact` primary CLI and hidden deprecated `squeal reach` alias (stderr notice on text, quiet on `--json`, omitted from `--help`); JSON `v: 2`.
  - `pnpm run lint`, `pnpm run typecheck`, `squeal status --wait 60000` (or explicit `pnpm exec vitest run test/reach/*.test.ts test/scheduler/import-rewalk.test.ts test/runners/node-test/child-daemon.test.ts` if Squeal is unavailable) pass.
- **Role:** Use /worker.

## W2: Skill reference and `bench/` rename (`claude` / `opus` / `medium`)

- **Outcome:** Update the Squeal skill command reference and `bench/` scripts/docs from `squeal reach` to `squeal impact` per the 2026-11-22 Spec 015 D11 amendment, preserving backward compatibility in `bench/` when comparing older releases.
- **Spec sections:** `docs/specifications/015-coverage-complexity/spec.md` (`### D11`, including the 2026-11-22 amendment), `docs/styleguide.md`.
- **Shape:** slice.
- **Starting seam:** `plugins/claude-code/skills/squeal/references/commands.md` (`## squeal reach` -> `## squeal impact`, documenting real-edit leading output, `gateways`, factual `runtime read` diagnostics, stale-key fallback, JSON `v: 2`, and the hidden deprecated `squeal reach` alias) and `bench/run-cell.mjs:310` (invoke `impact --json`, falling back to `reach --json` if `r.code === 2` for older `--ref` comparisons; keep `cell.phases.reach` or support `impact ?? reach` in `bench/summarize.mjs` so older `bench/results/` stay readable).
- **Owns:** `plugins/claude-code/skills/squeal/references/commands.md`, `bench/README.md`, `bench/run-cell.mjs`, `bench/summarize.mjs`.
- **Leave alone:** `src/**`, `test/**`, `docs/**`, `plugins/*/dist/**`, `plugins/codex-runtime/**`, `plugins/pi/**`, `bench/results/**`, `package.json`. Do not run `pnpm run build`.
- **Done when:**
  - `plugins/claude-code/skills/squeal/references/commands.md` accurately documents `squeal impact` and matches D11 (amended 2026-11-22).
  - `bench/run-cell.mjs`, `bench/summarize.mjs`, and `bench/README.md` name `squeal impact` cleanly while still comparing older `--ref` releases that only have `squeal reach` and reading existing `bench/results/` files (`node --check bench/run-cell.mjs bench/summarize.mjs` passes; `pnpm run lint` passes on owned files).
- **Role:** Use /worker.
