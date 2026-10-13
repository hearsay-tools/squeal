# Wave 3.5 re-review (005-37)

## Verification output

Product candidate: `a69ba49d1b9596df0d5046b999f699e8f4a069ac` (0.1.151). Actual clean checkout: `53922de1d99f7a2e298aaa57741d9e5a9265b0bf`. `git diff a69ba49d..53922de1 --name-only` lists only `docs/board.md` and this spec's `status.md`. The HEAD mismatch is N1; no product mismatch. Review range is the 005-34, 005-35 and 005-36 commits from `0cbf6429` through `6a5bf2e3`, plus their `a69ba49d` build. 001 and 006 changes are excluded.

The prior findings file is `reviews/wave-3.md`; scope is B1 to B4, S1 and their nearest variants, as `tasks/wave-3.md` 005-37 requests. The 2026-10-13 wave 3.5 amendment is the current contract. No source changes or model session. Reviewer-owned probes invoke no real Claude/Codex CLI. The repository suite includes its isolated real Codex plugin/trust integration; the parent explicitly authorized that suite unchanged after the first attempt was interrupted. Standalone probes use synthetic stores, a real checkpoint tracker, a socket stand-in and executable harness stubs. Their homes and roots are inside this worktree's ignored `node_modules/.review-00537/` directory. `/proc/self/fd/<fd>/daemon.sock` aliases that directory to fit the Unix socket path limit.

All routine commands below exited 0 on clean `53922de1`. The exact build SHA's verification is **unverified** under the reviewer provenance rule; the product-identical checkout's results are verified. The full suite is the independent reviewer run, not Squeal's checkpoint.

```text
$ npm ci
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 2s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
exit 0
```

```text
$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.151 lint
> biome check .

Checked 984 files in 1427ms. No fixes applied.
exit 0
```

```text
$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.151 typecheck
> tsc --noEmit

exit 0
```

```text
$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.151 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.151 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

exit 0
```

```text
$ git status --short
(empty after build, before the review file)

$ node --disable-warning=ExperimentalWarning --import tsx node_modules/.review-00537/probes.ts
B1 header: Revision 1: 2 current (1 test, 1 test file loaded), 0 pending, 0 stale, 0 unknown. Inherited: 2 of 2 current (1 test, 1 test file loaded). The daemon has not listed this worktree's test files yet; these counts are not complete. Full-suite checkpoint: none completed at any revision (the counts are for revision 1; `squeal run --all` requests one).
Inherited from other worktrees: 2 current results (1 test, 1 test file loaded)
  2 (1 test, 1 test file loaded) from other at abcdef1
B1 title: SQUEAL · 2 checks changed (1 test, 1 test file loaded) at revision 1
B1 grouped: PASS  48 checks recovered (FAIL -> PASS): 36 tests, 12 test files loaded
      and 2 more test files (6 tests, 2 test files loaded)
B1 overflow chars=9683 Not shown: 893 more changed checks (893 FAIL: 669 tests, 224 test files that did not load). `squeal status` lists every known failure.
B2 forced=false, queued=1, enqueue calls=1
B2 forced=true, queued=0, enqueue calls=0
B2 already, enqueue calls=0
B2 slow, enqueue calls=0
B2 cap, enqueue calls=0
B2 cap-after-exclusions, enqueue calls=8
S1 skill parity (Codex CLI note removed), 4877/5205 chars; examples split
B3 explicit decline exit=0; neither harness config written; independently approved gate reworded
B3 mixed harness none/named choices rejected in both orders
B4 join exit=0: Checkpoint request completed at revision 1: no known failures; 1 test file, 0 already current, 1 run by the baseline checkpoint owner it joined
B4 collision exit=0: Checkpoint request completed at revision 1: no known failures; 1 test file, 1 already current, 0 run now
B4 older exit=0: Checkpoint request completed at revision 1: no known failures; 1 test file, 0 already current, 1 run now
All bounded standalone probes passed; no real harness or model invoked.
exit 0
```

```text
$ npx vitest run --maxWorkers=4
INTERRUPTED by the reviewer, exit 143; started at clean 53922de1.
No completed full-suite verdict. Two unchanged stop-slow timing cases had failed.
The parent authorized one replacement capped full run, unchanged.
```

The first findings commit, `9492a24a`, was inside the brief's first 15 minutes. The reviewer interrupted the first capped attempt on discovering `test/cli/codex-trust.test.ts:307` probes real Codex and its gated integration runs plugin/trust commands with scratch HOME/CODEX_HOME. The parent clarified that the brief's restriction covers reviewer-owned probes, not the repository suite, and explicitly authorized one replacement capped run unchanged (reply `5e4f9617-911c-447e-9d01-a55fdc7e61e4`). This will be extended with its result. The first attempt is unverified, not a failed full-suite verdict. Before interruption it reported two timing failures in unchanged `test/harness/stop-slow.test.ts` (693 ms and 3,900 ms test durations); load sampled 73 to 77. Attribution to this wave is unverified. The probe's initial scratch-script failures (CJS top-level await and a stand-in handling ping as a run-all request) were fixture errors, corrected before the successful output above; they are not product findings.

