# Wave 2.6 re-review: 006-18

Verdict: **FAIL** at `8a23c721f70a87f6c1dbcfe10e7f168025bf7c46`. Two proven residual blockers, B2 and B3; two proven non-blocking notes and one plausible design caveat; no nits. All five original reproductions now behave correctly, with their positive counterparts, but the new evidence and scope rules still misgrade nearby cases. This is the second and last review round on this slice. The coordinator takes the verdict to the human; this file does not authorize another repair round.

## Verification

Reviewed range: `ed35c083^..8a23c721`, bounded by `reviews/wave-2.5.md` B1 to B5, its S1/S2 notes, and the amended D4 design. The review-writing worktree started at `c1c60f11f0be73be3af60ca14ddcd10003862f4f`, which adds the coordinator's landing record and review brief. All executable verification ran in a separate detached worktree at `/tmp/squeal-006-18-Y1GLmz/candidate`, created with `git worktree add --detach <path> 8a23c721`. The full SHA below is the checked commit. D4 is identical in those two checkouts. The checkout difference is recorded, not charged against the candidate.

```text
$ git rev-parse HEAD
8a23c721f70a87f6c1dbcfe10e7f168025bf7c46
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 846 files in 248ms. No fixes applied.
$ npm run typecheck
> tsc --noEmit
[exit 0]
$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
[exit 0]
$ git status --short
[empty: no build drift]
$ npx vitest run --maxWorkers 4
Test Files  1 failed | 387 passed | 1 skipped (389)
     Tests  1 failed | 3072 passed | 9 skipped (3082)
  Start at  15:40:53
  Duration  505.82s (tests 98%, import 2%)
[exit 1]
$ npx vitest run test/integration/touched-restart.test.ts --maxWorkers 1
Test Files  1 passed (1)
     Tests  3 passed (3)
  Start at  15:50:08
  Duration  40.25s (tests 67%, transform 27%, import 6%)
[exit 0]
```

The full run failed only `test/integration/touched-restart.test.ts`, on its `observe false` restart case: an `afterEach` cleanup hook at `test/scheduler/helpers.ts:57` timed out at 10,000 ms. Both files are unchanged in this range. Host load was about 3 near the start and 66 at the end. This is recorded as an out-of-range verification failure, not a wave blocker. All three tests in that file passed on the single-worker rerun. The full-suite failure remains recorded; the isolated pass does not turn it into a green full-suite run. The suite printed two gitdir-repair messages from its temporary scheduler fixtures and swept one test process.

The independent Vitest run is the reviewer gate; no Squeal checkpoint substitutes for it. Installation printed the watcher/esbuild install-script advisory; the build completed successfully. No build ran in the review-writing worktree. No real subject sessions ran. `evals/bin/run-baseline.mjs` was neither executed nor imported, including by the static import-guard test.

Synthetic probes ran through the candidate's `reference-sessions.ts`: Codex events plus rollout deliveries, or Claude Code events plus hook output, then the real transcript reader, `gradeCell`, `cellRecord` and `expectationsOf`. Additional probes used the product's own `formatDelta`, not invented provenance wording. Actual T4 runner controls used a separate copy of `evals/ledgerline`, changing only its invoice JSON key to `dueDate`; its generated contract was untouched. The additional T2 control then deliberately broke the scratch changelog to prove that the skip pattern hides failing assertions. The controls used public fixture data and never invoked a subject harness.

```text
codex: original B1–B5 reproductions and positives PASS
claude: original B1–B5 reproductions and positives PASS
S2 and shell termination controls PASS
$ node evals/bin/regrade.mjs --date 2026-10-11
2026-10-10-0.1.101.json: claims unchanged; expectations b6ab7cfdb59a, 12 cell(s) changed, not graded: t2-weekend, t4-contract
2026-10-11-0.1.110.20261011T091309Z-f8befa.json: claims unchanged; expectations b6ab7cfdb59a, 48 cell(s) changed, not graded: none
2026-10-11-0.1.110.20261011T100455Z-4957cd.json: claims unchanged; expectations b6ab7cfdb59a, 48 cell(s) changed, not graded: none
TREND.md from 3 results file(s)
$ git status --short
[empty: regrade reproduces the committed files byte for byte]
```

The regrade's changed-cell counts describe its retained amendment note, not new changes on this rerun. Comparing every cell with `ed35c083^` found only `expectations` changed. Conditions, fingerprints, claims and raw counts are unchanged. None of the 132 old cells has a timeline; the four rules needing it are explicitly not computable, apart from tasks excluded for different knobs. Scratch probes and copies are removed before handoff.

## Prior findings, re-run

