# Spec 015 Wave 32: `squeal impact --offset <n>` (row 015-129)

Approved by the human on 2026-11-23 ("Build the offset."). Spec amendment: `docs/specifications/015-coverage-complexity/spec.md` D11 ("Amended 2026-11-23").

## W1: Implement `--offset <n>` pagination for `squeal impact`

**Row:** `015-129`
**Shape:** slice
**Model:** `--runner claude --model opus --effort medium`

### File ownership
Edit only:
- `src/core/reach/report-types.ts`
- `src/core/reach/report.ts`
- `src/core/reach/named.ts`
- `src/cli/reach.ts`
- `src/cli/reach-format.ts`
- `src/cli/reach-text.ts`
- `src/cli/main.ts`
- `plugins/claude-code/skills/squeal/references/commands.md`
- `test/reach/**`

Do NOT edit `package.json`, `install.sh`, `plugins/*/dist/**`, `plugins/codex-runtime/**`, `plugins/pi/**`, `plugins/antigravity/**`, `docs/board.md`, or `docs/specifications/**`. The coordinator runs `pnpm run build` (which updates plugin bundles and copies the skill doc) and raises the patch version at integration.

### Requirements
1. **CLI parsing and usage (`src/cli/reach.ts`, `src/cli/main.ts`):**
   - Update `IMPACT_USAGE` and `src/cli/main.ts` help text to:
     `squeal impact [<path>...] [--limit <n>] [--offset <n>] [--json]`
   - Update the `src/cli/main.ts` description line to note `--offset` skips that many entries (default `0`).
   - Parse `--offset <n>` and `--offset=<n>` in `parseArgs` (also works via hidden alias `squeal reach`).
   - Validate strictly as a whole number `0` or more: reject missing value, `""`, whitespace-only `" "`, negative numbers (`-1`), floats (`1.5`), scientific notation (`1e2`), non-digits (`x`), or unsafe integers. Note that `Number("")` and `Number(" ")` evaluate to `0` in JS, so check `/^\d+$/` plus `Number.isSafeInteger(n)`.
   - Also keep `--limit` rejecting `""`, `" "`, `0`, negatives, floats, and non-digits cleanly.
   - Error message on invalid `--offset`:
     `` `--offset takes a whole number of entries, 0 or more, not "${value ?? ""}"` ``
     exiting `2` with `Usage: ${IMPACT_USAGE}`.
   - Default `offset` is `0`. With `--json` and `--offset <n>` without `--limit`, `limit` stays `null` (every remaining entry from `offset` onward).

