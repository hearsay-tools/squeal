# Issue 121: repeated promoted waits and interrupted parity files

Recommendation: treat this as overlapping named-wait friction related to gh-79; the reported cut from repeating an identical selection after 133 seconds is not reproduced.

Researcher, 2026-10-28. Source: `23e188b110b0c5a98478dcafe7b07c3f458d7d9c`, Squeal **0.1.374**; incident **0.1.372**, revision 10. Installed session runtime: 0.1.374; Node v24.22.1, Vitest 5.0.3. `git diff --name-only squeal--v0.1.372 HEAD -- src/core/scheduler src/cli/status-wait-paths.ts` returned no paths. The examined scheduler and named-wait source match the incident release (read in source code). This does not establish identical runtime state or configuration.

## Questions and verdicts

| Question | Answer at 0.1.374 | Evidence |
| --- | --- | --- |
| Do repeated identical selections cut an already running tier after 30 s? | Not reproduced. Requests at model times 40, 101 and 162 s preserve the same run, including after prior promotion expiry. | verified by experiment, case 1 |
| Can a later promoted wait cut previously promoted running files at unchanged keys and revision? | Reproduced with a different selection. After the original wait expires, a wait omitting the running files cuts three files at model time 133 s with 175 s remaining. | verified by experiment, case 2 |
| Can an open wait's files be cut? | Reproduced before 30 s. An overlapping request at 10 s cuts three already promoted files. A repeat then publishes `cut` and does not cancel those keys again. | verified by experiment, case 3 |
| Does this explain 38 of 56 files still pending after eight minutes? | Not determined. No incident JSON, exact promotion history, or complete run history was recorded in #121. | inferred limit from issue evidence |
| Is this the same as the related reports? | Closest to gh-79's later interruption report. Slow-lane eligibility, successor priority loss and large-gate tier size are separate mechanisms. | inferred from sources below |

## Method and actual results

Initial load supplied in the brief: 10.44 on 24 CPUs. A local read at 16:27:01 UTC also gave 10.44. Immediately before each probe, one-minute load was **18.10** (16:27:16 UTC) and **20.96** (16:28:09 UTC), both below 24 CPUs. The saved load records include the five- and fifteen-minute values. No live Cezar parity tests or full suites ran. No real worktree hold was changed.

