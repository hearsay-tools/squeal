# Keep #125 scoped to the remaining foreground handoff gap

Recommend treating the four-file scheduling symptom as overlapping the released #79/#121 fixes, while keeping any stronger completion or handoff guarantee as a separate human decision. The original incident is **not reproduced**. `squeal hold` already provides a partial manual handoff, including in 0.1.374, but does not guarantee exclusive execution, bound the command, or import its result.

Research on 2026-10-29, within a 20-minute task. Product, board, spec, status and skills unchanged. Existing holds stand.

## Questions and verdicts

| Question from the brief | Answer and evidence tag |
| --- | --- |
| 1. Does this reproduce the reported 0.1.374 incident? | **Not determined, because** the external 56-file gate was not replayed, and its eventual background completion time and contemporaneous capacity trace are absent. The issue's timings are reporter evidence, not a measurement here. **inferred**, report names 0.1.374. |
| 2. Does current Squeal still select a broad whole-file gate four at a time? | Not always. With 12 promoted files, three unrelated backlog files and no edit work, the selector takes all 12 in a promoted backlog tier. Adding one queued edit changes the first tier to four named files. **verified by experiment**, 0.1.377. |
| 3. Is a named wait a bounded foreground owner? | No. Its deadline bounds waiting and promotion. It gives no total completion guarantee, exclusive host capacity, or foreground result import. **read in source code**, 0.1.377, C4/C6/C10/C15 and S3 below. |
| 4. Is a bounded manual handoff available? | Partly: `hold --max <duration> -- <command>` limits the validation hold. It does not limit the command or require all cancellation to settle before launch. **verified by experiment**, 0.1.377; the wrapper is unchanged from 0.1.374. |
| 5. Is #123 the same request? | No. #123 concerns selected test rows and focused outcomes; #125 requires every test in each selected file. **read in official docs**, first-party issues #123/#125 reporting 0.1.374; C15 at 0.1.377. |

## Findings

**F1: versions and incident limits.** **read in official docs**, first-party issue #125, report names 0.1.374. The reporter saw 33 of 61 selected files pending after about ten minutes, then a foreground gate passed 56 files / 2,524 tests in 490.44 seconds. It states: “I did not record the eventual time Squeal needed to finish that selection.” The 61-file selection included five extra suites. Thus even the selections differ, and the figures cannot establish a background/foreground speed ratio. The report itself says the runs overlapped and might have increased load. No wrong verdict is alleged.

**verified by experiment**, local metadata: the active session primer and `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal --version` identify **0.1.377**. The checkout is `0def9f2c3b0fe13412ad333f42ee159edd350816`, package version 0.1.377. The probe runner reports **Vitest 5.0.3**. These are not measurements of the incident's runtime. The local daemon was alive; its process version was not independently queried. The release API reports tag `squeal--v0.1.377`, published `2026-10-29T06:39:51Z`; its local commit is `c39701a1f9ac1ffb6feb3de92637bb43fea40ac2`.

**F2: the shipped scheduling changes matter.** **read in source code**, 0.1.377. Row 011-263, landed in 0.1.375 and included in this release, checks whether a cut starts a promoted file sooner than letting the running tier finish. Row 011-265 sizes promoted-only Vitest-style tiers like backlog tiers when no edit work is queued. Its repaired rank rule protects the tier from files of the same or a later open wait from its start. Protection is tied to open promotions, not permanent ownership. These changes are recorded in `status.md` and the release comments on #79/#121. The relevant `promoted-tier.ts`, `yield-sooner.ts` and `hold.ts` sources have no diff between the release tag and this checkout.

**verified by experiment**, 0.1.377: the two selector cases returned `(kind=backlog, promoted=true, files=12)` without edit work, and `(kind=edit, promoted=false, files=4)` with it. This uses the real selector, queue and SQLite store with synthetic whole-file identities and unknown durations. It does not run those files, allocate real pool capacity, invoke `status --wait`, measure gate speed, or retest overlap cancellation. It proves that four-file selection is conditional today, not that the incident would now finish within a deadline.

