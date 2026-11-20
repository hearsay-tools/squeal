# Issue 252: a test filename containing `setup`

Date: 2026-11-20. Source: [issue #252](https://github.com/hearsay-tools/squeal/issues/252).

**Verdict: not reproduced.** On Squeal **0.1.572**, the reported filename lists and passes both at startup and when added to a running daemon. Renaming it also passes. The inspected discovery path has no `setup` substring rule. Recommend a bounded investigation of the original project's resolved configuration and discovery state before approving a classification repair; do not treat the reporter's explanation as a proven mechanism.

## Questions and answers

| Question | Answer and evidence |
| --- | --- |
| Does `workflows/input-receipt-setup.test.ts` disappear solely because of its name? | **Verified by experiment, Squeal 0.1.572 / Vitest 5.0.3:** no in the minimal fixture. Cold wait: exit 0, one current file after 1.8 s. Warm addition: exit 0, one selected current file after 1.3 s. |
| Does the rename change discovery? | **Verified by experiment, same versions:** the renamed `input-receipt-process-record.test.ts` also passes after 1.3 s. Both names work without an exclusion. |
| What selects test and setup files? | **Read in source code, Squeal 0.1.572 / Vitest 5.0.3:** Vitest discovers test specifications using configured includes and excludes. Squeal removes the TypeScript pool and paths matching `vitest.exclude`. Setup inputs come from resolved `setupFiles` and `globalSetup`, not a filename substring. |
| Can an explicit exclusion produce the missing-file symptom? | **Verified by experiment, same versions:** adding `vitest.exclude: ["**/*setup*"]` makes the previously passing file unlisted. Named status exits 3 with “Squeal does not run … which is not a test file any runner here lists.” This is a synthetic control, not evidence that the reporter had this setting. |
| Is the original incident's cause known? | **Inferred, bounded by the negative probe:** no. The destroyed worker tree's resolved Vitest configuration, Squeal policy, file contents and exact status output are unavailable. Rename success alone does not distinguish exclusions from discovery state or another project-specific cause. |

## Experiment and commands

Checkout: `35f89082c592cb8200d841baeb50160400204d60`; its committed CLI bundle reports `0.1.572`, matching the issue. Installed local Vitest is `5.0.3`. The unrelated default Codex runtime pointer was `0.1.565`; it was not used for this reproduction.

Commands from the repository root:

```sh
git rev-parse HEAD
node --disable-warning=ExperimentalWarning plugins/claude-code/dist/cli/squeal.mjs --version
node -p "require('vitest/package.json').version"
cat /proc/loadavg
getconf _NPROCESSORS_ONLN
python3 docs/specifications/011-core/research/probes/issue-252/probe.py
```

Initial load read: `17.67 24.42 26.61`, 24 online CPUs. Immediately before preparation: `16.08 23.03 26.02`. The first cold/rename probe ran at one-minute load 16.87–17.68. The retained expanded run ran at **20.52–20.80 / 24 CPUs**. The probe reads `/proc/loadavg` and `getconf _NPROCESSORS_ONLN` before each CLI call and aborts new work above the CPU count, except cleanup. No lab fallback, full suite, benchmark or build ran.

The throwaway nested Git fixture uses a node_modules symlink to this checkout, default Vitest discovery, `maxWorkers: 1`, Squeal's lookup-only baseline, and one trivial passing test. From that fixture, `squeal` below means `node --disable-warning=ExperimentalWarning "$CHECKOUT/plugins/claude-code/dist/cli/squeal.mjs"`:

```sh
squeal --version
squeal checks
squeal start
squeal retry workflows/input-receipt-setup.test.ts
squeal status --wait 60000 workflows/input-receipt-setup.test.ts
# Rename that file to input-receipt-process-record.test.ts.
squeal status --wait 60000 workflows/input-receipt-process-record.test.ts
# Add input-receipt-setup.test.ts again, with a distinct test name.
squeal status --wait 60000 workflows/input-receipt-setup.test.ts
# Add vitest.exclude: ["**/*setup*"] to squeal.config.json.
squeal status --wait 60000 workflows/input-receipt-setup.test.ts
squeal stop --until-start
```

The early `retry` exits 3 while discovery is starting and explicitly says “Not listed yet”; the following wait finishes discovery and requests its one run. That transient response is not a missing-test reproduction. The three success cases run through the actual daemon and CLI. The exclusion control gives:

```text
Revision: 3
No verdict: Squeal does not run workflows/input-receipt-setup.test.ts, which is not a test file any runner here lists. Worktree: known failures 0; all 1 test file current
```

Thus this diagnostic names nonparticipation but does not identify the matching exclusion rule. It does not claim setup classification. Both probe daemons stopped successfully. Exact commands, exit codes, load reads and output for the expanded run are preserved in [probes/issue-252/output.json](probes/issue-252/output.json); checkout paths are replaced with `<checkout>`.

## Source mechanism and affected contracts

**Read in source code, checkout above:**

- `src/runners/vitest/adapter.ts:583`: `testFiles()` calls `globTestSpecifications()`, applies `supported()` and `#covered()`. At lines 897 and 926 those filters remove matching configured exclusions and the `typescript` pool, respectively. `enumerate()` at line 573 delegates to `parseSpecifications()`.
- `src/runners/vitest/project.ts:50`: project setup closures start from `project.config.setupFiles` and `globalSetupFiles(project)`. `isProjectInput()` checks membership in those closures. It broadens affected selection; it is not a basename classifier.
- Vitest 5.0.3, `node_modules/vitest/dist/chunks/index.DpLw24bj.js:12202`: `globTestFiles()` reads the resolved `include`, `exclude`, `includeSource` and typecheck settings. `globAllTestFiles()` caches the resulting list. No filename-contains-setup condition appears in this path.
- `src/core/state/check-name.ts:40` recognizes the printed suffix `(global setup)` when parsing a check display name. It does not match `-setup.test.ts` and is not the discovery filter.

Relevant spec sections, with no edits proposed as settled design: **011 C6/C15** for named status and reasons a file is unlisted; **011 C4/C14** for discovery and the runner contract; **013 V2/V3/V9** for add/remove invalidation, enumeration, and configured exclusions. **013 V6** documents setup inputs already sourced from configuration.

## Recommendation and limits

Keep the triage framed as missing-file discovery or exclusion diagnostics, with the filename hypothesis unproven. If approved, capture the original project's resolved include/exclude/setup paths, Squeal exclusions, runner version, named JSON status and daemon discovery state before any rename, then compare the rename under unchanged content. A regression test should first reproduce a concrete omission rather than encode a setup-substring mechanism absent from the inspected code.

The original Vitest version and configuration are not recorded. The minimal fixture does not exercise its multi-project configuration, ignored files, custom plugins, or split test contents. The direct CLI probe does not recreate the Claude Code/Squawk worker harness. These limits prevent declaring the reported incident disproved or fixed.

## Intake fit and duplicates

**Inferred from the vision and issue:** this passes the decision filter because omitted tests weaken trustworthy pull state and cost agent time. Owner: 011; related Vitest contracts: 013, as listed above. The `friction` label means an agent reported the incident.

**Read in origin/main and GitHub, 2026-11-20:** board searches for `#252`, `input-receipt`, setup classification and related setup/test wording found no existing row for this symptom. `gh issue list --repo hearsay-tools/squeal --state open --limit 200 --json number,title,labels` and searches for setup and triaged discovery issues found no exact open duplicate. #142 concerns pending discovery, #161 a committed new file remaining unlisted, and #229 files added by rebase. Their reports do not establish setup-name classification. Existing holds stand.