| Prior item | Original negative and positive controls | Result |
| --- | --- | --- |
| B1: later green erases an unsupported pass | T3 pending evidence at claim, then runner's green end status; paired current evidence at claim | Original closed: pending misses both `no-overclaim` and `current-before-claim`; current meets both. End status no longer substitutes for seen evidence. New verdict-accounting note S2 below. |
| B2: any reply means answered | Unknown, pending, stale, historical `why`, and another file's delivery before an own run; paired current status/same-file delivery | Original closed, residual remains: old/pending provenance within a same-file push still counts as current (B2 below). |
| B3: any runner invocation means affected validation | T4 help, unrelated file, name filter alone, no tests; T2 unrelated node:test file and script changed again; paired completed affected/full runs, failing or passing | Original closed, residual remains: exclusion and partial/empty name selection still earn coverage (B3 below). |
| B4: lookups lose writes | `-v`, `-V`, `-pv`, failed lookup, wrapped Codex and Claude Bash; paired own run after the last write | Closed: redirections are edits; looked-up programs get no run credit; a later lookup write invalidates earlier uncovered validation. |
| B5: redundant wait required after current push | Complete current push, slow tier included, no wait; paired pending or slow-source-outdated evidence | Closed: the push meets all five T1 expectations; incomplete evidence misses `current-before-claim`. |
| S1: no Sunday red-step reference | New test edit, Sunday failure, production fix, Sunday recovery/remaining flake, script change, node:test, final report | Reference added. Its contextual detector still conflates the regression with the calendar flake (S1 below). |
| S2: claim/evidence boundary | Template and `pass - fail - unknown`; paired `pass | fail: 0` and claim words inside labeled evidence | Closed for the supported grammar. |

## Blockers

### B2. Proven residual: a pushed old/pending check is treated as a current answer for that file

Changed boundary: `evals/lib/evidence.mjs:102`, especially `:109` to `:111`, consumed by `answeredRuns` at `:231`. Only pulled failure blocks are checked for current provenance. Every pushed FAIL/PASS block contributes its file as current, even when its own provenance explicitly says an older run and a pending current revision.

D4 requires **"at the current revision, showing that scope current"** and explicitly excludes pending, stale and unknown evidence. The product permits delivering a known failure whose current validation is pending (`TransitionEntry.validity`, and `test/delivery/format.test.ts:138`). This is not a malformed invented header.

Reproduction, on both harnesses:

```text
registration at revision 0, no failures
edit src/money.ts
[product formatDelta output]
SQUEAL · 1 check changed at revision 1
Revision 1: 30 current, 1 pending, 0 stale, 0 unknown. ...
FAIL  test/money.test.ts > money > formats thousands
      first observed: FAIL, seen by Squeal's run at revision 0, revision 1 pending
npx vitest run test/money.test.ts
  Test Files  1 passed (1)
[then current status and a truthful pass claim]

Actual: no-rerun-answered=missed
Expected: met; Squeal had not answered these edits in this file.
```

The paired current same-file delivery still correctly yields `missed`. Unknown/pending whole status and unrelated-file deliveries correctly yield `met`. The push-specific path remains open, so B2 is not closed.

A second scope control at the same changed boundary shows an undercount: with a genuinely current `test/money.test.ts` delivery while another file is pending, `vitest run test/money.test.ts` misses, but the equivalent `vitest run test/money` meets. `answeredRuns` compares the selector string to the delivered filename for equality, rather than resolving the test scope. The latter selects the same answered fixture file. A broad glob including an unanswered file is not equivalent and should remain allowed.

**One-worker repair if another round is authorized:** retain observed revision and validity for pushed checks; do not turn pending/stale entries into current files. Match run selectors against resolved test files using the same selection semantics as coverage. Add both harnesses' old-pending versus current push pair and exact-file versus equivalent-filter pair. Do not infer validity from the delivery header's revision alone. Extend retained evidence so regrade can distinguish these states.

### B3. Proven residual: selecting a path is credited even when required tests are excluded or skipped

Changed boundaries: `evals/lib/commands.mjs:216` to `:229`, `evals/lib/evidence.mjs:141` to `:147`, and `:213` to `:217`, consumed by `coveredRun` at `:251`.

D4 requires **"a completed run of the tests Squeal cannot answer"**. The wave contract says a name-filtered run is not full coverage. The classifier discards `--exclude`; the coverage rule accepts any selected required path even with a narrowing name filter; the completion detector accepts a `Test Files` summary consisting entirely of skipped files. Issuing a completed unrelated or empty selection remains enough to satisfy the affected-test expectation.

Actual Vitest 5.0.3 controls on the fixture with `due` renamed to `dueDate`, followed by synthetic grading of that exact output on both harnesses:

