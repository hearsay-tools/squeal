# Wave 13 review: continuous slow lane, evidence ranking, build-output excludes

FAIL `14a31e2cc1251f16fae6da7fc26f27e11a2ea15a` (0.1.221).

Counts: 1 proven blocker, 1 proven nonblocking should-fix, 0 nits. Range: `58483b88..14a31e2c`; rows 004-80, 004-82 and 005-70. The blocker is setup coverage loss, not slow scheduling.

## Verification

Verification ran at the exact candidate with a clean tracked and untracked tree. `npm ci` preceded lint, typecheck, build and the independent suite. The build produced no committed-bundle drift. The review file was written after the independent run. The installed 0.1.199 Squeal daemon's background results are not substituted for this run.

```text
$ git rev-parse HEAD
14a31e2cc1251f16fae6da7fc26f27e11a2ea15a
$ git status --short
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
(exit 0; npm also printed node-domexception's deprecation and the six not-yet-covered install-scripts notices)

$ npm run lint
> squeal@0.1.221 lint
> biome check .
Checked 1452 files in 586ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.221 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.221 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.221 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
(exit 0)
$ git status --short
(no output)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/89f3063a-a25f-43fe-8051-860903509d45

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/89f3063a-a25f-43fe-8051-860903509d45/test/fixtures/scheduler/.tmp/6882a54d-9657-4a2f-b4d1-a46652b61dea/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/89f3063a-a25f-43fe-8051-860903509d45/test/fixtures/scheduler/.tmp/37ae8326-4016-4239-b510-9134c9daa5f6/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 2720658
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  728 passed | 1 skipped (729)
      Tests  6248 passed | 8 skipped (6256)
   Start at  09:51:48
   Duration  757.99s (tests 98%, import 2%)

    Isolate  729 workers spawned · ~112ms startup each (spawn + environment, per file)
             at least ~20.24s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)
```

The completed independent run took 757.99 s. Its context log records the same candidate SHA and an empty `git status --short` before and after. Sampled one-minute host loads were 4.78 to 14.71 on 24 CPUs. No file failed this independent run, so no isolated rerun was needed. Fixture repair/typecheck notices and the earlier-run process cleanup above did not fail the run.

An earlier attempt was terminated by the cockpit restart after about 11 minutes, without a verdict. It is **unverified**, not a finding against the candidate; the detached replacement above is the one completed full proof. No source, dependency or lockfile changed between attempts.

Separately, the installed 0.1.199 background daemon reported `test/runners/node-test/run-reads-fidelity.test.ts` and `test/runners/vitest/observe-fidelity.test.ts` failing, as the worker notes already document; both pass in the independent run above. It also reported `test/scheduler/timed-out-tier.test.ts` failing at a sampled 1.41 load per CPU, then recovering on its automatic same-input retry. Those are background-run observations, not failures of this independent gate and not new wave blockers.

Two small source probes ran through `node --import tsx` outside the checkout against the candidate's exported interfaces. They created and removed throwaway fixture repositories only. Their discriminating inputs and output follow under B1 and S1; no candidate source or test was edited.

## Blockers

### B1, proven: the default exclude removes source tests outside the build-output evidence

Location: `src/cli/setup/candidates.ts:69`, `:83`; consumed by `src/cli/setup/questions.ts:123` and `src/cli/setup/exclude.ts:49`.

Contract: 005 D3 says “a suite that is only slow, or that prepares itself from the sources, stays a slow candidate keyed like any file.” The review brief explicitly requires that the default-yes exclude cannot drop source tests. Worker notes decision 1 restricts build-output evidence to prevent silent coverage loss; that restriction must also hold for the files selected by the resulting glob.

`buildOutputCandidates` aggregates evidence from any test in one immediate directory. If one qualifies, `slowCandidates` proposes `<dir>/**` for the entire subtree. It neither checks all files selected by that recursive glob nor keeps the identity of the files supplying evidence. This excludes source-only siblings and source-only descendant groups. The latter can even have been answered “slow” during the same setup.

