# Issue 146: execution width of admitted Vitest tiers

Collect the incident's granted width before changing execution or named-wait policy.

The serial-tier incident was **not reproduced**, because the bounded fixture ran four files concurrently on the reported Squeal version. A controlled grant of one did produce serial execution despite `maxWorkers: 4`; that proves a possible mechanism, not the incident's cause. The deciding tradeoff is useful parallel work within the shared capacity grant versus overriding resource and fairness policy without evidence.

## Questions and verdicts

| Question | Answer and evidence tag | Version examined |
| --- | --- | --- |
| Do admitted files execute at one effective worker despite parallel settings? | Not in the small daemon reproduction: a 12-file tier reached peak 4 and 3.45 effective workers. **verified by experiment** | Squeal 0.1.390; Vitest 5.0.3; Node 24.22.1 |
| Where is execution width set? | The scheduler's lease grant becomes `RunOptions.workers`; `VitestWidths` writes it into resolved root/project `maxWorkers` before `runTestSpecifications`. **read in source code** | Squeal tag 0.1.390, commit `5d93ab1720d4e457739168e8b59cf2ae113f22c1` |
| Can that seam produce serial execution? | Explicit grant 1 produced peak 1; grant 4 on the same warm adapter produced peak 4. **verified by experiment** | Checkout 0.1.401, `92e8f18970d1345cf6f4c5b7a934a7554e63efec`; width implementation unchanged from 0.1.390 |
| Can a named wait overtake active work? | Sometimes, through a permitted yield or a small later batch beside an active batch. It cannot demand arbitrary preemption or join an already-issued Vitest run. **read in source code** | 0.1.390; 011 C4/C15 and 013 V4 at checkout above |
| What caused the reported 27/44-file tiers and lack of yield? | **Not determined**, because the report supplies no actual grant, resolved run settings, batch ranks or recorded yield reason, and the small fixture did not reproduce it. **inferred** | Issue #146, fetched 2026-11-04; reported 0.1.390 |

## Reporter evidence

