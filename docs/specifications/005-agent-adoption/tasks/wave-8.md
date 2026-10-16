# 005 wave 8: the first Triage rows

Approved by the human on 2026-10-17 (`docs/triage/2026-10-17-digest.md`, groups A and F). Dispatch waits for the host (load below the CPU count, at most 3 workers across the repository). Standing models from the board. 005-67 and 005-69 both live under `src/cli`; 005-67 owns `status-wait-paths.ts` and 005-69 owns `main.ts`, so they run in parallel; 005-68 is texts only and runs beside them.

## 005-67: a named test file selects only itself

Use /worker. Shape: repair. Outcome: D2 holds as written. Read 005 D2, `research/issue-6-exact-file-waits.md`, its probe, and 001 `research/issue-17.md` finding 1. Seam: `src/cli/status-wait-paths.ts`, `selectNamedFiles`; first edit: a path that is a listed test file selects itself and skips the closure lookup. Owns: `src/cli/status-wait-paths.ts`, `status-wait-lines.ts` if the named line changes, `test/cli` wait tests. Leave alone: `src/cli/main.ts` (005-69), the scheduler (011-03 decides promotion), the primer (005-68). Done when: the probe's overlap cases are regressions and pass, source-path selection is unchanged, suite green, version raised. Stop: no queue order change.

## 005-68: the primer and the skill name the path-scoped wait

Use /worker. Shape: slice, texts. Outcome: an agent learns `status --wait <ms> <path>...` from the primer and the skill. Read 005 D6 (amended 2026-10-17 by this row), `research/issue-18-primer.md`. Seam: `src/harness/shared/primer.ts`, the wait sentence; then `src/cli/setup/block.ts` and the four skill copies under `plugins/*/skills/squeal` (`SKILL.md`, `references/commands.md`). Owns: those files and the text tests and eval pins they break. Leave alone: CLI behaviour. Done when: the four copies agree, the primer cap holds, text tests and pins pass, version raised. Stop: wording only.

## 005-69: subcommand `--help` exits 0

Use /worker. Shape: slice. Outcome: `squeal <subcommand> --help` is not an error. Read `research/issue-11.md`. Seam: `src/cli/main.ts`, where a subcommand's unknown flag exits 2; first edit: `--help` prints the subcommand's flags and exits 0 before any work. Owns: `src/cli/main.ts`, `test/cli` help tests. Leave alone: `status-wait-paths.ts` (005-67). Done when: every dispatched subcommand has the regression (exit 0, flags printed, no daemon spawn, no store write) and an unknown flag still exits 2, suite green, version raised.
