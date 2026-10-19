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

## Re-review

PASS `160e6874b0c022011dbe16f879abbe648b1e1fa0` (0.1.221).

Counts: 0 remaining blockers, 1 proven new nonblocking should-fix note, 0 nits. B1's original reproduction and S1 are resolved. This is the requested narrow re-review of `14a31e2c..160e6874`: the setup repair, ranking repair, version-13 re-pin and rebuilt bundles. The first-round conclusions about unchanged code stand. New delta findings are notes under the re-review rule.

### Verification

The exact candidate was checked on a clean tree. `npm ci` ran first; the build left no tracked or untracked changes. The independent suite, rather than the installed 0.1.199 Squeal daemon's results, supplies this review's full-run evidence. No product source or test was edited. The review file was restored from `origin/main` and extended only after verification.

```text
$ git rev-parse HEAD
160e6874b0c022011dbe16f879abbe648b1e1fa0
$ git status --short
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
(exit 0; node-domexception deprecation and six install-scripts notices)
$ npm run lint
> squeal@0.1.221 lint
> biome check .
Checked 1454 files in 441ms. No fixes applied.
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
(no output; all four committed CLI bundles match the build)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/906767af-ca52-4672-9a67-2cf70c27552c

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/906767af-ca52-4672-9a67-2cf70c27552c/test/fixtures/scheduler/.tmp/d7978dac-3149-4d16-82e8-acf0e83fefc3/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/906767af-ca52-4672-9a67-2cf70c27552c/test/fixtures/scheduler/.tmp/858b2d9a-13ad-4481-8d6b-e683468440a7/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3962045
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  730 passed | 1 skipped (731)
      Tests  6255 passed | 10 skipped (6265)
   Start at  10:42:18
   Duration  943.10s (tests 97%, import 2%, transform 1%)

    Isolate  731 workers spawned · ~149ms startup each (spawn + environment, per file)
             at least ~27.12s faster with isolate: false — reuses workers across files instead of one per file
(exit 0)
$ git rev-parse HEAD
160e6874b0c022011dbe16f879abbe648b1e1fa0
$ git status --short
(no output)
```

The independent run took 943.10 s. Sampled one-minute host loads during it ranged from 10.05 to 38.18 on 24 CPUs. No file failed the independent run, so no isolated rerun was necessary. In particular, `test/harness/pi/latency.test.ts` passed this run; this does not establish an improvement to its previously reported calm-load 80 ms timing margin. Fixture-repair, process-cleanup and experimental-typechecking notices above did not fail the run.

Separately, the installed 0.1.199 background Squeal baseline reported `test/runners/node-test/run-reads-fidelity.test.ts` and `test/runners/vitest/observe-fidelity.test.ts` failing at revision 0, with the same signatures the first review and worker notes record. Both pass in the independent run above. Those background observations remain distinct from this review's gate.

A throwaway source probe outside the checkout used the existing setup fixture builders, `main`, `setupCommand`, `buildPlan`, `readRepoFacts` and `SlowRanker`. It created and removed only scratch repositories. Its assertion-backed results follow. The first probe attempt used a gate-answer sequence for the wrong fixture shape and stopped on an assertion; the corrected probe presses Enter for every terminal default and completed successfully. No candidate file changed between attempts.

### Previously blocking B1: resolved for the recorded reproduction

`src/cli/setup/build-outputs.ts` now retains `namedBy`; `candidates.ts:68` gathers the evidenced file set before forming proposals. `excludeProposal` checks the complete Vitest/node:test universe, including descendants and files outside the immediate candidate group, before proposing a directory glob. A mixed group uses its evidenced file paths and carries its unevidenced files in `kept`. `questions.ts` asks the remaining slow question after accepting a partial exclusion; `exclude.ts` routes only the selected proposal's targets, joining node:test cwd back to worktree-relative form for comparison.

The first-round fixture was replayed with the same `src/math.ts`, source-only sibling and source-only descendant:

```text
setup --yes:
  vitest.exclude: ["test/e2e/plugin-copy.test.ts"]
  slow.include: ["test/e2e/nested/**", "test/e2e/**"]
terminal defaults:
  identical selection
--exclude test/e2e/plugin-copy.test.ts --slow test/e2e --slow test/e2e/nested:
  identical selection (slow globs in flag order)
after every mode:
  test/e2e/source.test.ts: listed, declared slow
  test/e2e/nested/source.test.ts: listed, declared slow
  test/e2e/plugin-copy.test.ts: not listed
```

Positive control: when both immediate tests and a descendant name the committed bundle, proposals are `test/e2e/**` and `test/e2e/nested/**`. The new `exclude-bounded.test.ts` also checks the `*.e2e.*` case whose directory contains unrelated tests. The original no-to-exclusion and manifest-only negative controls remain.