**F3: existing bounds are not a gate deadline.** **read in source code**, 0.1.377. C4 says the backlog wall budget “limits the tier's estimated wall time, not its real one”; unknown durations count zero and the first worker round is taken regardless. C10 requires promoted-only tiers to take pool permits and obey project worker ceilings. C15 expires promotion at the wait deadline. `status-wait-paths.ts` returns a timeout without cancelling the selected work. Thus `--wait 60000` is not a promise to finish a broad selection in 60 seconds. Row 011-266 already holds the related fairness questions for a human decision; this report does not widen it.

**F4: `hold` is a partial handoff with measurable limits.** **read in source code**, 0.1.374 and 0.1.377: `src/cli/hold.ts` and `src/core/scheduler/command-hold.ts` are unchanged between these tags and this checkout. The operation holds this worktree's validation, not every daemon on the host. C9 specifies cancellation for runners that support it; node:test/pytest slots finish their current files. Unfinished work returns to the queue. The wrapper spawns the command, returns its exit code, removes the hold and requests resume. It has no mechanism to store that command's test results under Squeal keys, so later daemon work can repeat the manual gate.

**verified by experiment**, 0.1.377, real child processes and stores, synthetic daemon replies:

- `--max 1s` with a child that exits 7 after 2.2 seconds: the actual `CommandHold` timer removed the hold while the child was alive; the wrapper later returned 7. This bounds the hold, not the command.
- A daemon reply that never reports cancellation settled: the default wrapper wait ended and the child ran after **3,085 ms**, exit 0. No unsettled-cancellation warning was printed. This establishes the wrapper's behavior; it does not prove a real Vitest cancel takes that long.

The tradeoff is progress versus ownership: ordinary named demand reuses stored results and shares capacity; a manual hold offers explicit execution but can lose partial progress and leaves no shared verdict from the foreground command. A strict bound or guaranteed non-overlap cannot be promised from the present operations.

## Verification and remaining questions

Before the first live probe, one-minute load was **10.2671 / 24 CPUs**; after removing unused fixture helpers, the final run started at **12.1450 / 24 CPUs**. Both were permitted. Final result: **2 probe files, 4 checks passed, exit 0, 8.36 s**. Exact commands, final load and output are in [the probe directory](probes/issue-125/README.md). These research files are outside the normal Vitest/Squeal include; only their explicit paths ran. The affected-status read returned exit 3, “no test file's closure holds” each probe path ([output](probes/issue-125/squeal-status.txt)); this is no daemon verdict on the probes. No product suite, external gate, full suite, or full-suite checkpoint was requested. Biome ignored the research directory (exit 1, zero files checked), so no lint pass is claimed. Temporary stores and child processes were cleaned by the fixtures; retained files are probe sources and evidence.

Open: actual 0.1.377 completion time and pool contention on the external gate; real cancellation settling time during a handoff; whether the human wants a stronger whole-file completion/ownership contract beyond existing demand and `hold`. A later incident report should include exact selected paths, wait deadlines, `selection.testFiles[].reason`, `lastYield`, source revision, active version and capacity evidence. Do not infer success for the old incident from the release or this probe.

## Sources

- S1: fetched with `gh issue view`: [#125](https://github.com/hearsay-tools/squeal/issues/125), [#123](https://github.com/hearsay-tools/squeal/issues/123), [#121](https://github.com/hearsay-tools/squeal/issues/121), [#79](https://github.com/hearsay-tools/squeal/issues/79). [0.1.377 release](https://github.com/hearsay-tools/squeal/releases/tag/squeal--v0.1.377), fetched with `gh release view`.
- S2: [spec C4, C6, C9, C10, C15](../spec.md), [amendment log](../status.md), [board](../../../board.md), examined at `0def9f2c3b0fe13412ad333f42ee159edd350816`.
- S3: source at that commit: `src/core/scheduler/{promoted-tier,tiers,yield-sooner,promotions,command-hold}.ts`; `src/cli/{main,hold,status-wait-paths,status-wait-promote,run}.ts`. [Pinned source tree](https://github.com/hearsay-tools/squeal/tree/0def9f2c3b0fe13412ad333f42ee159edd350816/src).
- S4: [run output](probes/issue-125/output.txt), [load](probes/issue-125/load.json), [selection probe](probes/issue-125/selection.probe.ts), [hold probe](probes/issue-125/hold.probe.ts).
