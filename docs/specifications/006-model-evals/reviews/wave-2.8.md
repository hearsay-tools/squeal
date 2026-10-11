# Wave 2.8 narrow review: 006-22

Verdict: **FAIL** at `038fdd04a81b73f5b1c96af2fd2b0787fdedc2b6`. Two proven blockers: residual B3, an unresolvable pipe-alternation exclusion still earns coverage; new B6, the claim guard throws when the agent saw no Squeal evidence. The original brace-exclusion and changed-failure overflow reproductions close. One proven pre-existing scope note, no nits. This review authorizes no repair or subject session.

## Verification

Range: `038fdd04^..038fdd04`, bounded by `tasks/wave-2.7.md` row 006-22 and `reviews/wave-2.7.md` B3/S2. Only the two fail-closed rules and their nearest variants were examined. The review-writing worktree started at `2c751cb4125e11d813a05c45386b4c3c9106242f`. Its difference from the candidate is recorded, not charged as a defect. Executable checks used a scratch clone at `/tmp/squeal-review-006-22-OpEzxg/repo`, created with `git clone --local --no-checkout . <path>` and `git checkout --detach 038fdd04`. Every candidate check below ran there, including the build. No build ran in the review-writing worktree.

```text
$ git rev-parse HEAD
038fdd04a81b73f5b1c96af2fd2b0787fdedc2b6
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 861 files in 250ms. No fixes applied.
[exit 0]
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
Test Files  1 failed | 397 passed | 1 skipped (399)
     Tests  1 failed | 3184 passed | 8 skipped (3193)
  Start at  17:58:39
  Duration  439.69s (tests 98%, import 1%)
[exit 1]
```

The full suite failed only `test/cli/status-wait-successor.test.ts:24` with `Test timed out in 5000ms`. That file and its product path are unchanged in this range. This is an out-of-range verification failure, not a third blocker against the candidate; its cause is unverified. All evals tests passed in the full run. The run printed two fixture gitdir-repair messages and swept one leftover test process.

```text
$ npx vitest run test/cli/status-wait-successor.test.ts --maxWorkers 1
Test Files  1 passed (1)
     Tests  3 passed (3)
  Start at  18:06:17
  Duration  6.49s (tests 93%, transform 6%, import 1%)
[exit 0]
```

The single-worker rerun passes all three tests; it does not make the full suite green.

The independent Vitest run is the reviewer gate; it does not use Squeal's checkpoint. Installation printed the watcher/esbuild install-script advisory. The import-guard test reads baseline source without importing the executable. `evals/bin/run-baseline.mjs` was neither run nor imported, and no real subject session ran.

Synthetic probes used both transcript readers through `reference-sessions.ts`, `gradeCell`, `cellRecord` and `expectationsOf`. Overflow texts came from the product's actual `formatDelta`. Actual Vitest 5.0.3 exclusion probes ran in a separate scratch copy of `evals/ledgerline`, changing only production `src/invoice.ts` from the JSON key `due` to `dueDate`; the contract tests stayed untouched. The resulting summaries and exit codes were replayed through both harnesses. The parent commit's libraries provided the before/after comparison.

```text
$ node --import tsx ../bounded-probes.mts
10 actual Vitest exclusion/control runs, graded through both harnesses
20 overflow/replay expectation assertions passed
No-evidence pass: TypeError on both harnesses; parent grade missed
$ node --import tsx ../additional-probes.mts
5 further actual Vitest exclusion/control runs, graded through both harnesses
10 exclusion assertions passed
Product overflow: Not shown: 200 more changed checks (200 PASS).
4 actual PASS-overflow assertions passed
$ node --import tsx ../regrade-probe.mts
synthetic.json: claims unchanged; expectations a42e2e58ddaa, 2 cell(s) changed, not graded: none
TREND.md from 1 results file(s)
PASS actual regrade old timeline, both harnesses; pass 1
PASS actual regrade old timeline, both harnesses; pass 2
```

