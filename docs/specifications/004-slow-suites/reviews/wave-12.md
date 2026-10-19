PASS 726ef233e6dbeaab785844bf42690c2bfe142a3f

# Wave 12 review: 004-81

Latest verdict: **PASS** on `726ef233e6dbeaab785844bf42690c2bfe142a3f`; B1 and B2 are closed. See the dated re-review below. The original review remains as the record of the first candidate.

Original verdict (2026-10-19): **FAIL**, 2 proven blockers, 0 should-fix, 0 nits. Candidate `cand/0.1.220`, pinned HEAD `fd9b1a1f1d77b827d270d8678b0ba7e60daee90d`; base `origin/main` at `2929a3fa29bc2710c06843a2719a2ea021f8de48` (0.1.219). The blockers are two consumers of the new file exclusion that still assume Squeal's listing describes Vitest's complete suite.

## Verification

All commands and probes below ran at the pinned candidate with no tracked or untracked changes. Only this review file was added afterward. `npm ci` completed before the independent full run. No product edits, build, eval execution or probe against the real HOME. The setup probe supplied an empty temporary harness home; both probes removed their temporary repositories.

```text
$ git rev-parse HEAD
fd9b1a1f1d77b827d270d8678b0ba7e60daee90d
$ git status --porcelain=v1
(no output)

$ npm ci
added 196 packages, and audited 197 packages in 10s
32 packages are looking for funding
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.220 lint
> biome check .
Checked 1442 files in 854ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.220 typecheck
> tsc --noEmit
(exit 0)

$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3
Test Files  722 passed | 1 skipped (723)
     Tests  6174 passed | 10 skipped (6184)
  Start at  07:29:49
  Duration  910.89s (tests 97%, import 2%, transform 1%)
   Isolate  723 workers spawned · ~147ms startup each
(exit 0)
```

`npm ci` also reported the deprecated `node-domexception` and six packages' install scripts not covered by `allowScripts`; it completed successfully. Build reproducibility and committed bundle drift are **unverified** here: the brief expressly forbids `npm run build`. This is a verification limit, not a finding. The independent run is the review gate; Squeal's checkpoint is not substituted for it. The full-run log also contains two fixture gitdir repair notices, one stale-process cleanup notice and Vitest's experimental type-testing notices; it contains no failures. HEAD and the clean tree were rechecked after the run, before adding this file.

A later background Squeal baseline notification reported recorder-fidelity failures in `test/runners/node-test/run-reads-fidelity.test.ts` and `test/runners/vitest/observe-fidelity.test.ts`, first observed at its revision 0. That separate notification is **unverified** as evidence of this candidate on a clean tree; the independent full run above completed successfully and includes both files. It is not substituted for the review gate or filed as a wave finding.

## Blockers

### B1. Proven: setup counts and proposes an already excluded Vitest suite

Location: `src/cli/setup/plan.ts:177`, `:201`, `:215`; `src/cli/setup/candidates.ts:29` consumes the unfiltered facts. The changed plan adds the not-covered list at `:213`, but does not apply it to those consumers.

004 D7: `vitest.exclude` names files Squeal does not "list, run, key or count". The 004-81 done-when is "an excluded glob's files appear in no listing, key, run, count or status". Vision principle 7 also requires honest evidence about what runs.

A fresh repository with no daemon listing has two tracked tests, `test/unit.test.ts` and `test/e2e/package.test.ts`, a Vitest config including `test/**/*.test.ts`, and this policy:

```json
{"vitest":{"exclude":["test/e2e/**"]}}
```

An isolated source-level probe called `readPlan(root, { env: { HOME: temporaryHome, PATH: "" } })`, then `answerPlan(plan, NO_ANSWERS, () => 0)` and `formatPlan(plan)`. Actual output:

```text
testFiles: ["test/e2e/package.test.ts", "test/unit.test.ts"]
warmup: { source: "config-text", testFiles: 2, withoutCurrentResult: 2 }
slow.groups[0]: { dir: "test/e2e", files: ["test/e2e/package.test.ts"], defaultSlow: true }
outdated: ["squeal.config.json has no \"slow\" key"]
answers.slow: ["test/e2e/**"]
question: test/e2e/** (1 files: under a directory named e2e). Run these tests in the slow tier?
question: Warm up now: run all 2 test files on this terminal's daemon, current ones too, to record the ignored paths each reads?
Not covered, excluded by squeal.config.json:
  Vitest test files matching "test/e2e/**"
Warm-up: runs all 2 test files, 2 without a current result (estimated: no daemon has listed them)
```

The adapter actually runs only the unit file. Calling the count "estimated" does not account for a known exclusion, and the same setup both excludes the e2e suite and asks to make it slow. This is a new-key integration gap; the static facts reader predates the candidate but the changed setup plan must apply the new policy before consuming it.

Fix sized for one worker: apply the validated Vitest file exclusions to setup's Vitest facts before slow detection, the test-glob universe, missing-key checks and warm-up counts. Preserve files independently covered by a node:test or pytest project; a Vitest-only exclusion must not remove those projects' files. Keep the excluded-glob explanation. This repairs respect for existing exclusions; the future 005-70 proposals are not required to close it.

Regression: use the no-store two-file fixture above and an all-excluded variant. Plain/JSON plan and check must count only covered files, return no excluded file in the test universe, ask no slow question for the excluded directory, and not mark `slow` missing solely because of it. Retain a covered slow group and a project covering the same path as controls. The current `test/cli/setup/excluded.test.ts` checks only that the explanation appears; it does not assert the universe, counts, questions or missing-key result.

### B2. Proven: the command-denial hook claims an independent Vitest run is already covered

Location: `src/runners/vitest/adapter.ts:383` filters the listing after calculating `#omitted` at `:382`. The existing consumer at `src/harness/shared/deny.ts:161` and `test-command-files.ts:41` assumes zero omitted files means a bare Vitest command can be resolved completely from that listing. The new test at `test/runners/vitest/exclude-files.test.ts:37` explicitly expects zero omitted files despite an excluded suite.

Spec 005 D8 step 3: "Deny only when every one of those files is a file Squeal validates and has a current result at the current revision"; one "unlisted or outside Squeal's runners" must let the command run. 004 D7 keeps the exclusion Squeal-only, and vision principle 2 forbids presenting unvalidated code as covered.

An isolated temporary repository used the real Vitest adapter and a separate `createVitest("test", ...)` instance to list the same two files as B1. No tests were executed. Policy also enabled `testCommand.denyWhenCurrent`. The store contained only the covered unit file, a current passing file-level check, a registered consumer and a live daemon record. The omitted-file value was the adapter's own result. The public `testCommandOf` and `denyCurrentTestCommand` functions produced:

```text
Squeal adapter listing: [{ project: "", path: "test/unit.test.ts" }]
omittedTestFiles(): 0
Independent Vitest listing: ["test/e2e/package.test.ts", "test/unit.test.ts"]
Recognized command: { runner: "vitest", filters: [] }
The command did not run. Squeal holds current results at revision 0 for the 1 test file it runs (test/unit.test.ts): 1 check passed, no known failures, none inherited.
Squeal does not cover typecheck, build, or test suites it is not configured for. Run the command again to run it anyway; it will not be stopped again this session.
```

Thus the first `npx vitest run` is denied with a false statement about its scope. It would have run the excluded e2e file, whose result Squeal does not hold. The repeat escape does not make the first denial honest. This also affects a broad filename filter that matches covered and excluded files. The locked review command has flags and a shell wrapper outside this recognizer, so this bug does not invalidate that independent run.

