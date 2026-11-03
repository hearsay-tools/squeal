# Issue 142: a new file has no closure while discovery is pending

Recommend distinguishing pending discovery from a proven unmatched path while
keeping the no-verdict gate; a new early-stall rule needs a separate decision.

**Verdict:** the reported CLI wording and deadline behavior are reproduced on
installed **0.1.390** with a synthetic store and an answering socket. The original
Cezarion discovery stall, its cause, and its later recovery are **not reproduced**.
No product, spec, board, skill, existing hold or live daemon was changed.

## Questions and answers

| Question | Answer and evidence tag |
| --- | --- |
| 1. Can a newly added test file read as having no closure during discovery? | Yes. With revision 2 and refined revision 1, the installed CLI prints both `no test file's closure holds scripts/test-package.test.mjs` and `revision 2 is not listed yet`. **verified by experiment; 0.1.390**, cases 1, 2 and 4. |
| 2. Does a stale heartbeat with an alive socket end the wait early? | No in this controlled state. A heartbeat seeded 64 seconds old and a socket answering ping used the full 1,500 ms wait budget. Exit `3`, result `none`, reason `lapsed`. **verified by experiment; 0.1.390**, case 2. |
| 3. Does the ambiguity create a false pass? | No in these cases. Pending discovery always kept exit `3`. Only an injected current pass, completed listing and answered sync produced exit `0`, despite the stale heartbeat. **verified by experiment; 0.1.390**, cases 1–6. |
| 4. What caused the three original stalls and recovery by revision 6? | **Not determined, because** the issue provides a summary but no incident store, daemon trace or timing capture. Load around 25 on 24 CPUs is reported, not measured here. A busy store, runner delay and event-loop stall are not distinguished by this probe. |

## Experiment

**verified by experiment; 0.1.390 / Node v24.22.1.** Initial preflight
`cat /proc/loadavg; getconf _NPROCESSORS_ONLN` returned
`5.10 5.77 6.97 4/2460 3540804` and `24`. The final six-case run checked load
again before every CLI invocation: 4.79–5.12 on 24 CPUs, so none was skipped.

The runtime directory was
`/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.390`.
Its `runtime.json` says `version: 0.1.390`. The probe checked the actual CLI hash
against that manifest:
`8e1c6279d2ddcc7ace5257d55690a332373a48dbe7e80c58ae53e1be1cc867fc`.
The local release tag resolves to `ee3531548ed52c4ba692b48b0ae430d9c4965e48`.
The fixture's store and identity helpers come from checkout
`8ce4f23fc18c67cb1259b894fed74f395c0c02b5` (0.1.393); those sources and the
status sources cited below have no diff against the release. No bundle was built.

Exact outer command:

```sh
pnpm exec tsx research/probes/issue-142/probe.mts > research/probes/issue-142/output.txt 2>&1
```

Each child runs this command in its private temporary repository, substituting
the path in the table:

```sh
/home/agent/.nvm/versions/node/v24.22.1/bin/node /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.390/dist/cli/squeal.mjs status --json --wait 1500 scripts/test-package.test.mjs
```

The fixture creates the new file on disk after revision 1's timestamp, gives one
older test a queued key, and leaves the new file without a key or closure. Sync
is initially pending. A stand-in socket answers ping and sync requests. This
isolates CLI interpretation from runner discovery and host contention.

| Case | Path / controlled state | Exit / reason | CLI waited / child wall time |
| --- | --- | --- | --- |
| 1 | New file; fresh heartbeat; discovery and sync pending | `3 / unsynced` | 1,508 / 1,674 ms |
| 2 | New file; stale heartbeat; answering socket; discovery and sync pending | `3 / lapsed` | 1,508 / 1,631 ms |
| 3 | `scripts/old.test.mjs`; already listed; discovery and sync pending | `3 / unsynced` | 1,510 / 1,659 ms |
| 4 | New file; fresh heartbeat; sync answered at 2; discovery still at 1 | `3 / unlisted` | 1,508 / 1,631 ms |
| 5 | `scripts/absent.mjs`; completed listing and sync; no match | `3 / unmatched` | 19 / 144 ms |
| 6 | New file; injected current pass and listing at 2; answered sync; stale heartbeat | `0 / pass` | 18 / 147 ms |

Case 2's exact verdict prefix and liveness clause:

> Named test files have no verdict: the deadline passed after 1.5 s: the daemon's heartbeat had lapsed at the last read; results are as of revision 2; no test file's closure holds scripts/test-package.test.mjs; the daemon's heartbeat went 66 s stale while its socket showed it alive (a busy store or a stalled daemon), so the wait went on.

