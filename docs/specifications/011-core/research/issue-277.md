# Issue 277: late heartbeat in snapshot JSON

Bring #277 to the human as a classification and compatibility decision. The reported `down` / `no-daemon` combination is reproducible through the current production decision functions. It follows an existing distinction between snapshots and waits. A public `daemon.state: "lapsed"` is a requested new state, not an existing schema value that stopped working.

Examined 2026-11-24: source `ad0de28f67a9eb9f7a4f21f77ffcec3edee8324c`, package and installed CLI 0.1.627. The issue reports 0.1.623 and 0.1.624. Their release commits are `4e74a38823a9ef83caf1620e9b6e131e1725c7a0` and `377d4ae1308ef6e5b4f06a443316929e210a23a0`; 0.1.627 is `3c6bd44aac143c9b84dfd29263de3bbea164e946`. No old runtime was executed.

## Questions and answers

| Question | Finding and evidence |
| --- | --- |
| Does the mechanism still produce the reported result? | Yes: synthetic heartbeat ages 10,001, 23,679 and 32,796 ms give `daemon.state: down`, `heartbeatLate.ageMs`, and snapshot `none/no-daemon`. **verified by experiment, 0.1.627**. |
| Why does `lapsed` not win? | Snapshot status uses raw heartbeat liveness. Its decision table ends with `no-daemon` when that is down; `selectionResult` gives that outcome priority. It does not pass a wait's `lapsed` flag. **read in source code, 0.1.623–0.1.627**. |
| Is `daemon.state: lapsed` already public? | No. Public `DaemonLiveness` has `alive` and `down`. `heartbeatLate` is an optional field on `down`. Internal `WaitLiveness` has `lapsed`; `selection.reason` also permits it. These are different fields and contracts. **read in source code, 0.1.623–0.1.627**. |
| Does the issue show a regression from #109 or #130? | No regression established. #109's approved repair preserved classification; #130 changed named waits after their own sync, not snapshot classification. **read in source code and recorded decisions, current 0.1.627**. |
| Was the original loaded-host incident reproduced? | No. The mechanism was isolated without load or a daemon. CPU scheduling, store contention, process identity and socket responsiveness during the original incident are **not determined**, because its logs and runtime observations were not supplied. |

## Mechanism and contract

**read in source code, 0.1.623–0.1.627.** `src/core/presence/heartbeat.ts` grants two heartbeat intervals: with the usual 5 s interval, exactly 10,000 ms is still alive, and 10,001 ms is down. `decide.ts` and `views.ts` attach `heartbeatLate` when the recorded daemon is down and the available facts do not classify it as stopped, starting, shutting down or dead. The field conveys uncertainty; it does not prove that validation progresses.

`src/cli/wait/snapshot.ts:readOnce` takes raw `daemonLiveness`, requires `alive` for readiness, and passes `alive` or `down` to `STATUS_WAITS.snapshot`. That row in `status-table.ts` returns `no-daemon` before any file verdict. `src/cli/verdict.ts:selectionResult` maps the outcome to the same reason before considering `lapsed`. This directly explains a late snapshot beside current files, and does not depend on AGENTS.md selecting a particular test.

Waits use another view. `src/core/presence/wait.ts` keeps a stale registered daemon `lapsed` while the socket is listening, while the socket check is pending, or during certain handoffs and starts. `src/cli/wait-liveness.ts` collects that socket evidence. Socket acceptance alone is weaker than a response or completed sync; a missing socket alone is not an immediate general proof that a process is gone. The wait has its own absence timing, record and handoff rules.

**read in source code and recorded decisions, 0.1.627.** Spec 011 C6 separates status snapshots from waits; C9 governs lifecycle and the evidence used during starts, shutdown and handoff; C15 orders `no-daemon` before `lapsed`. Its 2026-10-31 amendment, row 011-286, lets a named wait accept current selected results after its own sync is stored, retaining `heartbeatLate` in the snapshot. That supersedes the pre-repair #130 research's finding that every lapse blocks a verdict. It does not add `daemon.state: lapsed` or alter the snapshot row.