A second fixture used cezarion's package cwd `packages/cezar`, two evidenced files and an unevidenced `test/e2e/source.test.ts`. Terminal defaults, `--yes` and explicit `--exclude`/`--slow` flags all produced:

```text
vitest.exclude:
  packages/cezar/test/e2e/package-cli.test.ts
  packages/cezar/test/e2e/update.test.ts
nodeTest["test:package"].exclude:
  test/e2e/package-cli.test.ts
  test/e2e/update.test.ts
slow.include: ["packages/cezar/test/e2e/**"]
```

The source-only node:test file matches neither exclusion. The new partial-selection path preserves existing cwd semantics. These conclusions apply to paths without glob metacharacters; R-S1 records the new edge case.

### Previously nonblocking S1: resolved

`src/core/slow/rank.ts:128` memoizes text separately from token offering. Every distinct changed path still has its direct imports inspected, including one first read as another changed file's import. It does not expand arbitrary imports recursively. The original `a -> b -> c` probe now yields:

```text
changed ["src/a.ts", "src/b.ts"] -> test/slow.test.ts: ["panel-body"]
changed ["src/b.ts", "src/a.ts"] -> test/slow.test.ts: ["panel-body"]
changed ["src/a.ts", "src/b.ts", "src/a.ts"] -> same evidence
all three: changed-side reads exactly [a, b, c], once each
```

The added permutation regression checks evidence and read counts. The limits are unchanged: 100 changed paths, 1 MiB per read, common tokens dropped above 20 matching slow files. A 101-path probe returned no evidence without reading a file. Queue eligibility, class ordering and duration fallback were untouched.

The guarded-source hash independently computed through `keySourcesHash()` is `b1c641b3862385740e280279a3d5b070d8c6eabf75c68b4072de5041bca6ad20`, matching `KEY_SOURCES_HASHES[13]`; `KEY_FORMAT_VERSION` remains 13 under the candidate's unreleased-version rule.

### Blockers

None remaining from the first-round findings.

### Should-fix notes

#### R-S1, proven, nonblocking under the narrow re-review rule: a literal file path is still interpreted as a glob

Location: `src/cli/setup/candidates.ts:112`, `:116`; applied by `src/cli/setup/exclude.ts:64`.

Contract: 005 D3, "a suite that is only slow, or that prepares itself from the sources, stays a slow candidate keyed like any file." The repair's fallback passes raw evidenced filenames to the glob compiler. A supported glob metacharacter in a literal filename can select a different source-only sibling. This is a new delta note, rather than a reopening of the first-round sibling/descendant reproduction.

Proven source probe, on a `squealShaped` fixture with its two original e2e tests changed to source-only `export {};`:

```text
test/e2e/bundle{a,b}.test.ts: const p="plugins/codex/dist/cli/squeal.mjs";
test/e2e/bundlea.test.ts: imports ../../src/math.ts; asserts sum(1, 2) === 3
plan.exclude.globs: ["test/e2e/bundle{a,b}.test.ts"]
plan.exclude.kept includes test/e2e/bundlea.test.ts
setup --yes exits 0
vitest.exclude: ["test/e2e/bundle{a,b}.test.ts"]
after setup:
  bundlea.test.ts: absent from listing, though the plan called it kept
  bundle{a,b}.test.ts: still listed, though it supplied the exclude evidence
```

The brace compiler treats the filename as alternatives and drops the wrong test. `[` and `?` in filenames or directories need the same care. The normal B1 reproduction passes, but this special-path case still loses source coverage.

Worker-sized fix: make literal-path exclusion proposals safe for the existing glob language and re-check the actual selected file set for every emitted proposal, including fallback paths. If a literal cannot be represented safely, retain it and explain why no exclusion is proposed. Add a metacharacter filename fixture proving the source-only sibling stays listed and the proposal selects only evidenced files through default setup and answer flags. Own `src/cli/setup/**` and its tests; no scheduler or key change is needed. Rebuild bundles afterwards.

### Nits

None.

### What fits and inputs for the next wave

- B1's ordinary sibling, descendant and broad-directory cases are covered by the new tests and the independent replay. Preserve the `globs`/`into`/`kept` seam: choose a bounded selection first, then ask about kept slow files, then apply runner-relative targets. No wider exclusion is needed for these cases.
- S1's direct-import evidence and read-once behavior hold in both changed-path orders. Preserve the 100-path/1 MiB/20-file budgets, duration fallback and ranking-only scope.
- Committed bundles match `npm run build`; key version 13 matches the re-pinned source hash. No other first-round contract was reopened by this delta.
- R-S1 is the only new follow-up input. The coordinator decides whether to dispatch that note before landing. This review changes no product, board or status file and does not land or release the candidate.
