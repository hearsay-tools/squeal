# Issue #254: passing files with unread key inputs are left out of CI export

2026-11-20. Recommendation: bring the reproduced reuse loss to the human as a request to reconsider D9, preserving the existing hold until that decision changes.

## Verdict and questions

| Question | Answer and evidence tag |
| --- | --- |
| Does an unread declared input exclude a passing file in a clean checkout? | Yes. Squeal 0.1.578 records the pass with `dirty: false` but no evidence for the tracked document; a fresh clone's export leaves the test out. **verified by experiment** |
| Does an unread static-graph closure input do the same? | Yes. A literal dynamic import that is never invoked leaves its tracked target in the export's closure calculation but absent from the part's evidence; export excludes that passing test. **verified by experiment**, 0.1.578 |
| Does reading those inputs change the outcome? | Yes. With an explicit document read and the dynamic import invoked, both paths have evidence and all three fixture test files export. **verified by experiment**, 0.1.578 |
| Is this contrary to the current spec? | No. D9 requires evidence for every key input from that file's shard. D24 explicitly retains this rule for node:test; D26 retains static-plus-observed closures. **read in source code**, spec/status at `9387fe8d4` (0.1.578) |
| Is the incident's full scale reproduced? | Not determined: the 97 browser files, roughly 235 unread declared inputs, and 325 Vitest omissions are the reporter's counts for 0.1.522/0.1.577, not independently rerun here. The small Vitest fixture reproduces both mechanisms. **read in official docs** (issue report), **verified by experiment** (fixture, 0.1.578) |

## Independently run evidence

Squeal's committed CLI printed `0.1.578`, source checkout `9387fe8d4d3da1b3cdbda72aa7c37e05fa9ffe5c`. Node `v26.13.0`; Vitest `5.0.3`; 24 logical CPUs. Initial orientation load was `12.93 13.51 17.10`. Immediately before the successful probe, load was `14.72 14.05 16.93`; one-minute load before the read control was `14.58`. Both were below 24. Only two three-file Vitest runs, one worker at a time, ran successfully; no full suite, browser suite, build or VM was used. An earlier fixture setup attempt also ran three passing tests before a probe-only clone setup error; [README](probes/issue-254/README.md) records the correction.

Exact driver command:

```sh
node docs/specifications/018-ci-and-shared-results/research/probes/issue-254/run.mjs > docs/specifications/018-ci-and-shared-results/research/probes/issue-254/output.txt 2>&1
```

It exited 0. The [preserved output](probes/issue-254/output.txt) includes each public CLI command, exit code, clean `git status --porcelain`, part evidence and bundle closure. The fixture's commands use `CI=true`; substituting only machine paths, the unread run was:

```text
node <repo>/plugins/claude-code/dist/cli/squeal.mjs ci record --out <scratch>/unread-parts -- node <repo>/node_modules/vitest/vitest.mjs run --maxWorkers=1
 Test Files  3 passed (3)
      Tests  3 passed (3)
squeal ci record: wrote 1 part with 3 test files to <scratch>/unread-parts
exit=0

node <repo>/plugins/claude-code/dist/cli/squeal.mjs ci export --parts <scratch>/unread-parts --out <scratch>/unread.json.gz
Exported 1 test file, 2 results, to <scratch>/unread.json.gz.
Left out: 2 test files whose inputs here are not what their shard read.
squeal ci export: left out test/declared.test.ts: its shard recorded other content, or none, for docs/unused.md
squeal ci export: left out test/lazy.test.ts: its shard recorded other content, or none, for src/lazy.ts
exit=0
```

**verified by experiment, 0.1.578:** both fixtures' parts use `squeal-ci-part/4`, have `dirty: false`, and hold three passing files. In the unread case, neither `docs/unused.md` nor `src/lazy.ts` exists in `evidence`. In the read control their hashes are respectively `8236b9a0323a81a5cc722c410cd42b5402f86f9e` and `24e545669f9a0ac4c4e77027f988b7b17f134b76`. That control exports `3 test files, 6 results`, exit 0. Its exported closures include the declared document for `declared.test.ts` and the lazy module for `lazy.test.ts`. This isolates missing read evidence; no content mismatch was needed. The controls use distinct committed test bodies, each exported from a fresh clone of its own recording commit.

## Cause and existing decision

**read in source code, 0.1.578:** `src/core/scheduler/keying.ts:521` assembles each closure with policy-declared inputs. `src/core/keys/closure.ts:197-200` unions runner paths, declared inputs and observed paths. `src/runners/vitest/graph.ts:165-168` includes literal dynamic-import targets. `src/core/ci/export.ts:181-190` certifies every closure path and drops the file when any fails. `src/core/ci/export-inputs.ts:19-29` selects the file's own part through `FileReuse`; `src/core/ci/inputs.ts:249` classifies an absent evidence entry as `unrecorded` before consulting checkout content. `test/ci/export-keys.test.ts:375` expressly expects an unread commit-tracked input to exclude a file; this test was read, not run.

**read in source code, spec/status at `9387fe8d4`:** D8 states the condition that nothing changes the inputs during recording. D9 separately requires evidence taken while reading each input. D11's use of commit blobs is for import re-keying an already exported result; it does not authorize export to substitute blobs for missing evidence. D24 repeats that an input with no evidence is left out; D26 retains the closure rules for the approved node:test work. That work is not widened by this finding.

**read in source code, prior research of 0.1.443:** [left-out-files.md](left-out-files.md), cause C, already found static imports never loaded in the file's own shard (56 files, 366 seconds of test time). It also found native readers such as esbuild whose inputs matter despite not appearing in hooked reads. [status.md](../status.md), 2026-11-12, explicitly says: "D9 stays as it is (cause C of `research/left-out-files.md` not taken)." The present lazy-import reproduction is a recurrence of that known cause; declared inputs expose the same certification rule through another closure source.

## Decision for the human and limits

**inferred from the 0.1.578 experiment and current D9:** accepting tracked commit blobs for paths absent from evidence would recover these fixture passes, but changes the evidence contract. A missing entry alone does not prove a path was irrelevant or never read: hooks may miss native reads, and `readRecorded` removes evidence for conflicting content or writes. The reporter's proposal therefore needs an explicit policy decision and a definition that distinguishes never-observed inputs from invalidated evidence. No safety claim for that proposal was tested here.

Keep the 2026-11-12 hold unless the human reopens it. If reopened, decide which clean-checkout and no-write assumptions may substitute for read evidence, which tracked paths qualify, and how invalidated or unhooked reads remain excluded. The tradeoff is reuse of valid passes versus the strength of content provenance. This report approves no fix, key change, node:test scope change, or original-suite rerun.

## Sources

- [Issue #254](https://github.com/hearsay-tools/squeal/issues/254), fetched with `gh issue view 254 --repo hearsay-tools/squeal --json title,body,comments,url`; no comments at retrieval. Incident versions 0.1.522 and 0.1.577; reported CI run 44748111052 and blocker squawk#3980 were not fetched or rerun.
- [Probe source](probes/issue-254/run.mjs), [output](probes/issue-254/output.txt), [instructions](probes/issue-254/README.md).
- [Spec D8/D9/D11/D24/D26](../spec.md), [status](../status.md), and [prior cause C research](left-out-files.md), at checkout `9387fe8d4`.
- Product source and existing test paths cited above, at `9387fe8d4` / 0.1.578.