Fix sized for one worker: make the denial path aware that Vitest's independent scope may exceed Squeal's listing. A conservative fall-through for Vitest commands when file exclusions are configured is sufficient; alternatively preserve separate complete-scope metadata and resolve against it. Do not restore excluded files to the coverage listing, keys or visible counts. Keep the omitted/typecheck guard's existing protection and read live policy so a recently changed exclusion cannot be bypassed by an older omission record.

Regression: with `denyWhenCurrent` on and covered checks current, a bare `npx vitest run`, `npm test` resolving to that form, and a broad filter including an excluded file must run without consuming the one-time denial slot. A command that selects only an excluded file must run too. Preserve existing denial behavior with no exclusions. Cover the actual adapter-listing to hook-decision seam rather than only a fabricated nonzero omitted count.

## Should-fix and nits

None. The coordinator's separate Pi timing observation is assessed below; it is not a proven candidate regression.

## What fits

- **Policy and adapter boundary:** `vitest.exclude` defaults to `[]`, validates types and globs, and is passed through `daemon.ts` to both Vitest instances in the correct constructor position. `testFiles()` and `affected()` filter paths relative to the worktree root; changing the exclusion stamp recreates the instance and requests a relisting. Existing scheduler listing removal retires checks and keys together, so excluded files do not continue to count after refinement. B1 and B2 identify the consumers that need additional work.
- **Independent Vitest scope:** `vitest.config.ts` and CI are unchanged. The source-level independent listing above includes e2e while Squeal's excludes it. The independent full run passed all 722 active test files (723 collected), including the unchanged config's e2e scope; it did not use the Squeal policy as a Vitest exclusion.
- **Repository policy:** `squeal.config.json` replaces e2e's `slow.include` with `vitest.exclude: ["test/e2e/**"]` and drops its widened plugin inputs, preserving the separate harness-test input declarations.
- **Coverage disclosure:** status JSON/text carries `vitestExcludedFiles`; the primer names the excluded globs in its not-covered clause; setup plain/JSON lists them. Ordinary covered-file counts still use the adapter's listing. B1 is specific to setup's independent static facts.
- **Legacy configurations:** no migration or fatal config rejection. Under 001 D11, `slow.precondition` becomes an unknown-key problem while the known slow fields apply. A `nodeTest[]` entry retaining `precondition` is skipped with an explicit unknown-key/project-skipped problem, as 003 D1 requires for any invalid entry. Pytest has no recognized precondition either; its generic project-entry validation rejects that entry with a note. Old `inputs` declarations are still valid: tracked files can remain ordinary inputs, but the removed special admission of gitignored artifacts no longer keys them. Old `slow-artifacts:` and `slow-skips:` metadata is inert, not migrated or read. The dedicated legacy-policy regression asserts the slow/node:test outcomes.
- **Deletion and inheritance:** precondition execution, skipped-tier readers/writers/text, artifact keys/records and artifact provenance are removed throughout the scheduler, state sink, status and Stop callers. `Ledger.probe(key)` has one signature at all changed callers; byte-identical slow keys now inherit and wait on claims as fast files do, retaining the unconfirmed inherited-failure guard. The slow inheritance and claims tests now cover files with no artifact declaration. Stop's no-edit exemption, live-revision transaction, wait bound and daemon-lapse behavior remain.
- **Version/key invalidation:** package, lockfile, installer, plugin manifests/packages and embedded bundles name 0.1.220. `KEY_FORMAT_VERSION` is 13, with a new hash while 11 and 12 remain unchanged. Dropping artifact inputs changes key meaning and warrants the bump. The guard now watches the surviving slow classifier in place of the deleted inheritance module.
- **Collateral changes:** setup skills remove the obsolete artifact question and constrain the retained `--input` escape to committed runtime inputs; references describe the current slow line and new exclusion; warm-up no longer suggests declaring an ignored build output. The e2e scenarios' fake CLI is committed fixture content, so its ordinary declared input and byte changes still support the tests; their artifact-specific assertions correctly give way to ordinary failure provenance. The real-CLI artifact-proposal bullet is removed while its other setup coverage stays. The changes are grouped in thematic commits `46e19480` (setup, skill, hint, real-CLI), `929f52ba` (slow e2e) and `a7e3dd76` (README and reference texts), rather than a separate commit for each collateral path.
- **Retained build-output finder:** `src/cli/setup/build-outputs.ts` is unused at runtime and tested separately. It is the old evidence finder renamed and detached, with `holdsArtifact` removed. Retention has a concrete specification owner: amended 005 D3 "Slow tests and build-output tests", step 2, requires these manifest/build-script/named-directory evidence sources; 005-70 is the next planned consumer. It does not preserve the deleted artifact-key rule or proposal. It should acquire that caller in 005-70, not become a permanent unused API.
- **Historical eval text:** the production diff in `evals/lib/squeal-text.mjs` changes comments only. Parsers retain the older artifact, source-change and skipped wording, while current producer tests use the new line. `test/evals/slow-claim.test.ts` explicitly retains historical line cases. No eval runner was invoked.

