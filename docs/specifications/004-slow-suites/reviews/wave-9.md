PASS 69022c15954f0f9ac33404b66db4479f9b597057

# Wave 9 review: setup declarations and owed preconditions

Zero blockers, zero should-fix findings, zero nits. Reviewed rows 004-68 and 004-69 against spec 004 D7/D8 as amended, spec 001 D7 and task 001-219. Range: `origin/main` at `7c555eb33e1ef460a950e4efb02231fbc045d3e9` (0.1.214) through the pinned `cand/0.1.215` commit above. `git rev-parse HEAD` matched the pin and the product tree stayed clean throughout verification. Only this review is committed.

## Verification

Node 24.21.0. No `npm run build`, as directed. The independent suite uses the shared full-run lock and four workers. Squeal's background results are not substituted for this gate.

```text
$ npm ci
added 196 packages, and audited 197 packages in 6s
32 packages are looking for funding
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.215 lint
> biome check .
Checked 1449 files in 441ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.215 typecheck
> tsc --noEmit

$ npm run check:version -- origin/main
> squeal@0.1.215 check:version
> node --experimental-strip-types --disable-warning=ExperimentalWarning scripts/check-version-bump.ts origin/main
version bump: 0.1.214 -> 0.1.215, ok
```

`npm ci` also printed npm's advisory that six dependencies have install scripts not covered by `allowScripts`; installation completed successfully.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/ad023a89-14f9-4cb9-b9dc-075105b02538

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ad023a89-14f9-4cb9-b9dc-075105b02538/test/fixtures/scheduler/.tmp/7317a170-bfbd-4f9c-abed-9a1cfd216fff/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/ad023a89-14f9-4cb9-b9dc-075105b02538/test/fixtures/scheduler/.tmp/869a0315-e23d-4f53-bc20-4cf46fedcdfb/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 393091
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  724 passed | 1 skipped (725)
      Tests  6129 passed | 9 skipped (6138)
   Start at  13:08:59
   Duration  817.17s (tests 98%, import 2%)

    Isolate  725 workers spawned · ~126ms startup each (spawn + environment, per file)
             at least ~22.63s faster with isolate: false — reuses workers across files instead of one per file
```

Background Squeal separately reported two recorder-fidelity failures at revision 0: `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, each expecting a pass without observation and receiving a fail. `why` for each exact check confirms the same failure in prior parent/worker runs (including `ca08437` before this candidate). Neither test nor the recorder implementation changes in this range. These background observations are recorded, not hidden or retried, and are not the independent gate above.

The focused gate ran the three touched test files from byte-for-byte copies under `/tmp/004-wave9-review`, with the candidate's installed dependencies:

```text
$ npx vitest run --root /tmp/004-wave9-review \
  --config /tmp/004-wave9-review/vitest.config.mts --maxWorkers=1 \
  test/cli/setup/preconditions.test.ts test/scheduler/checkpoint-resume.test.ts \
  test/slow/precondition-owed.test.ts
Test Files  3 passed (3)
     Tests  11 passed (11)
  Duration  18.16s
```

Every focused test, probe and control used scratch HOME and XDG config/cache/data directories under `/tmp/004-wave9-review`, with explicit git author/committer identity. Fixture repositories and latch markers also lived under `/tmp`; none used the real HOME. Probe code and controls are not committed.

```text
$ npx vitest run --root /tmp/004-wave9-review \
  --config /tmp/004-wave9-review/vitest.config.mts --maxWorkers=1 review.test.ts
Test Files  1 passed (1)
     Tests  4 passed (4)
  Duration  16.12s

# Additional independent pending-command observation:
$ npx vitest run --root /tmp/004-wave9-review \
  --config /tmp/004-wave9-review/vitest.config.mts --maxWorkers=1 review.test.ts -t no-rollback
Test Files  1 passed (1)
     Tests  1 passed | 4 skipped (5)
  Duration  2.71s
```

## Blockers

None.

## Should-fix findings

None.

## Nits

None.

## What fits

### 004-69: baseline certification [proven]