Row 011-276's notes explicitly say: “The liveness decision (`daemonLiveness`, alive or down) is unchanged, so are the verdicts, exit codes, news rules and ensure.” Its JSON example is precisely `down` plus `heartbeatLate`. The earlier #109 findings proposed alternatives; the human selected wording only. Current `references/commands.md`, “Status JSON”, describes `lapsed` without spelling out the snapshot/wait distinction. **inferred, 0.1.627:** this makes the issue's expectation understandable, but the prose alone does not establish an implemented third daemon state.

## Bounded probe and version comparison

**verified by experiment, 0.1.627 source.** Initial `uptime; nproc` gave load **4.29 / 14.43 / 23.94**, **16 CPUs**. The probe's own guard measured **1.6 / 7.87 / 19.29**, **16 available CPUs**. No load was generated. Node v26.13.0; no boat sandbox was needed for this small in-process probe.

```sh
pnpm exec tsx docs/specifications/011-core/research/probes/issue-277/probe.mjs > docs/specifications/011-core/research/probes/issue-277/output.txt
```

Exit 0. Six readings call production presence, snapshot-decision and verdict functions, with synthetic facts. At 9,999 / 10,000 / 0 ms heartbeat age, public state is `alive` and the deliberately pending sync gives `unsynced`. At 10,001 / 23,679 / 32,796 ms, public state is `down` with the exact age and the snapshot gives `no-daemon`. Supplying `listening` to the real wait view gives internal state and selection reason `lapsed` for those same three late ages. The first invocation exposed a probe expectation error for an unsupported-sync fallback; correcting the fixture to a pending sync passed. Repeating after placing the probe under the owning spec produced the saved pass, as recorded in the probe README.

This composes real decision functions with controlled inputs. It does not run the CLI end to end, query an actual socket, write a store, suspend a process or reproduce the issue's load of 20–30 on 16 CPUs. It does not verify the client's reported heavy fallback or its cost.

**read in source code, 0.1.623–0.1.627.** Version comparison:

```sh
git diff squeal--v0.1.623 squeal--v0.1.627 -- src/core/presence src/cli/wait src/cli/verdict.ts src/core/types/status.ts src/cli/wait-liveness.ts
git diff squeal--v0.1.623 squeal--v0.1.627 -- plugins/claude-code/skills/squeal/references/commands.md
```

The first diff changes only unrelated slow-tier slot types in `status.ts`; the liveness union and listed decision modules are unchanged. The second diff is empty. Thus the traced mechanism is also present at the reported versions; this is source evidence, not execution of those releases.

## Recommendation and limits

**inferred from the probe and source, 0.1.627.** Approve a follow-up decision on whether clients should receive a distinct uncertain-presence classification for snapshots and how it fits the public schema, or whether to preserve the current fields and document their combination explicitly. The tradeoff is clearer machine decisions against compatibility with consumers that expect two daemon states. Do not silently equate “heartbeat late” with “busy and progressing”, or use a socket's absence alone as proof of process death. Preserve the sync gate that protects results from unobserved edits.

The mechanism is related to closed #109 and #130; their narrower completed repairs do not fulfill #277's requested classification. Remaining incident questions: which daemon incarnation was registered across the transitions, whether ping replied or merely connected, whether sync completed, and whether a busy store or delayed event loop caused the missed heartbeat. The issue's five snapshots alone do not decide those.

Verification: `git diff --check` passed. `~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/issue-277.md docs/specifications/011-core/research/probes/issue-277/probe.mjs` returned exit 3: no test file's closure holds either path. Revision 12 reported known failures 0 and 330 of 2,251 test files not current (unknown). This is no test verdict for the research artifacts, not a suite pass.

## Sources and artifacts

- [Issue #277](https://github.com/hearsay-tools/squeal/issues/277), fetched with `gh issue view 277 --json number,title,body,comments,url`.
- [Source at examined commit](https://github.com/hearsay-tools/squeal/tree/ad0de28f67a9eb9f7a4f21f77ffcec3edee8324c), paths cited above; `src/core/types/status.ts:DaemonLiveness`; `src/cli/status-wait-paths.ts:namedResult`.
- [Spec C6/C9/C15](../spec.md), [amendment log](../status.md), [011-276 notes](../tasks/011-276/notes.md), [#109 findings](issue-109.md), [#130 findings](issue-130.md). Historical probe results are background, not re-run here.
- [Probe and commands](probes/issue-277/README.md), [saved output](probes/issue-277/output.txt). Product tests and full suite were not run manually.
