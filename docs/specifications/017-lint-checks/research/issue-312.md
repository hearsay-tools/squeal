# Issue 312: lint summary provider scope

2026-11-28. Source: [#312](https://github.com/hearsay-tools/squeal/issues/312), an agent-reported friction issue.

Recommendation: extend the approved tool-scope wording from commit reports to CLI and status summaries. Keep support for a project's own lint script outside this proposed change. Human approval is still needed.

## Questions and verdict

| Question | Answer |
| --- | --- |
| Does aggregate text omit the tool name? | **Verified by experiment:** yes, in the real CLI and status formatter functions with synthetic completed state. |
| Is the original incident reproduced end to end? | **Not reproduced, because** this repository has lint disabled and the reporter's Squawk daemon and CI state were not replayed. The direct CLI attempt reports lint off. |
| Which spec owns the surfaces? | **Read in source code/spec:** 017 D8 owns details, status and registration wording; D11 adds oxlint and tool identity. 011 owns the surrounding status surface. |
| Does #219 already cover this? | **Read in source code/spec:** 017 D8's 2026-11-19 amendment from #219 applies tool names and coverage to commit reports. Its status and registration examples still omit tool names. This issue asks for the remaining surfaces. |

## Environment and exact commands

**Verified by experiment:** the one-minute load was `0.35` on `16` online CPUs, below the skip threshold. `cat /proc/loadavg` returned `0.35 0.27 0.25 1/738 2972007`; `getconf _NPROCESSORS_ONLN` returned `16`. No heavy workload was started.

Commands from the repository root:

```sh
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
launcher="$HOME/.codex/plugins/data/squeal-hearsay/bin/squeal"
"$launcher" --version
"$launcher" lint
"$launcher" status
git rev-parse HEAD
git diff squeal--v0.1.665 HEAD -- src/cli/lint-report.ts src/core/lint/surface/format.ts src/core/types/lint-delivery.ts
pnpm exec tsx docs/specifications/017-lint-checks/research/probes/issue-312/format.ts
```

The launcher version was `0.1.665`, the same version the issue reports. It also noted that installed plugins had mixed versions. The live `lint` command returned:

```text
Lint is off: lint.enabled is false in squeal.config.json.
```

The live `status` command showed revision 0, a worktree still starting, and no lint summary. Thus these two direct reads do not reproduce the issue here.

The component probe ran against checkout `38783e11f2cb5bcb66a1df67528a89190a81cd00` (package version `0.1.667`). The three formatting/type source files above had no diff from release tag `squeal--v0.1.665`. The probe output was:

```text
CLI clean summary:
Lint: 0 files with findings
Status clean summary:
Lint: 0 files with findings; squeal lint lists them.
Positive oxlint control:
Lint: 1 file with findings
  src/a.ts (oxlint): 1 finding, linted at revision 16
    1:1  warning  eslint(no-unused-vars)  Unused variable.
```

**Verified by experiment:** the clean aggregate text names no tool; the positive finding detail names oxlint. This is a formatter/component reproduction with synthetic state, not evidence that oxlint ran or that this repository's lint passed. No test suite was run.

## Scope and open questions

**Read in source code:** `src/cli/lint-report.ts:formatLintDetails` counts failing entries and emits a generic aggregate heading. `src/core/lint/surface/format.ts:lintStatusLines` emits counts from `LintStatus`, whose aggregate shape has no active-provider field. `lintSubject` already prints oxlint for individual entries. A zero-finding CLI list can be empty, so provider scope cannot reliably be inferred from finding entries alone.

**Inferred:** a proposed implementation must carry provider evidence to these summaries, including the zero-findings case. Human choice: approve the same tool-name scope for CLI/status (with honest off, pending, unknown and multi-provider states), or leave the present wording. Running the repository's own arbitrary lint command is a separate capability and is not implied by this proposal.

Sources: 017 `spec.md` D8/D11; 017 `status.md` entries for 2026-11-19; the source paths and commands above; [throwaway component probe](probes/issue-312/README.md).
