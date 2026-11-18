# Issue 242: the selected-status JSON contract

Recommendation: make the existing selection contract discoverable from `status --help`, including incomplete results and command failures that supply no selection.

Documentation-only triage of [issue 242](https://github.com/hearsay-tools/squeal/issues/242), 2026-11-18. Installed CLI: **0.1.560**. Source probe: **0.1.562**, commit `17e004533a3fefde369bf28aca0688c7a2a8485f`. The relevant decision, sync, printer and skill-reference files have no diff from release tag `squeal--v0.1.560` (`6a541a636167db654d55d5b1deebb600eb74d600`). This supports the source comparison; the synthetic probe did not execute the installed bundle's decision function.

| Question | Answer and evidence |
| --- | --- |
| Does installed help explain the named JSON fields? | No. It names `selection.testFiles` and `selection.focused`, but omits `selection.result`, `selection.reason` and `selection.verdict.unlisted`. **verified by experiment**, installed 0.1.560. |
| Can every selected file be current while the selection has no verdict? | Yes at the decision boundary: two current files, no failures, and `unlisted: true` give `none`, `unlisted`, code 3. Pending sync gives `none`, `unsynced`, code 3. **verified by experiment**, source 0.1.562, relevant files unchanged from 0.1.560. |
| Is the contract absent everywhere? | No. C15 and the shipped skill's `references/commands.md` already name result words, all eleven reason strings and the instruction to gate on `selection.code` or `selection.result`. The reference does not define `selection.verdict.unlisted` or explain each reason separately. **read in official docs**, source 0.1.562; skill reference unchanged from 0.1.560. |
| Does a killed command prove no daemon exists? | Not determined for the reported incident: no original killed output or process evidence was supplied. The named-result source selects `no-daemon` from a recorded wait outcome, not from absent or invalid JSON. **read in source code**, same source versions; treating a parse failure as no-daemon is unsupported by that contract (**inferred**). |

## Bounded reproduction

The preflight one-minute load was **10.83 on 24 CPUs**. Immediately before the synthetic probe, at `2026-11-18T15:02:34Z`, it was **7.67 on 24 CPUs**. Both were below the skip threshold. This was one bounded reproduction comprising help inspection and one source-function probe, completed within 20 minutes. No daemon was started, stopped or changed; no store was opened and no test suite ran.

Commands from the repository root follow. `~` substitutes the home directory in the installed launcher path; outputs committed here contain no absolute home paths.

```sh
cat /proc/loadavg
nproc
git rev-parse HEAD
node -p 'require("./package.json").version'
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --help
git rev-parse squeal--v0.1.560
git diff --exit-code squeal--v0.1.560 HEAD -- src/cli/verdict.ts src/cli/status-wait-paths.ts src/cli/wait/synced.ts src/cli/named-print.ts plugins/claude-code/skills/squeal/references/commands.md
date -u +%FT%TZ
cat /proc/loadavg
nproc
pnpm exec tsx docs/specifications/011-core/research/probes/issue-242/probe.ts > docs/specifications/011-core/research/probes/issue-242/output.txt
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --help > docs/specifications/011-core/research/probes/issue-242/help.txt
```

The version commands returned the versions and commits above. Help exited 0. The source comparison exited 0 with no output. The probe exited 0 and printed `PASS: 7 synthetic decision cases; no daemon, runner or store used.` Its complete inputs and outputs are in [output.txt](probes/issue-242/output.txt); installed help is in [help.txt](probes/issue-242/help.txt).

**verified by experiment, source 0.1.562:** all seven cases use two `current` file classes. The synced control gives `pass`/0; a failure gives `fail`/1; unlisted gives `none:unlisted`/3; pending sync gives `none:unsynced`/3; both gates together give `none:unsynced`/3; a no-daemon outcome gives `none:no-daemon`/3; a focused outcome without failure gives `none:focused`/3. The script does not generate a CLI snapshot or prove how a real runner enters those states.

## What the existing contract says

**read in source code, 0.1.562, unchanged from 0.1.560:** `src/cli/verdict.ts` owns `selectionResult`, `resultCode`, the result and reason types, and `FileVerdict`. `src/cli/named-print.ts` uses that result for the process return code and the JSON payload in both named status forms. The meaning is `pass` = 0, `fail` = 1, `none` = 3. A `reason` is present only with `none`. Focused failures can produce `fail`; a focused pass does not certify the whole file.

The closed reason set is:

| Reason | Meaning from the source |
| --- | --- |
| `no-daemon` | No daemon validates the worktree. |
| `lapsed` | Liveness has lapsed or a handoff is underway, without the accepted stored-sync coverage exception. |
| `on-hold` | Selected queued work is held. |
| `paused` | Selected slow work waits for a pause or explicit slow run. |
| `focused` | Focused checks did not fail, but they supply no whole-file verdict. |
| `unsynced` | The pass over edits before the read has not reached the results' revision. |
| `unlisted` | The revision's test-file listing is not ready. |
| `pending` | Selected work, including a focused run, remains pending. |
| `not-current` | A selected file is stale or unknown. |
| `not-run` | A named path is a test file Squeal does not run. |
| `unmatched` | A named path selects no test file. |

**read in source code, same versions:** `verdict.unlisted` is calculated from `runnerPartPending || awaitingInstall`. It is independent of the count of current cached files. `selectionReady` requires the sync pass to reach the read and, for a synced daemon, the listing to be ready. Unsynced takes precedence over unlisted in the probed timeout case. A false `unlisted` value alone therefore does not establish completion.

**read in source code, same versions:** an unavailable store prints a JSON status result and returns 3 without constructing a `selection` payload. Thus even parseable JSON plus exit 3 does not universally carry `selection.reason`. Usage and command execution failures must also be distinguished from a valid selected-status response. The original timeout kill remains unverified; no process was killed for this research.

## Recommendation and limits

**inferred from the experiments and cited contract:** this is a discoverability and explanation gap, not evidence that the decision function falsely passes incomplete work. A help pointer to one published contract can reuse the existing result/reason definitions and explain `verdict.unlisted`, examples with current files but `none`, and the distinction between a valid incomplete response, unavailable status and missing/invalid command output. The human must choose help expansion versus a linked reference/schema; this report changes no contract or product files.

The reporter's unlisted JSON was not retained. This probe cannot establish its revision, cause, timing or the downstream consumer's three review rounds. Existing tests in `test/cli/selection-result.test.ts` cover current passing files with an unstored sync returning exit 3 and JSON `none/unsynced`; they were read, not rerun. No full-suite or live-daemon verdict is claimed.

Related explanation research: [issue 132](issue-132.md) and [issue 232](issue-232.md). Their timing/sync reports overlap the concepts; issue 242 specifically requests a discoverable machine-consumer contract.

## Sources

- [Issue 242](https://github.com/hearsay-tools/squeal/issues/242), fetched with `gh issue view 242 --repo hearsay-tools/squeal --json title,body,url`.
- [Installed help](probes/issue-242/help.txt), [probe source](probes/issue-242/probe.ts), [recorded output](probes/issue-242/output.txt).
- [011 C6 and C15](../spec.md), [amendment log](../status.md), especially 011-206 and 011-286.
- `src/cli/verdict.ts`, `src/cli/wait/synced.ts`, `src/cli/status-wait-paths.ts`, `src/cli/named-print.ts`, at the examined commit.
- `plugins/claude-code/skills/squeal/references/commands.md`, named status and named wait paragraphs; `test/cli/selection-result.test.ts`, existing contract cases.