## Verdict

**PASS** on the bounded re-review: 0 blocking findings. B1, B2's false re-run promise, B3, B4 and S1's original scenarios are repaired. One proven nonblocking wording note (S2), and one proven nonblocking provenance note (N1). The authorized replacement independent full suite passed, with 465 files and 3,915 tests; one file and ten tests skipped.

## Blockers

None.

## Rechecked findings

### B1: repaired, proven by the original mixed inherited-count probe

`src/core/state/header.ts:68` now carries `inheritedFileLevelCount`; `src/core/status/snapshot.ts:175` carries per-source `fileLevelCount`. `headerLines`, `readStatus`/`formatStatus`, and `formatDelta` print one test and one file-level check apart for the two inherited results. All reads remain store-derived at the live revision; the formatter does not infer file checks from paths.

The nearest variants also split: baseline titles, collapsed recovery and retirement heads, grouped per-file and extra-file counts, UNKNOWN heads and transition counts, and overflow outcome counts. The standalone mixed-overflow probe rendered 1,000 failure entries in 9,683 characters, with the split overflow and complete status/why pointers. `test/delivery/split-counts.test.ts` additionally covers mixed outcomes and registration overflow. No fresh unsplit count was found in the changed formatting paths. Zero/absent legacy parts retain the prior compatibility behavior.

### B2: original false promise repaired, proven by paired forced/ordinary probes

`plugins/claude-code/skills/squeal/SKILL.md:13` and the Codex copy now exclude forced runs, warm-up, re-runs, an already re-run key, and slow files. The same real `queueReruns` call queues an ordinary fresh failure once and a forced one zero times. Already-re-run and slow cases queue zero; nine eligible failures queue zero. Scheduler policy is unchanged.

The text now identifies a failure the scheduler does not re-run, so the original instruction to wait for a nonexistent forced-run follow-up is repaired. S2 below records the remaining cap qualifier, as a nonblocking nearest variant.

### B3: repaired, proven by the real setup command with both stub CLIs present

`src/cli/setup/command.ts:108` distinguishes omitted harness answers (`null`) from explicit `--harness none` (`[]`). Both setup skills map declining every harness to that flag. Apply with `--yes --harness none --no-warmup --block none --slow none --no-trust` and an independently accepted gate rewording exits 0, writes neither harness's project/user configuration, and rewords the gate. Combining `none` with a named harness in either order exits 2 before apply. The unanswered-default behavior remains available.

### B4: repaired, proven by the original fixed-millisecond tracker/socket probe

`src/core/scheduler/checkpoint-requests.ts:43` selects the explicit `owner` where the join decision is made; `FullSuiteCheckpoint` carries it through scheduler, daemon and front desk. `src/core/daemon/handlers.ts:93` returns it beside the unchanged persisted record in both run-all responses. `src/cli/run.ts:280` consumes that owner and no longer searches equal completion timestamps.

At clock 1234, a real completed-before-read join reports 0 reused and 1 run by its baseline owner; an independent empty request whose neighbor ends at the same millisecond reports 1 reused and 0 run now. Both exit 0. An older daemon response without `owner` reports no invented join. The front-desk protocol and scheduler join tests cover the intervening boundary; the CLI's verdict/error handling is unchanged. No additional protocol field is needed.

### S1: repaired by the formatter-aligned examples

The skill and references show current/pending and passed/running/queued counts with their test/file parts, including inherited counts. The collapsed-head example was updated in `d87cd7fa` to the 005-34 output. Setup skill copies and Squeal reference copies are identical; Squeal skill bodies match after the existing Codex-only CLI-resolution note is removed. The Claude Squeal body is 4,877 characters; setup is below its 5,000-character test budget. The Codex body is 5,205 including its existing note (already 5,022 before this range), not a newly introduced budget-policy finding. No harness discovery or model-compliance claim is made.

## Should-fix

### S2. Proven, nonblocking nearest variant: the cap sentence does not say eligible files

**Location:** both `plugins/*/skills/squeal/SKILL.md`, Claude line 13 and Codex line 15; `test/harness/skill.test.ts:150` pins the sentence.

005-35's brief says "at most eight eligible test files in one tier". The skill says "nor any when more than eight test files fail anew in one tier", without the eligibility qualifier. The scheduler filters forced, already-re-run and slow failures before counting the cap (`src/core/scheduler/rerun.ts:72`). The discriminating probe passes nine new failures, eight ordinary and one forced, to that real function: eight re-runs are queued, even though nine files failed anew. The original forced-run false promise is fixed; this inverse cap wording is a follow-up note under the bounded re-review rule, not a reopened blocker.