The no-rollback sequence from wave-8.1 and its R2 variant pass. Start with both slow files validated; remove the prerequisite at a new revision while retaining the files' keyed results; leave a forced checkpoint owed at shutdown. On the successor, a command exiting 1, or the R2 missing-file rule after a rolled-back skip, abandons the owed request and the baseline. No baseline completes at that revision and the slow tier reads two not-run files with the skip reason. The met-command control runs both slow files and completes both records normally.

Both discriminating tests were rerun with only `bootstrap.ts` and `checkpoint-requests.ts` restored from the 0.1.214 base in an isolated source copy. They fail at `fullSuite.atCurrentRevision`, receiving `true` rather than `false` (2 failed, 1 skipped, 7.50s). This isolates the candidate's repair, with the prior transaction/rollback repair held constant.

The additional public-scheduler probe closes the first scheduler before releasing its waiting command, then holds the successor's command too. While that command is unresolved, the owed record remains open and `fullSuite` is `{"atCurrentRevision":false,"lastCompletedRevision":0}` at revision 1. After exit 1 it remains false; the owed record is abandoned, zero slow files ran on the successor, and the slow tier is `{current:0,pending:0,notRun:2,skipped:"... exited 1 (slow.precondition.command)"}`. This checks the waiting interval as well as the terminal skip.

Taking the owed state before starting the baseline closes the empty-baseline completion window. Adding its strict files keeps that baseline open until `resumeOwed` joins the request and queues the forced work. Existing `checkpoints.failed` handling then prevents completion on a skip. Unkeyed files and persisted skipped hits retain their earlier failure paths; no change to the classifier or skip publication is needed.

### Forced fast files and provenance [proven]

Applying the same wait to fast owed forced files is consistent with the outstanding explicit request. It adds no run beyond that debt. The focused restart test and independent fast-only probe both leave one of five files unrun at shutdown and run exactly that file once on the successor. With `run-misses`, its run carries the new baseline id, whose record names that remaining file; the owed record ends with it. The active baseline becomes strict when the owed request is resumed, before the pump can run, so a lookup cannot satisfy the forced obligation.

This attribution change is coherent with the existing joined-baseline path in task 001-219 and spec 001 D7's request/run distinction. A result still names the actual owning checkpoint, and the original explicit request remains open until that owner finishes. The changed test expectation is justified by the baseline now containing the owed files rather than completing empty first.

### Lookup-only and ordinary restarts [proven]

The fast-only probe repeated with `baseline.onStart: "lookup-only"` still performs the owed explicit work, carrying the original run-all id and completing its record. The baseline is abandoned rather than launching autonomous work. An ordinary restart with all keys cached and no owed request executes zero files under either `run-misses` or `lookup-only`, and retains a current full-suite result. Existing nonforced owed/miss coverage also passes. The behavioral change is confined to the baseline's treatment of forced debt; lookup-only scheduling and ordinary reuse remain intact.

### 004-68: visible declarations, unchanged outdated logic [proven]

The shipped Claude Code CLI was exercised in a scratch repository for `setup --plan`, `setup --check`, and each with `--json`. All four name the global command and a slow node:test project's override with exact argv and explicit timeouts. A filename containing spaces, shell punctuation and a literal command substitution remains one quoted argument in plain output and one array element in JSON. These nonexistent commands are listed without execution. The touched tests also pin the 10000 ms default.

The probe compares `outdated` before and after adding the command declarations to the same project configuration: unchanged, with all four exit codes 0 in the fully configured fixture. Exists-only and absent declarations yield an empty JSON list and no plain command section in both modes. Source inspection confirms the new facts are attached after `outdated` is computed and never enter its tests. Per-project declarations remain visible beside the global declaration, even when the project overrides it, as required by the brief.

## Inputs for the next wave

No fix wave required. Retain baseline membership before `start` can settle an empty checkpoint, and resume strict ownership before launching any tiers. Consumers inspecting resumed forced runs should follow the new baseline id when the startup policy runs misses, and the owed id under lookup-only. The prior review's queue-restoration and setup-buffer limitations are outside this delta and are not reopened here.
