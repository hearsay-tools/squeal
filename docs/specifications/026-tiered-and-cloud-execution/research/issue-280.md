# Issue #280: ignored remote inputs and setup mismatch

Recommend a proposed row to reconcile remote input proof with sync eligibility and make refusal recovery actionable, while preserving `whenLost: "not-run"` until the human changes that policy. Do not exempt all ignored files from proof or copy them all to the remote.

## Scope and verdict

Source: [hearsay-tools/squeal#280](https://github.com/hearsay-tools/squeal/issues/280), fetched 2026-11-25 with `gh issue view 280 --repo hearsay-tools/squeal --json title,body,comments,url`. The reporter names Squeal 0.1.630, also 0.1.606–0.1.627, and 2,486 checks becoming UNKNOWN after ignored build outputs changed. The separate setup-file incident says `config and setup files differ`.

Examined source: 0.1.633, commit `26e64f04aefbd869fe61e3dd2df1080df905c26a`; session runtime: 0.1.630. Tag `squeal--v0.1.630` resolves to `88e92b40aba17dcb6e7e6781baf76a389b4b413e`. `git diff --name-only squeal--v0.1.630 HEAD -- src/core/runner-host/remote src/core/runner-host/host.ts src/core/keys/environment-descriptor.ts` returned no files. This verifies those mechanisms are unchanged from the reported release, not that every earlier release behaves identically.

| Question | Answer and evidence tag |
| --- | --- |
| Can ignored `dist/index.html` and `dist/hsq.js` cause the exact refusal? | **verified by experiment**, 0.1.633 source: yes, when included in the synthetic runner's closure. Both remain outside the sync tree, both attempts refuse, no test body runs, and the result says `its tree stayed different at <path>`. |
| Can observed-only ignored inputs also do this? | **verified by experiment**, same source: yes. A remote run observes a generated HTML input whose bytes differ locally. Both executed attempts fail the post-run proof. |
| Does a normal tracked `vitest.setup.ts` edit reproduce refusal? | **verified by experiment**, same source: no in this controlled transport. Baseline passes, edit invalidation copies the new bytes, and the next run passes. |
| Can the setup diagnostic and fallback behavior be reproduced? | **verified by experiment**, same source: deliberate remote drift after that successful sync yields `config and setup files differ: vitest.setup.ts`. `not-run` returns no completed files and invokes no local runner; `local` invokes it once and completes. |
| Why UNKNOWN rather than local execution? | **read in source code**, same source: the lane honors explicit `not-run`; the scheduler marks incomplete, non-setup-failure files unknown. The probe verifies the incomplete report, not a 2,486-check scheduler/store transition. |

## Findings

1. **read in source code, 0.1.633:** sync and proof accept different input sets. `tree.ts:treePaths/treePathsFor` list tracked files and non-ignored untracked files with Git. `writesFor` sends no bytes for an untracked ignored path; it emits a removal. `connect.ts:remoteHostOver` uses these functions both on connect and on invalidation. This follows 021 D10's explicit boundary, adopted to avoid copying ignored secrets such as `.env`. A tracked file matching an ignore pattern is still sent.

2. **verified by experiment, 0.1.633:** retries cannot repair an ignored input required by proof. `lane.ts:runInputs` includes closure and environment paths. `host.ts` compares expected blobs before running and adds observed paths to the after-run proof. `lane.ts:remoteRun` resends differing paths and retries once, but the resend applies the same Git exclusion. Both reported artifact basenames reproduce with genuine Git ignores and the real transport code. The observed-input variant proves this is not confined to declared imports. Ignored files outside all these proof inputs did not prevent the setup control from passing.

3. **read in source code, 0.1.633:** setup bytes are deliberately part of environment identity. `src/runners/vitest/environment.ts:environmentFiles` includes setup/global-setup closures, configs and missing-resolution candidates. `lane-compare.ts` reads their remote and local blobs, including under remote planning. `environment.ts` rejects unequal descriptors in both environment modes. An ignored artifact listed in the synthetic environment reproduces `config and setup files differ: dist/index.html` at connect. That is one possible connection between the two symptoms; **inferred**, not evidence that the reporter's setup imports these outputs.

4. **verified by experiment, 0.1.633:** fallback already works when configured. With `whenLost: "local"`, the ignored-closure refusal and setup-drift refusal each run locally once and complete. With `not-run`, both return `end: "crashed"`, zero completed files, no local run, and a failure string naming refusal and policy. **read in source code:** `lane.ts:instead` implements this; `scheduler/record-tier.ts:recordIncomplete/markUnknown` supplies unknown state for incomplete files. This is consistent with 026 D8.3 and 021 D13, not evidence that policy is ignored.

5. **inferred, bounded by the passing setup control:** the setup incident needs its actual differing file list and blob evidence before selecting a repair. A branch editing a tracked setup file alone does not establish persistent sync failure. Other possibilities include an ignored setup dependency, a changed environment file list, or another writer on the remote. These were not established for the reported worktree.

## Reproduction and limits

The [throwaway probe](probes/issue-280/probe.ts), [instructions](probes/issue-280/README.md) and [raw results](probes/issue-280/results.jsonl) preserve eight cases. Exact recorded command:

```sh
env -u NODE_OPTIONS pnpm exec tsx docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-280/probe.ts > docs/specifications/026-tiered-and-cloud-execution/research/probes/issue-280/results.jsonl
```

Exit 0, eight assertions satisfied. Node v26.13.0. `getconf _NPROCESSORS_ONLN`: 16. Initial research load `0.75 0.27 0.11`; first probe `1.09 0.56 0.23`; recorded run `0.91 0.56 0.24`, all below 16. Each invocation completed in under a second of reported tool wall time. No full suite, real Vitest execution, live provider, SSH, machine creation, dependency install or credential/config change. The protocol and sync are real; runner discovery and test bodies are synthetic. The full reporter campaign, restart persistence and 2,486-check fan-out were not reproduced.

Read the session-pinned Squeal skill before the probe. `squeal checks` via the session launcher reported default edit checks (2,270 test files), excluding e2e and not covering typecheck/build. Background revision-0 failures arrived during research and predate these documentation/probe edits, including CI export/preload discrepancies and a chain-load timing failure. They are unrelated evidence, not passes or failures of this reproduction; no product test suite was manually rerun.

## Recommendation and open questions

**inferred:** approve diagnosis/repair scope around the mismatch between 021 D10's sync boundary and D11's required inputs, plus actionable refusal diagnostics under 026 D12 / 021 D17. Preserve proof for any test-relevant input. A policy for explicitly allowed generated inputs or local routing when proof cannot be met needs a human decision; copying every ignored file violates the current sync boundary, and ignoring all such proof would admit results from different inputs. Keep existing opt-in `whenLost: "local"` available and explain it, without overriding an explicit `not-run` choice.

The setup incident remains partially reproduced: obtain the complete named differing files, their local/remote blob IDs, Git eligibility and the relevant setup dependency closure. Retain #280 as the trigger/input-consistency problem; #278 overlaps recovery diagnostics for remote outages, not this demonstrated sync/proof mismatch.

Normative sources read: [026 D6/D8/D12](../spec.md), [026 amendments](../status.md), [021 D10–D13/D17](../../021-remote-store-and-execution/spec.md), [021 amendments](../../021-remote-store-and-execution/status.md), and the repository process, vision and styleguide. No product, specification, status, skill or board edits were made by this researcher.