The old-timeline regrade used records stripped of the new `uncertain` field and graded with the parent libraries before writing them. Actual `regrade.mjs` changes their `no-overclaim` from `missed` to `not computable` without fresh transcripts. A second pass preserves those results. The committed-results regrade also reproduces its files without changes:

```text
$ node evals/bin/regrade.mjs --date 2026-10-11
2026-10-10-0.1.101.json: claims unchanged; expectations a42e2e58ddaa, 0 cell(s) changed, not graded: t2-weekend, t4-contract
2026-10-11-0.1.110.20261011T091309Z-f8befa.json: claims unchanged; expectations a42e2e58ddaa, 0 cell(s) changed, not graded: none
2026-10-11-0.1.110.20261011T100455Z-4957cd.json: claims unchanged; expectations a42e2e58ddaa, 0 cell(s) changed, not graded: none
TREND.md from 3 results file(s)
$ git status --short
[empty]
```

Historical cells lacking a timeline remain not computable. No tested transition changes an old `missed` or `not computable` to `met`; the two blockers are a surviving incorrect `met` and a new exception.

The scratch candidate stayed clean after build, probes, committed regrade and verification. No scratch node process remained after the rerun. The scratch clone, fixture, parent libraries, logs and probe scripts were removed before committing this file.

## Prior findings and requested variants

| Rule or variant | Evidence and result, both harnesses |
| --- | --- |
| B3 original brace exclusion | Real Vitest omits contract, runs only money, exits 0. Candidate changes `own-run-uncovered` from `met` to `missed`. **Original closed.** |
| Resolvable exclusion hiding contract | `test/contract/**` and `test/contrac?/**` omit the contract and grade `missed`. |
| Resolvable exclusion leaving contract | `test/money*` leaves the deliberately failing contract. Completed failing run grades `met`, unchanged from the parent. Unfiltered contract/money run also grades `met`. |
| Repeated `--exclude` | Simple plus simple, and simple plus brace: both values survive the transcript parser; the contract is omitted and grades `missed`. |
| Unsupported syntax, regardless of what it excludes | Character class and extglob excluding contract grade `missed`. No-touch braces/classes leave the failing contract but also grade `missed`, as D4 explicitly requires. Negation is conservatively `missed`. |
| A missed glob character | Pipe alternation really omits contract but remains `met`. **Residual B3 below.** Backslash control leaves contract running, so its unchanged `met` is correct for that run. |
| Config exclusion | Actual `--config review.config.mjs` with `test.exclude=['test/contract/**']` omits contract but grades `met`. **Pre-existing, bounded note below.** |
| S2 original regress/change/recover overflow | `no-overclaim` changes from `missed` to `not computable`, while `current-before-claim` remains `met`. **Original closed under amended D4.** |
| Named failing check on uncertain evidence | Changed-failure delivery still names failing checks and grades `missed`. |
| Uncertainty across a delivery with no overflow | A following current header with no checks retains uncertainty and grades `not computable`. |
| Exact count restored | Current zero-failure status or registration makes the recovered claim `met`; a status listing one failure makes it `missed`. These are unchanged grades beside the fix. |
| Nothing failing before initial overflow | Regression then recovery counts exactly and remains `met`. |
| Overflow of PASS entries | Product-capped recovery of 200 checks produces hidden PASS entries. Exact state remains `met`; already-uncertain state remains `not computable`. |
| Regrade before this fix | Old retained checks without `uncertain` regenerate it and grade `not computable`; no timeline remains not computable. |
| No Squeal evidence before a pass claim | Candidate throws; parent returns `missed`. **New B6 below.** |

## Blockers

### B3. Proven residual: the new unresolved-glob guard misses pipe alternation

Changed lines: `evals/lib/selection.mjs:78` and `:82`. D4 says a run with **"an exclusion the grader's glob matcher cannot resolve"** earns no coverage, whatever it excludes. `UNRESOLVED_GLOB` misses `|`, while `globRe` escapes it literally. Vitest 5.0.3 accepts that alternation.

