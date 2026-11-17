# Issue 234: completed narrow run followed by queued text

Recommend clarifying request history versus final selected-file state before changing scheduler semantics.

## Verdict and scope

**verified by experiment · Squeal 0.1.531.** The reported wording reproduces on a real daemon with two synthetic Vitest files. A successful narrow run prints `completed`, then `2 queued, which run now`, although both selected files are current and the actual queue is empty. No snapshot race or focused run is needed. This proves confusing output, not a false pass over files still pending in the verdict's read.

The brief supplies no numbered questions. The table below covers its questions. Research ran on 2026-11-17 within the 20-minute limit. Product code, board, specs and status files are unchanged. Existing holds stand; this report authorizes no implementation.

| Question | Answer and evidence tag | Version |
| --- | --- | --- |
| 1. Does the reported command produce completed plus queued? | Yes, in a two-file live fixture. The queued text is the earlier request receipt. **verified by experiment** | 0.1.531 |
| 2. Is this a forced whole-file run or a focused run? | A narrow group run selects whole files and reuses current results. It is neither `--force` nor `--check`. A repeat queues zero files. **verified by experiment**; distinctions **read in source code** | 0.1.531; matching relevant source in 0.1.543 |
| 3. Can separate snapshots disagree? | Yes. Injecting a queue change after the verdict output makes the following status list the same selected file queued, with exit 0. **verified by experiment** (synthetic interleaving) | source 0.1.531 and 0.1.543 |
| 4. Does a file pending before the verdict read get a clean result? | The control returns no verdict, exit 3. Source guards completion on current selected files. **verified by experiment** and **read in source code** | source 0.1.531 and 0.1.543 |
| 5. Which sections own it? | Primarily 019 D6 Command/Narrow run and 011 C6 Status; 011 C4 validity and C15 named/focused demand constrain the answer. **inferred** from the named contracts | docs at 0.1.543 checkout |

## Evidence

### 1. Live wording reproduction

**verified by experiment · 0.1.531.** Initial host check: one-minute load 12.11, 24 CPUs (24 available). At live start, load was 8.65/24. Node was 26.13.0; installed Vitest was 5.0.3. The pinned runtime printed version `0.1.531`. The checkout was `b0da5d149d445ea92c8517497141a7ed6dbbcc96` (package 0.1.543); the runtime was not built from that checkout. Tag `squeal--v0.1.531` resolves to `daf50f82e48e697545cfb7a378f4d46b03ce8a27`.

Exact invocation and fixture construction are in [the probe README](../../../../research/probes/issue-234/README.md). Its first request printed:

```text
$ squeal run run-loop test/a.test.ts test/b.test.ts --wait 60000
Selected test files of group run-loop completed at revision 0: no known failures; 2 test files, 2 queued by this request
Group run-loop at revision 0: these paths select 2 test files; 2 queued, which run now.

Revision: 0
Known failures: 0; all 2 test files current
Affected checks: 4 passed (2 tests, 2 test files loaded), 0 running, 0 queued
exit=0
```

The following `squeal status test/a.test.ts test/b.test.ts` said `2 test files, each with a current result`. Repeating the run said `0 queued by this request` and `all current; none runs again`, exit 0. Full output is [live-output.txt](../../../../research/probes/issue-234/live-output.txt). Start, both requests, selected status and stop all exited 0.

**read in source code · 0.1.531 and unchanged relevant code at 0.1.543.** `src/cli/run-group-narrow.ts:109–134` constructs `line` from the taken request before waiting. `narrowText` at lines 164–190 describes that request as `queued, which run now`. `src/cli/run-group-wait.ts:53–65` prints the final verdict, then this old line, then a new worktree status read. `endedLine` at lines 116–140 also prints the historical count as `queued by this request`. The second line does not label itself historical. This explains the live output.

### 2. Whole-file, forced and focused semantics