## Pi latency observation

The parent corrected the brief after providing `/tmp/cand-0220-gate.log:5`: the failing table was measured at load **3.66 / 3.91 / 2.10**, not 15. Load 15 was later in that run. The test therefore legitimately asserted its below-4 budget. Gate measurements: ping p95 0.1 ms, delivering boundary 8.2 ms, silent boundary 4.2 ms, **fresh-worker boundary 83.7 ms** against 80 ms (p50 70.7 ms, 10 fresh-worker samples). The parent reports three isolated passes at the same candidate content, without matched main-side measurements.

There is no proven 004-81 latency regression. The measured failing path includes cold worker startup; no Pi worker/host source is changed. Shared changes remove artifact-map reads and skip queries, while the empty exclusion default adds only policy/coverage fields and does not enumerate files at a tool boundary. It could affect cold import or allocation costs, as any shared-code change can, but attributing a 3.7 ms overrun requires candidate/base samples under comparable load. The warm-boundary results do not support an added hot-path cost. Do not turn the supplied gate's timing failure into a blocker against this row without that evidence. The reviewer's full run exited 0 with no Pi failure. Its successful-test output does not expose the timing table, and host load was above 4 during observations in this run; this is not independent proof of the calm-load timing budget.

## Inputs for the repair and next wave

1. Repair B1 in setup's covered facts, then B2 in command resolution/denial. They are separate seams and can be committed separately. Both need regressions against the new exclusion, not changes to the declared policy or to Vitest's config.
2. Keep `vitest.exclude` as a worktree-relative getter read by both adapter factories. A policy edit must relist before claiming the revision's runner part is complete. Excluded files stay outside run requests and coverage counts; independent runner commands must remain runnable.
3. 004-80 starts on the smaller scheduler: `SlowRun` is `{ tier, slot }`, `SlowTier.next()` has no precondition gate, and `ended()` publishes activity in the result transaction. `Ledger.probe(key)` returns `{ hits, mayWait }`; no artifact argument or rule returns. Preserve the slot/load guard, finish-then-discard, claim waiting and Stop budgets. Continuous triggering, quiet-window measurement and ranking remain 004-80, not missing work in 004-81.
4. 005-70 can consume `buildOutputCandidates(facts, dir, files)` and its evidence to propose runner exclusions. Respect exclusions already present before proposing any slow group. The retained `--input` flag does not authorize build-output inputs.
5. Regenerate/version bundles and re-pin the key guard as required by the actual repair, then run the candidate checks and a narrow re-review against B1/B2. This review approves no landing. The build/drift evidence remains the coordinator's responsibility under the no-build review brief.

## Re-review — 2026-10-19

Candidate: `cand/0.1.220`, pinned and independently verified at clean HEAD `726ef233e6dbeaab785844bf42690c2bfe142a3f`. **PASS: 0 open blockers, 0 new should-fix, 0 new nits.** This re-review is bounded by B1/B2 above and the delta from `fd9b1a1f`: the two repair commits, rebuilt bundles, the key hash and the version-sensitive test exemption. No settled part of the original review was re-prosecuted.