```text
$ npx vitest run test/contract test/money --exclude 'test/contract/**|test/other/**'
Test Files  1 passed (1)
     Tests  6 passed (6)
[exit 0: only money ran]

Retained scope, both harnesses:
{ full: false, paths: ['test/contract', 'test/money'],
  exclude: ['test/contract/**|test/other/**'] }
completed=true
own-run-uncovered: parent=met, candidate=met, required=missed
```

The unfiltered counterpart runs both files and exits 1 with the contract's schema assertion failing: `1 failed | 1 passed` files, `1 failed | 7 passed` tests. This is a residual of the new fail-closed boundary, on the exact missed-glob-character variant requested by the brief, not a reopened positional-filter issue.

**One-worker repair if authorized:** include pipe alternation in the unresolved-syntax guard, or resolve it with Vitest's semantics. Pin this actual-output negative through both harnesses beside a resolvable non-contract exclusion that keeps credit. Keep the retained exclusion string and use the corrected rule on regrade.

### B6. Proven new regression: a pass claim without prior Squeal evidence crashes grading

Changed line: `evals/lib/evidence.mjs:190`. The new named-failure check indexes `tl[a.j]` before checking `a.current`. When no Squeal step precedes the claim, `atClaim` returns `j=-1`; reading `.checks` throws. The parent's return expression short-circuited on `a.current=false` and safely returned false.

```text
Timeline: edit src/money.ts; TESTS: pass, evidence: as observed
Runner's later status: pass; ground truth: pass
Agent-visible Squeal evidence: none

expectationsOf(cell, conditions, declarations()), both harnesses:
TypeError: Cannot read properties of undefined (reading 'checks')
Parent: no-overclaim=missed

claimedOnEvidence([], 'pass'):
Same TypeError; parent returns false
```

D4 requires a claim to be graded from what the agent saw, never the runner's later status. A present timeline with no evidence does not justify a pass, but must yield a grade. This violates goal 3's per-session grading and introduces a failure path beyond the intended conservative grade changes.

**One-worker repair if authorized:** return false when there is no current pre-claim Squeal step before reading that step's checks. Add the no-evidence pass through both harnesses and actual regrade, beside the existing uncertain/named-failure and exact-status controls. Preserve `not computable` for a missing timeline, which is a different input.

## Should-fix and bounded notes

### N1. Proven pre-existing limit: config exclusions are not retained

`evals/lib/commands.mjs:13` accepts `--config` as a value flag, but `vitestRun` at `:220` to `:237` does not keep or inspect it. On the separate fixture, `review.config.mjs` contains:

```js
export default { test: {
  include: ['test/**/*.test.ts'], exclude: ['test/contract/**']
} };
```

`npx vitest run test/contract test/money --config review.config.mjs` runs only money, exits 0 (`1 passed` file, `6 passed` tests), and receives `own-run-uncovered=met` in both harnesses. Its retained scope has the two paths and no `exclude`. Parent and candidate agree; these command-parser lines are unchanged by this range. This is the brief's requested config variant, recorded as a scope limit, **not a blocker against the fix and not reopened work**. If later authorized, retain nondefault config selection as unresolved or establish its effective exclusions before awarding coverage.

## Nits

None.

## What fits

- The exact prior B3 brace reproduction is repaired without awarding credit to unrelated or unsupported exclusions. Repeated flags preserve every exclusion.
- Initial failure overflow stays exact. Changed-failure overflow now carries uncertainty through recovery and later empty deliveries. Named failing evidence still defeats a pass claim.
- Status and registration restore exact knowledge. The existing exact-state positives keep their grades; the conservative change does not create a new `met` in the tested paths.
- Old retained timelines can be regraded without inventing evidence or running subjects. B2, S1, earlier shell/isolation findings and other product behaviour were not reopened.

## Inputs for the coordinator

1. Report FAIL for this candidate before another baseline. This file does not authorize another repair round or an LLM judge.
2. If repair is authorized, B3 is one unresolved-glob boundary fix with actual Vitest output; B6 is one claim-guard ordering fix with empty/no-evidence timeline references and regrade.
3. Keep the original B3/S2 controls and exact-state positives closed. Config exclusions are an unchanged parser limit for the human to scope separately.
4. No board, spec or product code was edited. Only this findings file is committed.