**read in source code · 0.1.531 and matching code in 0.1.543.** `src/core/scheduler/narrow-run.ts:175–195` excludes current files and queues only non-current selected files. `runGroupCommand` rejects group flags other than the separately parsed wait, so the reported command has no `--force` behavior. In contrast, `src/core/scheduler/checkpoint-requests.ts:55–97` includes current runnable files when force is true; `checkpoints.ts:33–45` says a forced checkpoint requires its own runs' results. No forced full-suite checkpoint was run for this research.

**read in source code · 0.1.531 and matching code in 0.1.543.** A focused run is requested with `status ... --check`, not by naming several paths to `run`. `src/core/scheduler/focused-record.ts:19–44` and `focused-row.ts:9–18` keep focused outcomes outside stored results and known states. Spec 011 C4 says a focused outcome has no validity. C15 Focused checks permits the file to remain pending and gives exit 3 for a non-failing focused-only answer, or 1 for its failure. That legitimate distinction does not explain the live reproduction, which used no focus. Focus execution itself was not exercised here.

### 3. Separate snapshot race and pending control

**verified by experiment · source 0.1.531 and 0.1.543.** [snapshot.ts](../../../../research/probes/issue-234/snapshot.ts) seeds one current file, calls the actual `waitForGroup`, then queues that file in its first stdout callback. This places a write precisely between the completed verdict and `readStatus`. The output is:

```text
Selected test files of group run-loop completed at revision 0: no known failures; 1 test file, 1 queued by this request
[probe queues the same file between verdict output and status read]
Revision: 0
Known failures: 0; not current: 1 of 1 test file (1 queued)
Queued: 1 test file: test/a.test.ts
exit=0
```

The control begins with that file already queued and the deadline expired. It prints `have no verdict: the deadline passed with 1 test file pending at revision 0`, exit 3. Final source-probe loads were 10.13/24 on 0.1.543 and 8.50/24 on 0.1.531. See [0.1.531 output](../../../../research/probes/issue-234/snapshot-531-output.txt) and [0.1.543 output](../../../../research/probes/issue-234/snapshot-output.txt).

**read in source code · 0.1.531 and 0.1.543.** The group wait reads classes and verdict inside one status-store read transaction (`src/cli/wait/wait.ts`, `worktreeRead`; `src/core/status/open.ts`, `readOnce`). `RUN_WAITS.group` in `src/cli/wait/table.ts:254–264` waits while files are pending. `src/cli/verdict.ts:235–258` refuses a clean result for pending, unlisted or non-current selected files. `src/core/state/file-class.ts:18–31` treats a queued file row as pending even if its retained checks are current. The later `readStatus` is outside that transaction. The probe proves the output boundary can mix states; it does not establish a live scheduler race or a false verdict within one read.

## Recommendation and open questions

**inferred · evidence from 0.1.531.** Keep issue 234 as a reproduced reporting defect. The deciding tradeoff is trust in final state versus preserving useful request history. The coordinator should settle how request history and the final selected-file verdict are distinguished, and whether the accompanying status must describe the same observation. Precise owners: **019 D6 Command and Narrow run** for the command contract; **011 C6 Status** for snapshot provenance; **011 C4 Scheduler and result validity** for the pending/current invariant; **011 C15 Named demand and Focused checks** for the whole-file versus focused distinction. C5 supports focused storage rules. No evidence here calls for changing queue order or treating focused outcomes as current results.

Not determined: which queued line the original worker saw, whether its output's status also listed selected files queued, its revision, file names, exit code, policy, or concurrent edits. [Issue 234](https://github.com/hearsay-tools/squeal/issues/234), fetched with `gh issue view 234 --repo hearsay-tools/squeal --json title,body,comments,url`, supplies none of those and has no comments. The original parity batch was not replayed. The live fixture ran two tiny files once, plus one current-result repeat. The synthetic race injects state directly and measures no natural frequency. No full suite, build or product tests were run.

Sources: the fetched issue; repository docs `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/board.md`, specs 011 C4/C6/C15 and its amendment log (notably 011-327/328/335), and 019 D6; [pinned 0.1.531 source](https://github.com/hearsay-tools/squeal/tree/daf50f82e48e697545cfb7a378f4d46b03ce8a27/src), at the paths above. No open-web search was used.