**inferred, from reporter evidence only; reported Squeal 0.1.390.** [Issue #146](https://github.com/hearsay-tools/squeal/issues/146) reports 218 selected unit files, 47 current passes after 1,252.5 s, and 171 pending. Its 27-file tier took 594.8 s against 587.3 summed file-seconds, about 0.99 effective workers; the 44-file tier measured about 0.97. The project reportedly resolves `maxWorkers` to 14 on 24 CPUs, with `runner.tierSize: 4` and file parallelism enabled. Reported load rose from 16.6 to 37.0. The cited CI comparison and original timing records were not independently replayed. The issue body is preserved in [issue.json](probes/issue-146/issue.json).

## Live findings

**verified by experiment; Squeal 0.1.390, Vitest 5.0.3, Node 24.22.1.** A separate Git fixture held 12 files in two unit projects. Each test imported one shared kit and waited 1,500 ms. Both projects inherited root `maxWorkers: 4`, `fileParallelism: true`, `pool: 'forks'`; isolation stayed at Vitest's default. Squeal used `runner.tierSize: 4`, `baseline.onStart: 'lookup-then-run-missing'`, coverage off. The control ran the same 12 explicit paths with `pnpm exec vitest run`. No original project daemon or configuration changed.

One-minute load immediately before the control, daemon start and comment edit was 15.13, 15.44 and 17.25 on 24 CPUs. All gates allowed the work. The final load was 17.07. Both daemon status waits returned exit 0 with all 12 files current, first at revision 0 and then revision 1. The fixture daemon stopped with exit 0.

| Run | Files | Run wall time | Summed file time | Effective workers | Peak test overlap |
| --- | ---: | ---: | ---: | ---: | ---: |
| Direct Vitest control | 12 | 4.958 s* | 18.026 s* | 3.64* | 4 |
| Daemon baseline, run `296acf26` | 12 | 5.386 s | 18.580 s | 3.45 | 4 |
| Comment edit, run `f29ae2a7` | 4 | 1.763 s | 6.172 s | 3.50 | 4 |
| Comment edit, run `28cf2827` | 4 | 1.795 s | 6.159 s | 3.43 | 4 |
| Comment edit, run `e74a6319` | 4 | 1.722 s | 6.122 s | 3.56 | 4 |

Daemon figures use the saved `report.json` run duration and whole-file durations, matching the issue's ratio. Baseline file times ranged from 1,538 to 1,601 ms; edit file times from 1,530 to 1,546 ms. *The control uses instrumented test-body start/end times, excluding setup and startup; it is a parallelism control, not an identical whole-file timing measure. Every file's timing and worker ID is preserved under [output/](probes/issue-146/output/). IDs 1–4 and overlapping intervals prove concurrency independently of the ratio. The comment edit ran three four-file tiers, so it did not recreate the incident's large affected tiers.

**verified by experiment; checkout 0.1.401, same Vitest and Node.** A second probe called the source adapter directly on this fixture after its daemon stopped. The same warm adapter took `workers: 1` and then `workers: 4`, with the project ceiling still four. Loads were 15.57 and 14.70 on 24 CPUs. Grant 1 completed all 12 files in 20.167 s, with 18.368 file-seconds, ratio 0.91, peak 1 and worker ID 1 only. Grant 4 completed all 12 in 5.110 s, with 18.282 file-seconds, ratio 3.58, peak 4 and IDs 1–4. Both reports ended `completed` with no failure. [grants-output.txt](probes/issue-146/grants-output.txt) preserves each file's duration. This deliberately supplied grant is not a measurement of the incident's pool grant.

## Source facts and named waits

**read in source code; Squeal 0.1.390 and Vitest 5.0.3.** The execution-width seam is:

1. `src/core/scheduler/tiers.ts:667` passes `tier.lease.grant` as `workers` for a leased tier. An unleased tier omits it.
2. `src/runners/vitest/adapter.ts:577` calls the sizing hint before running. `width.ts`, `Widths.apply`, writes root and explicit project `maxWorkers`, capped by their original ceilings. Ordinary isolated projects have floor 1; non-VM `isolate: false` projects have floor 2 unless their ceiling is 1.
3. `src/runners/vitest/run.ts:89` passes the specifications together to `runTestSpecifications`. Vitest's `resolveMaxWorkers` reads the project value, then root, then its CPU default. `groupSpecs` respects group order and separates isolated projects explicitly sized to one.

Thus a project ceiling of 14 does not establish an admitted tier's actual width. Neither does a tier's file count establish its worker count. The adapter's width code, `yields.ts`, `yield-sooner.ts` and `beside.ts` are unchanged between 0.1.390 and this checkout. Exact excerpts and the empty diff are in [source-evidence.txt](probes/issue-146/source-evidence.txt).

**read in source code; Squeal 0.1.390, consistent with 011 C4/C15 and their 011-263/268/269/283 amendments.** Named test-file waits order already eligible work. A running selected file joins its wait's batch for rank. A queued promoted file can cause a yield only under the remainder/overrun rule, when it outranks unfinished batch files and the cut starts it sooner. A tier containing a previously cut file and the backlog's guaranteed turn resist another yield. Same or earlier batch work is not cut for a later wait. Batch membership persists past a wait deadline. A source-path wait does not promote all its readers.

There is a separate route: while a named batch's tier runs, an edit or a later batch totaling at most 30 s of known queued duration can run in a second Vitest instance. Unknown durations do not qualify for the small-batch route. This can overtake completion of active work; it does not add specifications to that run. The fixture's waits came after file execution, so **live preemption and beside execution were not tested**. The incident's missing yield may match policy; its recorded rank and yield reason would decide that.

## Recommendation, limits and commands

**inferred from the experiments and source above.** Keep the issue open for bounded incident diagnosis. Capture the actual lease grant, resolved per-project width/isolation/pool/group order, admitted run identity and named-wait batch/yield reason before proposing a fix. This preserves the existing capacity, retry and slow-file holds. No execution or priority change is justified by this fixture alone.

The original 218-file workload, CPU-heavy tests, coverage-on behavior, original Vitest version and config, sustained high load, mixed project environments and pool contention remain untested. No full suite or build ran. The fixtures use timer waits, which reveal scheduling width without reproducing CPU pressure. The source-adapter test used 0.1.401; only the unchanged width path is evidence about 0.1.390. The installed 0.1.390 daemon is the reproduction's version control.

Exact launch commands were:

```sh
node docs/specifications/011-core/research/probes/issue-146/probe.mjs /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.390/dist/cli/squeal.mjs
pnpm exec tsx docs/specifications/011-core/research/probes/issue-146/grants.mts /home/agent/projects/squeal/.ai/cezar/t/cc467020/squeal-issue-146-7y3Alv
```

The first command's [output.txt](probes/issue-146/output.txt) records every child command, explicit test path, fixture root, load gate and outcome. The second command unexpectedly caused pnpm to restore the existing workspace dependencies automatically before executing; no install command was requested. Its output preserves that event. The repository daemon briefly reported missing dependencies during these probes; this is not evidence about the isolated fixture's passes. Research-file affected-status verification is recorded in the probe README.

Sources: [issue #146](https://github.com/hearsay-tools/squeal/issues/146); [0.1.390 width source](https://github.com/hearsay-tools/squeal/blob/5d93ab1720d4e457739168e8b59cf2ae113f22c1/src/runners/vitest/width.ts); the adjacent scheduler/adapter/run paths quoted in `source-evidence.txt`; installed `node_modules/vitest/dist/chunks/index.DpLw24bj.js` at 5.0.3 (SHA-256 in that evidence file); [011 spec](../spec.md) C4/C6/C15 and [status](../status.md); [013 spec](../../013-vitest-runner/spec.md) V3/V4 and [status](../../013-vitest-runner/status.md).
