# Issue 296: comparing stored check names

Recommend a proposed extension of 023 D1–D3 for comparing stored check names at exact keys; the missing CLI option is reproduced, but the original 45-file workflow was not rerun.

Date: 2026-11-27. Issue: [hearsay-tools/squeal#296](https://github.com/hearsay-tools/squeal/issues/296). Installed CLI examined: **0.1.647**. Source examined: **0.1.654**, commit `0ec68f527b7b281fb8f71362de47a7930524c462`. The source version is newer than the installed CLI. No tests, checkout creation, installs, or shared-store queries were run for this research.

| Question | Answer and evidence |
| --- | --- |
| Does the suggested command exist in the reported version? | **Verified by experiment, 0.1.647:** `status --at … --checks` exits 2 with an unknown-option error. |
| Does current source expose names through the existing comparison? | **Read in source code, 0.1.654:** the comparison preserves failed names, but a passing side has no name list; equal file verdicts become `unchanged`. |
| Are names represented in stored results? | **Read in source code, 0.1.654:** checks have project, test path, kind and full name; `checksForKey` reads those identities by joining results at a key. No live data completeness was measured. |
| Does this reproduce the reported refactor? | **Not determined:** the original 45-file registration move and private script were not supplied or rerun. The narrow reproduction establishes the missing CLI capability only. |

## Experiment

The host had 16 logical CPUs. Initial one-minute load was 2.82177734375. Immediately before the probe, this command printed:

```sh
python3 -c 'import os; print("CPU count:", os.cpu_count(), "; load:", os.getloadavg())'
```

```text
CPU count: 16 ; load: (2.982421875, 1.94091796875, 1.263671875)
```

The one-minute load was below the CPU count, so the parser-only live probe was allowed. Each CLI invocation was run through Python `subprocess.run` with `capture_output=True`, `text=True` and a 15-second timeout. The commands below are exact, with the home directory spelled `~` for repository publication. Error output from the status command is excerpted to its first three lines; the rest was ordinary CLI help.

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
```

```text
exit: 0
stdout: 0.1.647
stderr: squeal: this command runs squeal 0.1.647; plugins: Claude Code 0.1.647, Codex 0.1.647 and Antigravity 0.1.640. Run squeal update to bring the plugins to one version.
```

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --at HEAD~1 test/cli/status-at.test.ts --checks
```

```text
exit: 2
stdout: (empty)
stderr (first three lines):
squeal status: unknown option "--checks" with --at

squeal: continuous validation for coding agents. Push transitions, pull state.
```

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal checks --at HEAD~1
```

```text
exit: 2
stdout: (empty)
stderr:
squeal checks: unknown argument "--at"
Usage: squeal checks
```

**Verified by experiment, 0.1.647:** both forms reject the requested comparison at argument parsing. The test path is an argument only; no test result was requested or obtained. This is sufficient for the missing-option verdict and does not depend on a populated store or a 45-file fixture. No probe files are needed to repeat these commands.

## Source findings and scope

1. **Read in source code, 0.1.654:** [`src/cli/status-at.ts`](../../../../src/cli/status-at.ts), `parseAt`, rejects unrecognized `--` options and has no `--checks` handling. [`src/cli/main.ts`](../../../../src/cli/main.ts), `statusAt`, parses before calling `statusAtCommand`. The installed parser result is consistent with the newer source; the newer bundle was not executed.
2. **Read in source code, 0.1.654:** [`src/cli/status-at-report.ts`](../../../../src/cli/status-at-report.ts), `SideState`, `stateOf` and `change`, reduce records to file verdicts. `stateOf` retains only failing test names; a passing side contains its key and origin. `change` returns `unchanged` whenever both known sides have the same state. Consequently, two passing files with different check names are indistinguishable by this report's comparison. JSON uses the same side states. This is a source finding, not a live result comparison.
3. **Read in source code, 0.1.654:** [`src/core/store/schema.ts`](../../../../src/core/store/schema.ts) makes check identity unique by `(project, test_path, kind, full_name)`. [`src/core/store/repos/results.ts`](../../../../src/core/store/repos/results.ts), `checksForKey`, joins `results` with `checks` at the requested key. The stored representation can supply names without running tests. Whether every supported runner and imported result records the complete registered-name set is not established here.
4. **Read in source code, 0.1.654:** [`src/cli/checks.ts`](../../../../src/cli/checks.ts) describes configured check groups and current file counts; it rejects any arguments. It is not a historical registration-name comparison.

## Recommendation and limits

**Inferred from the experiment and source, 0.1.647/0.1.654:** treat this as a missing feature under 023 D1–D3, with 011 C6's read-only snapshot rule preserved. The current specification promises file verdict comparison and failed-test names, not comparison of every registered check name. A human-approved scope decision is needed before implementation.

The deciding tradeoff is exact provenance versus a convenient historical guess. 023 D2 requires computing the commit's actual key; the issue's workaround describes the newest earlier clean key, which does not itself prove that the results belong to the requested commit. Retain honest unknown states when an exact side has no usable result. Current lookup without `--run` may create a checkout to compute keys (023 D1–D2); running no tests does not imply that every comparison can avoid setup.

Unsettled: skipped or unrecorded registrations, duplicate full names, incomplete/file-error runs, imported CI result completeness, file/project moves, and whether the requested meaning is observed stored names or every registered name. Those are design questions, not reproduced defects. This probe neither measured the reported 15-minute workaround cost nor verified the private script or its five-session reuse.

Sources: issue body fetched with `gh issue view 296 --repo hearsay-tools/squeal --json number,title,body,url,createdAt`; the source paths above at `0ec68f527`; [023 D1–D3](../spec.md) and its [amendment log](../status.md); [011 C6](../../011-core/spec.md). The issue names #262 as related selection friction; this report does not establish duplicate status.