Exact execution command and load guard are in [the probe README](probes/issue-121/README.md). The test command was:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-121/vitest.config.ts
```

Both invocations exited 0: **1 probe file, 3 checks passed**, 8.44 s and 4.99 s. The second added saved snapshots and exact elapsed/remainder assertions. Output: [first run](probes/issue-121/output.txt), [second run](probes/issue-121/output-rerun.txt), [observations](probes/issue-121/observed.jsonl). Squeal reported that no test it runs reads these probe files, so they were run directly. A scoped `pnpm exec biome check --write` on the two probe TypeScript files processed zero files and exited 1 because repository configuration excludes these paths; it changed nothing and is not a lint pass.

Final affected read: `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 docs/specifications/011-core/research/probes/issue-121/promoted-waits.probe.ts docs/specifications/011-core/research/probes/issue-121/vitest.config.ts` exited 3: no test closure holds either probe; worktree known failures 0, all 1315 test files current at revision 12. [Saved status](probes/issue-121/squeal-status.txt). This supplies no probe verdict; the explicit three-check run does. No full-suite run was requested.

The fixture follows `test/scheduler/tier-yields-named.test.ts` and the issue-91 probe: real scheduler, fake runner, temporary repository/store and private capacity pool. Three unfinished files have 308,000 ms known durations. A 1 ms file in another project waits in the same lane. One edit creates revision 1; all later actions are promotions. Model time advances while real timers remain in use. Held fake runs complete or cancel without consuming minutes of CPU. Every case asserts unchanged keys and revision and finishes with all four files current. These are fixture verdicts, not product-suite verdicts (verified by experiment).

## Findings

**F1. Identical repeats retain protection (verified by experiment, 0.1.374).** At 40, 101 and 162 model seconds, each request selects the running three files and the queued fourth for 60 seconds. Every snapshot reports `named`, no last yield and the original run still open. The first and second promotions have expired before the next request. Final order is `[three running files]`, `[fourth file]`, with zero cancellations.

**F2. Expired protection plus a smaller selection reproduces the cut shape (verified by experiment, 0.1.374).** The first selection covers all four at 40 s and expires at 100 s. At 133 s only the queued fourth is promoted. The saved last yield records `to: promoted`, `rule: remainder`, `remainderMs: 175000`, and three cut files. `at - runStartedAt` is exactly 133,000 ms. The cancelled run completed none; the fourth file runs, then the three restart. Keys and revision remain unchanged. Matching these numbers was deliberate fixture input, not independent confirmation of the incident's cause.

**F3. Early overlapping demand can discard work without advancing its new file (verified by experiment, 0.1.374).** A wait first names the running files. At 10 s a second wait includes the queued fourth too. The tier yields, but the earlier request still ranks the three cut files first. They restart before the fourth. A repeated whole selection publishes `cut`; all files eventually finish with one cancelled tier. Thus a yield to promotion need not give the new file the next run in this case.

**F4. These outcomes follow the current contract (read in source code, 0.1.374).** C4 step 5 and C15 Rank protect a tier after 30 s when it runs a file selected by the same or an earlier **open** wait. `rankToBeat` returns no protecting rank before 30 s. `Promotions.rankAt` ignores expired entries. `waitedFor` compares queued promotion rank against the unfinished running files' rank; `TierYields` keeps cut marks per file/key. Status amendments for 011-184, 011-193/194 and 011-196 document the rank rule, one clock reading per decision and promotion retention across requeue. No broken once-per-key guard was shown here.

## Overlap and limits

| Related item | Relation to #121 (inferred from issue and board sources at the examined commit) |
| --- | --- |
| gh-79 | Strong overlap with [its later evidence](https://github.com/hearsay-tools/squeal/issues/79#issuecomment-6433715406): overlapping parity/guard waits, a 121 s cut and an 18 s cut at unchanged revision. Its original demand was named files ahead of the queue. The later comment explicitly does not prove repeated cancellation of the same key. |
| gh-110 | Named slow browser files wait behind fast work. This probe exercises fast-lane interruption, not slow-lane eligibility. |
| gh-116 | A daemon successor loses in-memory promotion. No handover occurs in this probe or is reported as the trigger in #121. Shared promotion-lifetime subject, different trigger. |
| 011-208 | Planned research on 41 promoted files beside a 537-file backlog, comparing tier sizing and fairness. Large-gate latency overlaps; this four-file probe does not measure that cost or replace the row. |

The original 56-file, eight-minute incident is **not reproduced**. The 133-second cut is reproduced only after changing the selection and allowing its prior protection to expire. Repeating the identical whole selection after 30 seconds did not reproduce it. The probe calls scheduler promotion directly; it does not drive CLI/socket delivery, real Vitest execution, concurrent callers, claims, focus requests, handover or timer-boundary races. It measures no real discarded CPU time and proves no unbounded starvation.

The next evidence needed to identify the incident mechanism is the actual selection of each overlapping wait, its deadline and any focus request, plus `lastYield`, running files and their keys at the cut. This is an evidence request, not a fix design. Existing holds stand; this research authorizes no implementation or contract change.

## Sources

- `gh issue view 121 --repo hearsay-tools/squeal --json number,title,body,comments,url,state`: [issue 121](https://github.com/hearsay-tools/squeal/issues/121), read 2026-10-28; no comments or JSON incident snapshot then.
- `gh issue view 79`, `110`, `116`, each with `-R hearsay-tools/squeal --json title,body,comments,state`: [79](https://github.com/hearsay-tools/squeal/issues/79), [110](https://github.com/hearsay-tools/squeal/issues/110), [116](https://github.com/hearsay-tools/squeal/issues/116), read 2026-10-28.
- Local contracts: `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/board.md` (gh-79/110/116 and 011-208), `docs/specifications/011-core/spec.md` C4/C15 and `status.md` amendments cited above.
- Implementation: `src/core/scheduler/{yields,promotions,queue,scheduler}.ts`, `src/cli/status-wait-paths.ts` (`ownNamedFiles`, first promotion).
- Probe source: [promoted-waits.probe.ts](probes/issue-121/promoted-waits.probe.ts); lead fixtures: `test/scheduler/{tier-yields-named.test,tier-yields-fixture,catch-up-fixture,model-clock}.ts`; prior research: `research/issue-91.md`.