2. **Report types and slicing (`src/core/reach/report-types.ts`, `src/core/reach/report.ts`, `src/core/reach/named.ts`):**
   - Keep `REACH_REPORT_VERSION = 2` (additive fields).
   - Add `readonly offset?: number` to `ReportOptions` (default `0`).
   - Add additive fields to `ReachReport`:
     - `readonly offset: number;`
     - `readonly totalGateways: number;`
     - `readonly totalFiles: number;`
     - `readonly totalByEdits: number;`
     - `readonly totalTestFiles: number;`
   - Slice each ranked list (`gateways`, `files`, `byEdits`, `tests`) with a clean helper:
     ```ts
     const page = items.slice(offset, offset + limit);
     const more = Math.max(0, items.length - offset - page.length);
     ```
     (Handles both finite `limit` and `Number.POSITIVE_INFINITY` without `Infinity` subtraction bugs; when `offset >= items.length`, `page` is `[]` and `more` is `0`.)
   - In `namedFiles(analysis, snapshot, paths, limit, offset)`:
     - Keep `routes` sliced with `routes.slice(0, limit)` and `moreRoutes: Math.max(0, routes.length - limit)` (do NOT apply `offset` to `routes`, so paginating a file's test files never drops its routes).
     - Slice each route's `tests` with `tests.slice(offset, offset + limit)` and `moreTests: Math.max(0, tests.length - offset - page.length)`.
     - Preserve `route.testFiles` as the total count for that route (unchanged).

3. **Text rendering (`src/cli/reach-format.ts`, `src/cli/reach-text.ts`):**
   - Number displayed entries starting at `report.offset + 1`:
     - `gatewaysPart`: `gatewayLines(e, report.offset + i + 1)`
     - `editsPart`: `editLines(e, report.offset + i + 1)`
     - `fileLines`: already prints `entry.rank` (global 1-based rank in `files`)
     - `testLines`: `testLines(e, report.offset + i + 1)`
   - Section ordering in `formatImpact`: check `report.window === null || report.totalByEdits === 0` (NOT `report.byEdits.length === 0`), so a large `--offset` past `byEdits` does not flip section order!
   - Empty page because of `--offset` (when total > 0 and sliced page is empty):
     - `gatewaysPart`: when `report.totalGateways === 0`, keep existing `"none; no edit in the window went through..."` message; when `report.totalGateways > 0 && report.gateways.length === 0`, print:
       `${title}:` followed by `  none at offset ${report.offset} (${report.totalGateways} in all).`
     - `editsPart`: when `report.totalByEdits === 0`, keep existing `"none; no edit in the window changed..."` message; when `report.totalByEdits > 0 && report.byEdits.length === 0`, print:
       `${title}:` followed by `  none at offset ${report.offset} (${report.totalByEdits} in all).`
     - `files` and `testFiles` in `perEdit`: when `report.totalFiles > 0 && report.files.length === 0`, print `  none at offset ${report.offset} (${report.totalFiles} in all).`; same for `testFiles` (`report.totalTestFiles > 0 && report.testFiles.length === 0`).
     - Named route `tests` in `namedLines`: when `route.testFiles > 0 && route.tests.length === 0 && report.offset > 0`, print `    none at offset ${report.offset} (${plural(route.testFiles, "test file")} in all).`.
   - Footer lines when `more > 0`:
     - For paginated lists (`gateways`, `byEdits`, `files`, `testFiles`, and named route `tests`):
       `  … and ${n} more${what}; --offset ${next} lists the next page, or --limit lists more.`
       where `next = report.offset + shownCount` (indented two extra spaces under a named route's tests, matching existing indentation).
     - For `file.moreRoutes` in named view: keep `  … and ${n} more route${n === 1 ? "" : "s"}; --limit lists more.` unchanged (since `--offset` does not slice routes).

4. **Skill doc (`plugins/claude-code/skills/squeal/references/commands.md`):**
   - Update `## squeal impact` command signature, pagination paragraph (`--limit <n>` and `--offset <n>` in ranked and named views), and `--json` field list (`offset`, `totalGateways`, `totalFiles`, `totalByEdits`, `totalTestFiles`).

5. **Tests (`test/reach/**`):**
   - Update existing usage/footer assertions affected by the updated usage string and footer hint.
   - Add tests (red first!) covering:
     - CLI `--offset <n>` and `--offset=<n>` parsing and invalid inputs (`--offset`, `--offset ""`, `--offset " "`, `--offset -1`, `--offset 1.5`, `--offset x`, `--offset 1e2`) returning exit `2` with updated usage.
     - Hidden alias `squeal reach --offset 1 --limit 1` forwards `--offset` properly.
     - Ranked lists (`gateways`, `byEdits`, `files`, `testFiles`): page 1 (`--limit 1`), page 2 (`--offset 1 --limit 1`), `--json --offset 1` without `--limit`, numbering starting at `offset + 1`, `more*` and `total*`, and footer `--offset <next>`.
     - Offset past the end of `byEdits` / `gateways` / `files` / `testFiles` when edits exist: preserves real-edit-first section order and prints `none at offset N (M in all).` instead of the "no edit in the window" message.
     - Named view with `--offset`: paginates each route's `tests` without dropping `routes`, prints `none at offset N (M test files in all).` for a route with fewer tests than `offset`, and keeps `--limit lists more.` on `moreRoutes`.

### Verification
- Run `pnpm run lint`, `pnpm run typecheck`, and affected tests via `squeal status --wait 60000 <changed-paths>...` (or explicit `pnpm exec vitest run test/reach/*.test.ts` if Squeal is unavailable or uncertain). Do NOT run the full Vitest suite.
- Note: `test/harness/skill.test.ts` may fail until the coordinator runs `pnpm run build` to copy `commands.md` to Codex/Pi/Antigravity; do not touch those generated copies.
- Commit cleanly on your branch and report your final commit SHA, verification commands and actual results, and any decisions or type changes.