Reproduction, using `squealShaped`, `buildPlan` and `main` from the existing setup fixtures and product:

1. Start with `squealShaped({ "squeal.config.json": json({}) })`. Its existing `test/e2e/plugin-copy.test.ts` names the tracked, gitignored `plugins/codex/dist/cli/squeal.mjs`.
2. Add `src/math.ts` exporting `sum`, `test/e2e/source.test.ts` importing only `../../src/math.ts` and Vitest, and `test/e2e/nested/source.test.ts` importing only `../../../src/math.ts` and Vitest. Both source tests assert `sum(1, 2) === 3` and name no output.
3. Run `main(["setup", "--yes", "--harness", "none", "--block", "none", "--no-warmup"], io)` with the fixture's isolated environment.

Observed:

```text
BEFORE:
  test/e2e/nested: source.test.ts; exclude null; buildOutputs []
  test/e2e: plugin-copy.test.ts, shipped-plugin.test.ts, source.test.ts
    exclude test/e2e/** -> vitest.exclude
    plugins/codex/dist: gitignored, named by 1 of 3 test files
SETUP_EXIT 0; STDERR empty
CONFIG:
{
  "slow": { "include": ["test/e2e/nested/**"] },
  "vitest": { "exclude": ["test/e2e/**"] }
}
AFTER: buildPlan(...).slow.groups === []
```

Both valid source tests disappear from Squeal's listing and validation, including the nested test setup just selected as slow. A root-level `*.e2e.*` group uses the same recursive construction, so the blast radius can be the whole repository. The current proposal regression explicitly accepts evidence from “1 of 2 test files”; it does not discriminate a source-only sibling or descendant.

Worker-sized fix: preserve evidence by test file and constrain default exclusions to evidenced tests. If a directory-wide glob would include any unevidenced source tests, offer exact evidenced paths or an equivalently bounded selection, keeping the others as slow candidates. Check the glob's complete runner-specific selection, including descendants, rather than only the group's immediate files. Keep the existing no-to-exclusion path and the manifest-only negative control. Add terminal-default and `--yes` regressions for both sibling and nested source tests; verify they remain listed, keyed and runnable after setup. Do not infer that an entire subtree tests a bundle because one file names it.

## Should-fix

### S1, proven, nonblocking: changed-file iteration order loses evidence from a changed file's direct imports

Location: `src/core/slow/rank.ts:125` and `:132`.

Contract: 004 D2 takes tokens “from each file the revision changed and its local imports”. The read-once optimization also skips import inspection: when an earlier changed file imports a later changed file, `take(later)` returns null on its own loop iteration. Its direct imports are never inspected. This is ordering only; every queued slow file still runs, and it does not defeat the row's E1/E5/build-script/full-coverage done-when, so it is not blocking.

Pure `SlowRanker` probe, with a memory `RankSource` and fresh ranker for each ordering:

```text
src/a.ts: import "./b";
src/b.ts: import "./c";
src/c.ts: const markup = 'data-slot="panel-body"';
test/slow.test.ts: const selector = '[data-slot="panel-body"]';

changed ["src/a.ts", "src/b.ts"] -> evidence []
changed ["src/b.ts", "src/a.ts"] -> evidence [["test/slow.test.ts", ["panel-body"]]]
```

`c` is a direct import of changed `b` in both cases, not a request for recursive expansion of every dependency. Worker-sized fix: memoize read text separately from whether its tokens have been offered; inspect the direct imports of every changed path once even if its text was previously read as an import. Add a permutation regression that produces the same evidence and keeps one source read per path.

## Nits

None.

## What fits