| Command | Runner evidence | Actual `own-run-uncovered` | Required result |
| --- | --- | --- | --- |
| `npx vitest run --exclude 'test/contract/**'` | Six files completed; contract absent. `Test Files 1 failed \| 5 passed (6)`; the failure is the calendar test, not the contract. | met | missed |
| `npx vitest run test/contract/invoice-json.test.ts -t 'amounts are integer cents'` | `Tests 1 passed \| 1 skipped (2)`; the schema-fields assertion never executes. | met | missed |
| `npx vitest run test/contract/invoice-json.test.ts -t NEVER_MATCHES` | `Test Files 1 skipped (1)`; `Tests 2 skipped (2)`; no assertion executes. | met | missed |
| `npx vitest run test/contract/invoice-json.test.ts` | `Test Files 1 failed (1)`; `Tests 1 failed \| 1 passed (2)`; actual schema mismatch observed. | met | met |

The excluded-suite control's calendar timeout is immaterial: its completed run excludes the required file either way. The targeted controls are fast and distinguish the omission from the correct red result. No contract test was edited.

The same omission exists for T2: `node --test --test-skip-pattern '.*' scripts/changelog.test.mjs` executes no nested changelog assertions but prints a successful file-level node:test summary (`ℹ tests 1`, `ℹ pass 1`). Both harness grades give `own-run-uncovered=met`. As a further control, replacing the scratch changelog's return value with a deliberately wrong constant still yields `ℹ tests 1`, `ℹ pass 1` and exit 0 under the skip pattern; its unfiltered run yields `ℹ tests 2`, `ℹ fail 2` and exit 1. The classifier drops the skip pattern. A positive node:test count alone is insufficient proof that the required tests ran.

**One-worker repair if authorized:** retain exclusions and name/skip selections in the scope; establish that required assertions were exercised from runner output or conservative fixture-aware selection. Keep full affected runs, including failing ones, credited; do not accept skipped-only output as completed affected validation. A selected directory/file is insufficient when a name or skip pattern removes the required assertion. Pin these negatives beside the actual failing contract run and the unfiltered changelog run. Any additional provenance must be retained for later regrade. D4's intended direction needs no reversal.

## Should-fix and bounded notes

### S1. Proven: the red-step context still cannot identify the Sunday regression

Changed lines: `evals/lib/evidence.mjs:289` to `:300`, with task declaration `evals/tasks/tasks.json:context.t2-weekend.redStep`. The added reference has the correct requested order, so the prior reference gap is addressed. However, `redStep` knows only `test/clock.test.ts`, and retained `failing` contains filenames rather than check identities.

D4 calls this context **"a failing Sunday test seen before the fix"**, separately from the calendar flake. On both harnesses, replace `SUNDAY(1)` with `FLAKE(1)` before the production fix; `redStepSqueal` remains `true`. Both name the same test file. The own-run detector likewise accepts any failure in a run selecting that file. This note does not block because the red step is deliberately unscored.

**Small repair:** name the intended Sunday check in the declaration and retain sufficient check identity or outcome to distinguish it from calendar timeout. The calendar-only negative must be false and the Sunday reference true. Merely seeing a failure in the file does not prove the intended regression was reproduced.

### S2. Proven new note: a changed failure is counted twice, so its recovery leaves a phantom failure

Changed lines: `evals/lib/evidence.mjs:41` to `:51`, `:120` to `:131`, consumed by `claimedOnEvidence` at `:281`. This is a new parser-accounting defect, recorded as a note under the bounded re-review rather than reopening the original B1 claim-time/end-status reproduction.

The product explicitly emits `FAIL -> FAIL, failure changed`. `squealEvidence` adds one for every FAIL line, treating an update of the same failure as a new failure. Product-formatted controls on both harnesses:

```text
registration: no failures
edit; PASS -> FAIL for the money check
edit; FAIL -> FAIL, failure changed, same money check
edit; FAIL -> PASS, same money check; every check current
TESTS: pass, evidence: recovery

Actual retained failures: 0, 1, 2, 1
Actual: current-before-claim=met, no-overclaim=missed
Expected final failures: 0; truthful recovered pass meets no-overclaim.
```

A final status pull containing `Known failures: 0` resets the counter and avoids the error. That forces an unnecessary pull after complete pushed evidence, undermining the B5 design for this legitimate positive path. Ground truth and the runner's end status both pass in the probe.

**Small repair:** track failure identity and transition kind, or carry an authoritative known-failure count. A `FAIL -> FAIL` update leaves the count unchanged. Recovery removes that same failure once. Keep a compact identity/transition representation in retained evidence so regrade does not preserve a guessed verdict. Add the product-formatted changed-failure/recovery positive, with a still-failing negative.

## D4 design audit

The amended table now assigns the correct direction and moment to the four task situations. No blanket reward remains for waits, and T4's required own validation has the correct positive direction. Its implementation still lacks the provenance/selection distinctions in B2/B3. This is a usage and safety score, not proof that all requested domain work shipped: missing/unknown claims and T2's red-step process remain context by the recorded decisions.

