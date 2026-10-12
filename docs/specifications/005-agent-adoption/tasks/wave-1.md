# 005 wave 1 briefs

## 005-10 the checkpoint's verdict

Use /worker. Shape: slice.

**Outcome:** `squeal run --all --wait [<ms>]` exits 0 only on a completed, current, failure-free checkpoint, 1 on known failures, 3 when Squeal has no verdict, and its first line says which.

**Read:** spec D1 with its 2026-10-12 reconciliation paragraph; 001 D5 and D7 for checkpoints; `status.md`, 2026-10-12.

**Seam:** `src/cli/run.ts`. First edit: replace `ended()`'s bare `end` with a verdict computed from the store at the checkpoint's end, in a new `src/cli/verdict.ts` that 005-11 will import for named files. `--wait` stays valid bare; read `<ms>` as `src/cli/wait-arg.ts` does for `run --slow`.

**Owns:** `src/cli/run.ts`, `src/cli/verdict.ts`, their tests under `test/cli/`, the `## squeal run --all` section of both plugins' `skills/squeal/references/commands.md` (identical).

**Leave alone:** `run-slow.ts`, `status-wait*.ts`, `src/core/status/`, `src/core/delivery/`, `src/harness/`, `evals/`, `CLAUDE.md`, the skills' other sections, `docs/board.md`, bundles (`plugins/*/dist`) and `package.json`'s version.

**Done when:** each exit code is a test, among them a revision recorded during the checkpoint (3), deadline with files pending (3), no daemon (3), a covered file unknown at the end (3), a joined checkpoint (001-217) and an owed one (001-219); a real-daemon failing checkpoint exits 1; tests and file-level checks counted apart in the lines `run --all` prints; lint, typecheck, suite green.