- **004 D2/D7, continuous trigger and policy join:** the merged `SlowPolicy`, defaults and loader retain `rank: "tokens"`, `trigger: "continuous"` and `quietMs: 3000` together. `policyTriggered` reads the latest revision's `createdAt`; `#fastFirst` still checks edit work, runner refinement, queued fast files and fast tiers in flight. Explicit requests retain their separate eligibility.
- **Wake-ups and idle:** the scheduler's existing fast-tier completion wakes its pump; `SlowTier.#candidates` arms a timer for the remaining quiet interval. A later revision is rechecked when that timer fires, and an earlier deadline replaces a later one. Selection rechecks the trigger after the guard and slot. Fast work returns before arming a quiet timer, so it does not poll at an expired quiet deadline. Idle retains `consumersIdle` and its bounded recheck. Existing idle scenarios explicitly pin `trigger: "idle"`; the continuous test exercises a real mid-turn slow run and next-tool-boundary failure delivery within the 15 s recheck interval.
- **004 D8/D9, honest delivery and waits:** continuous quiet waiting publishes no false “waiting for the agent to pause” activity. Header/status, named-file reason and primer read the trigger consistently. Not-run files retain the “not queued” distinction. Path waits keep queued slow files under continuous and leave pause-only files out under idle. The plain wait still excludes slow work as the last status amendment requires; its quiet clause says continuous pending files run after the fast tests. Stop requirements remain policy-controlled.
- **004 D2, ranking:** evidence is a comparator within the existing group/promotion/priority order; it does not select, drop or defer queue entries. Duration mode bypasses it. E1, E5 and the no-token build-script replay exercise product extraction, and the scheduler regression verifies all invalidated files run. Own/helper records are checked against current hashes, and helper changes rebuild their token content. `why` accepts evidence only at the current file key. S1 is the remaining changed-side hole.
- **Store and integration:** `slowEvidence` is registered in `WORKTREE_META_ROWS` with the rank-store owner; `slowTokensMetaKey` is explicitly shared in the meta-row test. The coordinator's d6d2099f joins the policy blocks, keeps `KEY_FORMAT_VERSION` at 13, and pins the combined guarded-source hash to `d23d232ffedaa9a4db5180b364e8e93ccd82c19787c3faec1f88613711246306`. The rebuilt committed bundles match the candidate.
- **005 D3, bounded parts of setup:** manifest-only source paths do not qualify, the question prints evidence and says Squeal never builds, default yes and explicit flags write runner excludes, node:test paths are relative to project cwd, and no keeps the group a slow candidate. The unsafe width of those exclusions is B1. Pytest detection remains absent from the pre-existing slow-candidate universe; the new type does not falsely claim a pytest target was implemented.
- **Measurement amendments:** the last 004 status line records 3000 ms, plain-wait scope, string-literal matches, queued evidence accumulation and the >100-path bound. The worker notes separate live eval-fixture measurements from stored cezarion browser measurements and state that browser specs were not rerun. No fresh browser benchmark was claimed by this review.

## Inputs for the repair and next wave

1. Dispatch one 005-70 repair owning `src/cli/setup/**` and its setup tests for B1. Build file-level evidence before constructing exclude targets; check the full selected set before asking a default-yes question; apply the same bounded selection via plain setup, `--yes` and the setup skill's answer flags. Preserve source-only groups and the user-chosen no path. Existing runner excludes, node:test cwd semantics and idempotence remain the contracts.
2. S1 can be a separate small 004-82 fix in `src/core/slow/rank.ts` and its rank tests. It must not alter invalidation or scheduling eligibility. Keep the 100-changed-path/1 MiB read limits, common-token threshold of 20 and duration fallback.
3. Preserve the continuous scheduler seam: fast completion and quiet expiry pump; selection checks pending fast work and the latest revision again; the load guard, permits, finish-and-discard and bounded idle recheck stay intact. No new public scheduler interface is needed for either finding.
4. Rebuild committed bundles after product repairs and re-pin guarded sources according to the candidate's unreleased-version rule. This review does not authorize a release or landing. Re-review B1 against the repaired candidate and inspect its delta; S1 stays a nonblocking note unless that delta changes its impact.
