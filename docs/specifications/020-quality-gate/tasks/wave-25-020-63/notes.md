# Row 020-63: the text report shows reruns (wave 25 notes)

## What changed

- `src/cli/code-gate-text-reruns.ts` (new, 77 lines): `rerunLines(run)`, at most two lines per runner.
  - Load reruns (row 020-54, `runs[].retried`): `  2 Vitest test files failed while the host load was at or over its CPU count (20 on 8 CPUs) and ran once more: 1 passed (test/l.test.ts), 1 did not finish, so the first failure stands (test/m.test.ts)`
  - Stored reruns (row 020-60, `runs[].storedRerun`): `  6 failed Vitest test files read from the stores ran once more (--rerun-stored-failures): 4 passed (test/a.test.ts, test/c.test.ts, test/d.test.ts and 1 more), 1 failed again (test/b.test.ts), 1 did not finish, so the stored failure stands (test/e.test.ts)`
- `src/cli/code-gate-text.ts`: `runLines` appends `rerunLines(run)` after the run's failed, unfinished, not-started, over-budget and prepare lines. Header comment names the row.
- `test/cli/code-gate-text-reruns.test.ts` (new).

Before this row the text report showed neither `runs[].retried` nor `runs[].storedRerun`; only the stderr lines did. Both are added.

## Decisions the spec did not settle

1. One line per runner and kind, not one line for all runners: every other run line in the text (not started, over budget) is per runner and names it (`Vitest`, `node:test`). The stderr lines stay one line for all runners.
2. Same outcome words and same order (passed, failed again, did not finish) as the stderr lines, so the two read alike. The words are a copy of the two private tables in `src/core/code/gate/retry.ts`, which this row does not own. A later quality pass could export them from `retry.ts` and share them (one owner edit).
3. The load line keeps the highest load per CPU, as the stderr line does, but per runner.
4. Order: the load line before the stored line, as on stderr.
5. Paths: at most three per outcome, sorted, then `and N more` (`listPaths`); `--json` lists all.
6. An empty `retried` or `storedRerun` object gives no line, the same as absent.

## Proposed spec text

D1, append to the text report's list (or D7's row 020-60 paragraph):

> Added 2026-11-14 (row 020-63): the text report gives each runner with reruns one line per kind after its other run lines. For the reruns under load (D3.4, `runs[].retried`): the count, the highest load per CPU as load and CPU count, and each outcome's count with at most three paths, for example `  1 Vitest test file failed while the host load was at or over its CPU count (24 on 24 CPUs) and ran once more: 1 passed (test/flaky.test.ts)`. For the stored failures `--rerun-stored-failures` reran (`runs[].storedRerun`): the count and each outcome's count with at most three paths, for example `  1 failed Vitest test file read from the stores ran once more (--rerun-stored-failures): 1 passed (test/flaky.test.ts)`. A run with neither gets no line, so its text is as before. The JSON, the verdict and the exit code do not change.

## Done-when mapped to tests (`test/cli/code-gate-text-reruns.test.ts`)

- A report with stored reruns prints the line with the right counts and paths: "counts each stored rerun's outcome and names at most three paths of each" (6 files, 3 outcomes, the "and 1 more" cut), and "gives each runner its own line, one file in the singular" (Vitest and node:test).
- Load reruns: "names the load reruns with the highest load per CPU, before the stored reruns" (20 on 8 wins over 30.5 on 24).
- With no reruns the text is byte-identical: "is byte-identical to a report without reruns when none ran" (empty objects equal absent fields, and the full text is pinned).
- Verdicts and exit codes unchanged: the same test asserts the verdict line with stored reruns equals the line without. The exit code is `EXIT[report.verdict]` in `src/cli/code-gate.ts`, which this row does not touch; the formatter only reads the report.

## Checks run

- `squeal status --wait 60000 src/cli/code-gate-text.ts src/cli/code-gate-text-reruns.ts test/cli/code-gate-text-reruns.test.ts` at revision 4: 8 current, all pass, including `code-gate-text-reruns`, `code-gate-text`, `code-gate-text-failed`, `-omitted`, `-prepare`, `-started`. 347 other selected files (every file that imports the CLI) were still queued behind a running tier at the 60 s deadline: no verdict for them.
- `pnpm run lint`: no fixes. `pnpm run typecheck`: clean.

## Checks not run

- `pnpm run build` (wave rule: no build in a worker tree; `plugins/claude-code/dist` is not owned).
- No full suite (process rule). The 347 queued affected files had no verdict when I finished.
