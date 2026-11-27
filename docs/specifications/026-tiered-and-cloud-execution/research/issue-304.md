# Issue #304: remote-only observed files survive proof retry

Recommend a proposed follow-up to 026-24 that reconciles remote proof with effective per-reader inputs and diagnoses remote-only unsyncable files; preserve proof for real inputs and explicit `whenLost: "not-run"`.

Source: [#304](https://github.com/hearsay-tools/squeal/issues/304), fetched 2026-11-27
with `gh issue view 304 --repo hearsay-tools/squeal --json title,body,comments`.
Reported version: 0.1.657. Examined source: package 0.1.659 at
`7ac351b33440b7bcdb16643993c65cec6e2b77bb`; session launcher: 0.1.657.
`squeal--v0.1.657` resolves to `d129f7dee3ff6763e0142c17cde64b262be2af1a`.

| Question | Answer and evidence |
| --- | --- |
| Does a remote-only ignored observed path cause retry then refusal? | **verified by experiment, 0.1.659:** yes, with synthetic descriptor, screenshot and build-output paths; two remote runs, zero completed files retained, zero local runs under `not-run`. |
| Does the retry repair absence locally? | **verified by experiment, 0.1.659:** only the previously synced deletion control repairs. A file created only on the remote remains there even when created only once. |
| Does `runtimeFiles` already exclude the relevant data? | **verified by experiment, 0.1.659:** an unprotected exact rule produces `effectiveObserved: []`, but the real lane rejects the synthetic raw observation. **read in source code:** the host/lane proof does not apply that effective-input policy. This is not a full scheduler/config reproduction. |
| Is every ignored path safe to omit? | **read in source code, 0.1.659 and 011 C4/D4:** no. Kept ignored observations enter keys unless the written-directory bound applies. Runtime exclusions are explicit and protect test/config/import/declared inputs. |
| Is this a duplicate or regression of #280? | **inferred:** a residual case in the same mechanism, not evidence of a post-0.1.634 regression or an already resolved duplicate. #280 repaired locally present ignored inputs; its classifier already treated local `null` as syncable. |

## Findings

1. **verified by experiment, 0.1.659:** all remote-only ignored cases have
   `localBlob: null`, `inTree: false`, and `classified.syncable: [path]`. The
   report ends `crashed` with `its tree stayed different at <path>; not run here
   (whenLost "not-run")`. The log emits `sending again` twice; there are two
   attempts, not two completed retries. The locally present ignored control has
   one remote run, no retry, and the specific `git-ignored input ... exists
   locally and is not synced to remote` refusal. This confirms #280's shipped
   guard still works for its intended case.

2. **read in source code, 0.1.659:** `host.ts:298–304` proves the union of expected
   paths and raw `report.observed[].paths`. `lane.ts:differing` compares those
   blobs with the local worktree; `splitBy` passes local blobs and Git membership
   to `lane-proof.ts:classify`. Its `here !== null && here !== undefined` guard
   sends absent local files down the syncable path. `writesFor` emits a removal,
   but `tree-host.ts:remove` returns immediately for a path absent from its
   `files` ledger. A remote-generated artifact was never synced into that ledger.
   **verified by experiment:** its existence at successive run starts is
   `[false,true]`, even when the runner writes it only on the first attempt.
   A tracked file synced first and then deleted locally gives `[true,false]` and
   completes on retry. Treating every `null` as unrepairable would break that
   legitimate deletion control.

3. **read in source code, 0.1.659:** `RuntimeFiles.effective` removes only accepted
   exact per-reader exclusions; `WorktreeKeys.effectiveObserved` applies it in
   daemon keying. `host.ts` instead proves raw observations before that filtering.
   Its `HostPolicy` does not carry `runtimeFiles`. The probe verifies the helper
   excludes `.ai/qa/test-env.json` without a protection conflict, while the lane
   still refuses that raw observation. A report carrying a written ancestor
   directory also refuses, since the host ignores `observed.written` during
   proof; `scheduler/observed.ts` applies that bound later. These are distinct
   semantic cases from a genuine generated build input with no exclusion.

4. **read in source code, 0.1.659 and current 011 C4/D4:** the issue's statement
   that ignored observations never enter keys cites superseded behavior. The
   2026-10-25 amendment explicitly keeps them unless the same test wrote, created
   or removed an ancestor directory. `runners/observe/inputs.ts` also removes
   paths the recorder attributes as written by that test. **inferred:** a
   screenshot that still arrives as a raw observation needs attribution evidence
   (for example a browser writing outside the Node recorder); its filename alone
   cannot establish safe exclusion. A remote build output that the test reads or
   executes can be a real input. Blanket ignored-path exclusion could accept a
   result for bytes absent from the local key.

5. **read in source code/history, 0.1.634–0.1.659:** closed [#280](https://github.com/hearsay-tools/squeal/issues/280),
   its [research](issue-280.md), row 026-24 and the 0.1.634 release comments cover
   per-file isolation and immediate refusal of locally present ignored inputs.
   `lane-proof.ts` last changed at `40675875c` (026-24); the 0.1.634 tag has the
   same `null` classification. The examined proof, sync, runtime-exclusion and
   keying files have no diff from reported 0.1.657 (command below). **inferred:**
   #304 supplies a distinct uncovered branch and an effective-input-policy seam,
   so a follow-up should retain its evidence rather than close it as fixed by
   #280. No pre-0.1.634 live run was performed.

## Reproduction and limits

The [probe and instructions](probes/issue-304/README.md) and
[raw output](probes/issue-304/results.jsonl) preserve eight scenarios. Exact run:

```sh
env -u NODE_OPTIONS pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-304/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-304/results.jsonl
git diff --name-only squeal--v0.1.657 HEAD -- src/core/runner-host/remote/lane.ts src/core/runner-host/remote/lane-proof.ts src/core/runner-host/remote/tree.ts src/core/runner-host/remote/tree-host.ts src/core/runner-host/host.ts src/core/keys/runtime-files.ts src/core/scheduler/keying.ts
```

Outputs: probe exit 0, eight asserted cases; diff exit 0 with no paths. Node
v26.13.0, 16 CPUs (`getconf _NPROCESSORS_ONLN`); initial load 0.58/0.98/1.93,
final probe one-minute load 0.35; end `cat /proc/loadavg` output:
`0.22 0.64 1.59 1/905 304291`. The run took 0.635 s reported tool wall time.
An initial development assertion failed because it expected retry to remove a
never-synced file; the ledger finding above explains it, and the final probe
asserts the observed behavior.

This uses real Git eligibility, tree sync, protocol and lane proof with a
synthetic runner over in-process streams. No browser, VM, SSH, dependency install,
full suite or product edit. The reported project config, recorder attribution,
remote template, actual artifacts and scheduler/store UNKNOWN transition were
not reproduced. A synthetic completed report carries no real test assertions;
the result proves rejection behavior, not that the reporter's tests pass.

Read the session-pinned Squeal skill before running the probe. `squeal checks`
through the session launcher reported 2,340 default edit test files, 2,175 pass
and 165 not current at that moment. These are background context, not probe
validation. Squeal subsequently said no test reads this throwaway probe. No
product suite was manually rerun or claimed passing.
Final launcher command `squeal status --wait 60000
docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-304/probe.ts`
exited 3: `No verdict: no test file's closure holds` the probe; `known failures
0; not current: 65 of 2340 test files (65 unknown)` at revision 8.

## Recommendation and open questions

**inferred:** owner 026 D8/D10/D12, original sync/proof contract 021 D10/D11,
and 011 effective runtime-input semantics should decide this together. Align
proof with accepted effective per-reader exclusions while preserving genuine
input proof, sync's ignored-file boundary, per-file isolation and configured
fallback. Diagnose remote-only unsyncable inputs without futile retries; do not
broaden deletion to all remote-generated files or treat `remote-key` as proof of
equal input bytes. A provenance policy for required remote-generated inputs
needs an explicit decision, not a blanket exemption.

Still needed: the actual accepted `runtimeFiles` application and conflicts for
the reported reader; its raw observed paths, writes and written directories;
local/remote blobs and sync-ledger membership; which generated build inputs have
tracked source/build provenance. Existing holds stand; no implementation is
authorized by this research.

Normative sources: [026 D8/D10/D12](../spec.md), [026 amendments](../status.md),
[021 D10/D11](../../021-remote-store-and-execution/spec.md),
[011 C4/D4](../../011-core/spec.md). Shipped runtime contract:
`src/core/types/policy.ts:RuntimeFileRule`, `src/core/keys/runtime-files.ts`,
`src/core/scheduler/keying.ts:effectiveObserved`,
`src/core/scheduler/observed.ts:scratchOf`, and
`src/runners/observe/inputs.ts:observedInputs`, all at the examined commit.
