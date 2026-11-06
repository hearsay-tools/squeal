# Wave 11: row 019-49, silence is not a pass, and a narrow run

One row, one worker (slice). Use /worker.

**Outcome.** When no test group runs at `edit`, the primer, the skill and the status texts say that silence between edits is not a pass. `squeal run <group> <path>... [--wait <ms>]` runs only the group's files that the paths select.

**Read.** Spec 019 D6, the items "No test group at `edit`" and "Narrow run" (amended 2026-11-06), with D1 "Moments" and D4. Spec 011 C4 step 4 for the edit work. `status.md`, the last entries.

**Seams and first edits (leads, not orders).**
- Primer: `src/harness/shared/primer.ts`, `primer()`. The first sentence and `waitSentence` take a flag for "no test group at `edit`", read from `coverage.groups` (`GroupsCoverage`, built by `groupsCoverage`). The D6 example must render within `PRIMER_CAP_CHARS` and keep its folding order (`every`/`first`/`none`, `plain`/`paths`/`short`).
- Silence texts elsewhere: `src/harness/shared/context.ts`, `src/core/delivery/format.ts`, `src/cli/codex/trust.ts` (grep "stay silent"), and `plugins/*/skills/squeal/references/*.md` in every plugin that has them.
- Narrow run, scheduler: `queueGroup` in `src/core/scheduler/slow-tier.ts`. Add a form that takes paths. A test file path selects itself. A source path selects the edit work among the group's files (`editWork` and `fetchEditCut` in `src/core/scheduler/edit-cut.ts`, `namesakesOf`). Current files do not run again.
- Narrow run, request and CLI: `src/cli/run.ts` (`groupArgs`), `src/cli/run-group.ts`, `src/cli/run-group-wait.ts`, `src/core/daemon/run-group.ts`, the `run-group` protocol in `src/core/daemon/protocol.ts`. The paths field is additive. An older daemon that ignores it must not be read as a narrow run: the CLI says the daemon predates it, as `GROUP_NOT_SUPPORTED` does. `--wait` waits for the selected files only. The answer names the group's other reached files, other groups' selected files with `squeal run <other> <path>...`, and paths that select nothing. A lint group with paths is a usage error.

**Owns.** Everything above and its tests. No sibling workers this wave.

**Leave alone.** `docs/` (the board and spec are the coordinator's). `package.json` version and `plugins/claude-code/dist`: do not run `pnpm run build` in your tree.

**Done when.**
- Primer tests (`test/harness/primer-*.test.ts`, Claude Code and Codex CLI naming) cover a policy with no test group at `edit`, the default `tests` group with no files included. They show that a policy with an `edit` test group renders as before.
- Status and skill wording tests for the same policy.
- Scheduler tests in a fixture with Vitest and node:test cover a narrow run of a `stop` group and of a `manual` group. A test file path and a source path (namesake, and a source with no namesake falls back to direct importers) each select the right files. The group's other files stay waiting. Stop's request stays whole.
- CLI tests (`test/cli/run-group*.test.ts`) for `--wait`, other-group files, unmatched paths, a lint group with paths, and an older daemon.
- Lint and typecheck pass. `squeal status --wait 60000 <changed-path>...` shows no failure you caused. Report its output.