The same line later says `revision 2 is not listed yet, so test files it adds are
not counted`. Case 4 begins `revision 2 is not listed yet (1 test file queued)`
and still appends the no-closure clause. Case 3 instead gives its listed file a
pending reason naming revision 2's unfinished listing.

The machine fields preserve the distinction: in cases 1–4,
`testFilesListed=true`, `refinedRevision=1`, `runnerPartPending=true`, and
`selection.verdict.unlisted=true`. In case 2 the snapshot's `daemon.state=down`
is its heartbeat reading; the wait's socket reading still produces `lapsed`.
Neither that snapshot field alone nor a live socket proves discovery completed.

All six probe assertions passed. Full command arguments, output text, selected
JSON fields and loads are in [output.txt](../../../../research/probes/issue-142/output.txt).
No real daemon, Vitest suite, full-suite checkpoint or build ran for this probe.
The 60-second incident duration and 1,185/1,215 queued count were not recreated.

Repository verification:
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 research/probes/issue-142/probe.mts docs/specifications/011-core/research/issue-142.md`
returned exit `3` at revision 26: neither path has a test-file closure;
`Worktree: known failures 0; all 1385 test files current`. Those are stored
results, not a suite run by this task. The standalone probe supplies its own
assertions; Squeal's untested-code notices for it are expected. `git diff --check`
passed and all local links in this report resolved.

## Source explanation and recommendation

**read in source code; 0.1.390, `ee3531548`.** `selectNamedFiles` reads the
existing key rows. A path absent from them and without stored readers becomes
`unmatched`. `notRunTestFile` already avoids labelling a new, undiscovered file
as excluded, but the path still falls through to `unmatched`. `namedLine` appends
`pathsText(selection)` to the timeout reason without qualifying it by discovery
state. That supplies the no-closure clause even when `verdict.unlisted` is true.

**read in source code; 0.1.390, `ee3531548`.** `readiness` prevents settlement
while the revision is unlisted. `watchDaemon` treats a stale heartbeat plus an
answering or accepting socket as `lapsed`, not proof of death. `selectionResult`
puts an uncovered lapse before unsynced and unlisted reasons. Thus the existing
logic waits for possible recovery and retains no verdict; it has no distinct
`discovery-stalled` outcome. Queued test-file counts are not a measured count of
files remaining to discover.

**read in official docs; spec checkout `8ce4f23f`.** C6 requires honest incomplete
counts. C9 preserves liveness uncertainty and existing lifecycle/hold rules.
C15 explicitly distinguishes unlisted revisions from idle work. Its 2026-10-31
011-286 amendment permits a verdict through a lapse only after the wait's sync,
the completed listing and current selected results; an empty selection still
keeps `lapsed`. The control in case 6 checks this accepted rule, with synthetic
evidence only.

**inferred; from the 0.1.390 probe and sources.** A bounded clarification of the
named path's pending discovery is supported. Keep exit `3 / none` until the
existing evidence permits a verdict. Do not equate a late heartbeat with stalled
discovery, daemon death, or permission for a competing test run. An early return
could save wait time, but it trades away recovery within the requested deadline
unless a separate progress/stall rule justifies it. This report defines no such
rule and authorizes no repair. Lookup-only, command/merge holds, slow-tier policy,
and the held retry/slow-priority choices remain unchanged.

Open questions: which operation delayed the original discovery; whether any
persisted progress fact can distinguish slow from stalled discovery; and what
early-return criterion the human would accept without weakening C15.

## Sources

- [Issue 142](https://github.com/hearsay-tools/squeal/issues/142), fetched with
  `gh issue view 142 --repo hearsay-tools/squeal --json number,title,body,comments,url,createdAt`.
  No comments were present. Its incident claims are reported evidence only.
- [Throwaway probe and method](../../../../research/probes/issue-142/README.md),
  [script](../../../../research/probes/issue-142/probe.mts), and output above.
- [C6, C9, C15](../spec.md), [amendment log](../status.md), read at `8ce4f23f`.
- Release source at [ee3531548](https://github.com/hearsay-tools/squeal/tree/ee3531548ed52c4ba692b48b0ae430d9c4965e48):
  `src/cli/named-selection.ts:90`, `retry-unlisted.ts:74`,
  `named-path-lines.ts:31`, `status-wait-lines.ts:220`,
  `status-wait-paths.ts:380`, `wait-liveness.ts:119`, `verdict.ts:203`,
  `no-verdict-lines.ts:28`, and `src/core/state/header.ts:92`.
  Checked with `git diff --quiet squeal--v0.1.390 HEAD --` followed by those
  paths and `src/core/store src/core/fs src/core/daemon/paths.ts`; exit `0`.