**Worker-sized fix:** say "more than eight otherwise eligible test files fail anew in one tier", or name the exclusions before counting. Update both copies and their text assertion; add the eight eligible plus one excluded case to the scheduler/text contract check. Keep scheduler policy unchanged. No model experiment required.

## Nits and scope notes

### N1. Proven, nonblocking: checkout HEAD differs from the product build candidate

`git rev-parse HEAD` was `53922de1`, not `a69ba49d`. The two changed files are board/status documentation, with no source or bundle difference. This records verification provenance; do not repair board/status or include unrelated 001/006 work.

## What fits

- The original B1 inherited subset/source and delivery-title proof now names tests and file checks apart. Grouping and overflow retain exact identities and the total.
- Ordinary versus forced/already-re-run/slow failure probes agree with the exclusions in the revised skill. The eligible-file cap policy stays at eight.
- Setup's declined-all answer crosses the skill/CLI seam as an explicit empty list, while separately approved choices still apply.
- Checkpoint provenance comes from the actual scheduler join, crosses the front desk beside the record, and survives completion before the CLI's read. Equal timestamps alone cannot create a join.
- Rebuilding 0.1.151 caused no tracked bundle drift; the key-format-9 re-pin is present. No new dependency or source edit was made by this review.

## Inputs for the next wave

1. No B1 to B4 repair wave is required by this bounded verdict. S2 is a small text/test follow-up if the coordinator accepts it.
2. Preserve `queueReruns(context, ledger, failures)`'s order: filter forced/already-re-run/slow, then apply the cap to the remaining eligible files. The skill must describe that order.
3. Keep `FullSuiteCheckpoint.owner` on the scheduler-to-front-desk result and `RunAllResponse.owner` beside, not inside, the persisted checkpoint. Own ID means independent work; another ID means a real join; absence means an older daemon whose owner cannot be inferred. No timestamp fallback.
4. Keep harness unanswered (`null`) distinct from declined-all (`[]`), apply explicit answers, and retain `--no-warmup` when the skill handles warm-up separately.
5. Keep the 10,000-character delivery cap and whole status/why pointers. Both Squeal references stay in parity; the Codex-only CLI note remains deliberate.
6. The proof wave owns real harness/model sessions. This review ran none. The parent-authorized replacement capped full suite is recorded below and passed. The first capped attempt was interrupted; its partial failures do not constitute a completed full-suite failure verdict.

## Final independent full-suite verification

The parent-authorized replacement started and ended on clean review-only commit `965d92247fdff876278525fcd246c11364925766`. Source, tests, bundles and package metadata are identical to `a69ba49d`; `git diff --quiet a69ba49d -- src test plugins package.json package-lock.json` exits 0. This is verified for `965d9224`, and **unverified for the exact candidate SHA** under the reviewer's provenance rule. No source changed during the run. The suite ran unchanged, including its own isolated Codex integration as the parent permitted; reviewer-owned probes used only stubs.

```text
$ npx vitest run --maxWorkers=4
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/1715a73b-c398-4d72-b32b-8198f23a7da5

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/1715a73b-c398-4d72-b32b-8198f23a7da5/test/fixtures/scheduler/.tmp/acb954ee-c92b-401c-8d4e-0ae0330ae5a9/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3747403
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/1715a73b-c398-4d72-b32b-8198f23a7da5/test/fixtures/scheduler/.tmp/5bf42a3c-9498-4872-adda-7638da0ae374/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  465 passed | 1 skipped (466)
      Tests  3915 passed | 10 skipped (3925)
   Start at  20:52:12
   Duration  729.70s (tests 96%, import 2%, transform 1%)

    Isolate  466 workers spawned · ~229ms startup each (spawn + environment, per file)
             at least ~26.49s faster with isolate: false — reuses workers across files instead of one per file

exit 0

$ git rev-parse HEAD
965d92247fdff876278525fcd246c11364925766

$ git status --short
(empty after suite, before this final report extension)

$ git diff --quiet a69ba49d -- src test plugins package.json package-lock.json
exit 0
```

The replacement's 465 passing files include the count/inheritance, setup, skill, checkpoint tracker and front-desk regression tests. The first attempt's two Stop timing cases passed in this completed run. Npm's existing `store-dir` warning, experimental runner typecheck warnings, fixture gitdir repairs and cleanup of one earlier process are preserved above; none prevented the exit-0 verdict. Load sampled 106 early in the replacement, then 63, 51 and 34; duration was 729.70 seconds. No additional full run was made.

Final bounded verdict remains **PASS**, 0 blockers, S2 a proven nonblocking wording follow-up, N1 a proven nonblocking provenance note. The reviewer changed and committed only this findings file.