### B1 — closed (proven)

`src/cli/setup/repo.ts:158` now compiles the validated policy's `vitest.exclude` with the same `createInputMatcher` used by the adapter, and filters the no-store Vitest facts before setup consumes them. Therefore the slow candidate groups, returned test universe, missing-slow-key decision and estimated warm-up count share the covered Vitest list. The store-backed path continues to use the daemon's coverage rows. Independently covered node:test/pytest files remain in the separate project universe.

The added `test/cli/setup/excluded.test.ts` cases verify the no-store two-scope fixture counts only one file, produces no excluded slow group/question and no missing `slow` key; the all-excluded case counts zero; and a node:test project restores its matching e2e file to the universe. Existing setup candidate tests retain the covered slow-group behavior. This closes the original static-facts failure without waiting for 005-70.

### B2 — closed (proven)

`src/runners/vitest/adapter.ts:383` computes omissions against the final covered list, so excluded Vitest specs now contribute to the omission metadata without reappearing in coverage, keys or visible covered-file counts. More importantly, `src/harness/shared/deny.ts:159` reads the live policy and returns `null` for Vitest commands whenever `vitest.exclude` is nonempty, before resolving files or consuming the one-time denial. A stored zero omission count cannot bypass this conservative guard. Node:test and pytest command decisions keep their prior behavior; Vitest's existing non-file/typecheck omission guard remains.

The real adapter regression now expects two omitted specs while preserving filtered `testFiles()`/`affected()` results. The hook regression starts with current covered checks and a stored zero omission count, then verifies bare, filtered and excluded-only Vitest commands run and leave the denial slot unused. The guard applies to every recognized Vitest command, including npm scripts resolved to that runner, rather than relying on each filter to reveal the excluded scope. Existing no-exclusion denial tests remain. These complementary adapter and live-hook checks close the original seam and its stale-metadata variant.

### Repair delta and verification

The bundle delta carries exactly the setup filter, omitted-spec calculation and live-policy guard into the shipped CLIs/hooks. `KEY_FORMAT_VERSION` remains 13, with its unpublished pin recomputed for the adapter repair; versions 11/12 are untouched. The setup fixture test joins the version-sensitive exemption list because it names synthetic package versions. No Vitest config or independent e2e scope changed. Build/drift regeneration is still **unverified** by this reviewer under the explicit no-build brief, not a finding.

All checks below ran after `npm ci` at the pinned HEAD with a clean tree; this report was edited only afterward. No build, eval or real-HOME probe was run.

```text
$ git rev-parse HEAD
726ef233e6dbeaab785844bf42690c2bfe142a3f
$ git status --porcelain=v1
(no output)
$ npm ci
added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
(exit 0)
$ npm run lint
Checked 1439 files in 615ms. No fixes applied.
(exit 0)
$ npm run typecheck
> tsc --noEmit
(exit 0)
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
RUN  v5.0.3
Test Files  722 passed | 1 skipped (723)
     Tests  6180 passed | 8 skipped (6188)
  Start at  08:02:43
  Duration  753.55s (tests 98%, import 2%)
   Isolate  723 workers spawned · ~107ms startup each
(exit 0)
```

The npm warnings match the original review (deprecated `node-domexception`, six unapproved install-script packages). The independent gate above is the reviewer's own run, not the coordinator's pre-pin run or Squeal's background results. The log contains two fixture gitdir-repair notices, one stale-process cleanup notice and Vitest's experimental type-testing notices; there are no failures. The Pi test produced no failure; successful timing tables are not exposed in this log, so this is not a separate calm-load timing proof. HEAD and the clean tree were rechecked after the run, before adding this section.

No repair work remains from B1/B2. The original next-wave interface and budget notes still apply; continuous triggering/ranking and 005-70 proposals remain future work. This judgment is for the coordinator to decide what lands.