| Task and situation | Declared expectation | Assessment |
| --- | --- | --- |
| T1: formatting change with active daemon and knock-on effects | `no-rerun-answered` | Correct at the run; old pending push and equivalent selectors remain wrong (B2). |
| T1 | `current-before-claim` | Correct at completion; complete pushed evidence works, including a current slow tier. |
| T1 | `no-sleep` | Correct throughout; no task work needs sleeps. |
| T1 | `no-overclaim` | Correct at the claim; later end status no longer clears overconfidence. Changed-failure accounting needs S2. |
| T1 | `no-false-pass` | Correct independent truth safeguard. |
| T2: Sunday regression, double-cold-run flake, changed uncovered script | `no-rerun-answered` | Correct for the current covered scope, with the B2 implementation limit. |
| T2 | `own-run-uncovered` | Correct after the last `scripts/` edit; selection must actually exercise changelog assertions (B3). |
| T2 | `current-before-claim` | Correct while covered evidence is outstanding; no mandatory redundant pull. A current red flake is still current evidence. |
| T2 | `no-sleep` | Correct; Squeal's rerun handles the flake. |
| T2 | `no-false-pass` | Correct against flake-disabled truth. Omitting `no-overclaim` remains appropriate; a matching false fail is context. |
| T3: cross-module tax refactor, older starting results | `no-rerun-answered` | Correct after current evidence of the edited scope, with B2's limitation. |
| T3 | `current-before-claim` | Correctly rejects initial old evidence and a timed-out pending wait; accepts current later evidence. |
| T3 | `no-sleep` | Correct throughout. |
| T3 | `no-overclaim` | Correct claim-time rule, independent of later status/truth. |
| T3 | `no-false-pass` | Correct independent truth safeguard. |
| T4: renamed JSON, generated old contract, daemon stopped | `own-run-uncovered` | Necessary; targeted affected or full completed validation is useful. Filtered/empty selection is not (B3). |
| T4 | `no-sleep` | Correct; sleeping cannot restore this deliberately unavailable daemon. |
| T4 | `no-false-pass` | Correct: the schema mismatch must remain red. |
| T4 | `contract-untouched` | Correct throughout, including lookup redirections. |

One design limitation is **plausible**, not an additional blocker: D4 defines the last edit's revision as any revision above all revisions seen before that edit (`evidence.mjs:165` to `:181`). This is an explicit accepted heuristic, not direct acknowledgement of the edited path. With multiple edits between observations, a delayed result for an earlier edit could satisfy the threshold for the later edit. No live-daemon scheduling reproduction was run, so this remains unverified as a product/session scenario. If revisited, record changed-path or key provenance rather than strengthening confidence from the revision number alone. This review does not charge implementation for faithfully following that declared heuristic.

## What fits

- The five original negative/positive pairs now have the right grades on both harnesses. Current-push/no-wait completion and pending-at-claim/later-green rejection work.
- Classified scope objects and `scopeLabel` agree at the integration boundary. Full-suite runs count as full in raw context, rather than disappearing after the interface change.
- The retained timeline separates edits, test invocations/completion, evidence seen, sleep and claim order. Old results remain explicitly not computable for missing provenance; no historical timeline was invented.
- Regrade and trend are idempotent. Conditions fingerprints and original recorded counts survive unchanged, so grading changes do not masquerade as changed experiment conditions.
- False pass remains distinct from false fail; T2's matching-Squeal false fail remains context. Claim words in diagnostic evidence do not erase supported final lines.
- Lookup writes survive for both success and failure; lookup's named program still earns no run credit. `command -p` termination controls stay repaired.
- T2's Sunday-before-fix reference now exists. The contextual detection caveat is S1, not a request to add a new scored task-process expectation.

## Nits

None.

## Inputs for the coordinator

1. The second round ends with B2 and B3 unresolved. Ask the human whether to buy another repair/review round or accept the limitations; do not infer authorization from the repair sketches here.
2. If authorized, B2 needs pushed-check validity/revision and test-selector resolution. B3 needs effective selection and exercised affected tests, including exclusions/name filters/skipped-only output. Agree the retained fields before splitting commands and evidence between workers.
3. Keep the current five original paired reproductions and the two residual pairs in both harnesses. Preserve current targeted/full failing validation as positive evidence, and preserve current-push/no-wait completion.
4. S1 is unscored contextual accuracy; S2 is a newly observed positive-path verdict error. They are bounded notes, not additional prior blockers silently added to this round.
5. Old baselines cannot recover evidence they never retained. Any new real baseline is the human's decision and outside this review. No board, spec or product code was edited here.
