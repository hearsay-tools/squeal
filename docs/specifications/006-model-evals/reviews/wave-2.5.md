# Wave 2.5 review: 006-13

Verdict: **FAIL** at `8480c73d446ad59d2f88aea1b0472580a2c075c6`. Five proven blockers, two non-blocking should-fix notes, no nits. The per-task switch fixes the original T4 scoring direction, but the score still confuses receiving a response with receiving current evidence, and issuing a runner command with running the required tests. One new shell regression loses real edits.

## Verification

Reviewed range: `991bd75^..8480c73`, for 006-12, 006-14 and their coordinator follow-ups. The unrelated 001 changes interleaved in this range have their own review and are outside this brief's prosecution.

The assigned worker checkout started at `4425013d3b226bff7bff1c277864d356ffbd5b36`. All executable verification below ran in a separate local clone under `/tmp/squeal-006-13.ZrFC449O/repo`, checked out explicitly at `8480c73d446ad59d2f88aea1b0472580a2c075c6`. Its tracked tree was clean before verification, after building, and after regrading. The checkout difference is recorded, not charged against the candidate. No build ran in the worker checkout. No real subject session ran, and `evals/bin/run-baseline.mjs` was neither executed nor imported.

```text
$ git rev-parse HEAD
8480c73d446ad59d2f88aea1b0472580a2c075c6
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
$ npm run lint
> biome check .
Checked 840 files in 266ms. No fixes applied.
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
Test Files  383 passed | 1 skipped (384)
     Tests  2940 passed | 8 skipped (2948)
  Start at  15:07:04
  Duration  426.61s (tests 98%, import 1%)
[exit 0]
```

The independent Vitest run is the review gate, not a Squeal checkpoint. Installation also printed an advisory about the watcher and esbuild install scripts; installation and the subsequent build completed successfully. The full suite printed two gitdir-repair messages from its temporary scheduler fixtures and a sweep of one earlier test process; it completed with no failed test. All 32 reference tests are included in this passing suite.

Synthetic probes used both `gradeCell` directly and the candidate's `test/evals/reference-sessions.ts` helper, which runs synthetic Codex events through `codexTimeline`, `gradeCell`, `cellRecord` and `expectationsOf`. Bash controls ran only local lookup/builtin commands, and an actual `vitest --help` control ran no tests. The scratch scripts asserted each reported misgrade. Their observable outputs are preserved below; the scripts and scratch are removed before handoff.

## Blockers

### B1. Proven: `no-overclaim` observes Squeal after the claim, not when the agent made it

Changed boundary: `evals/lib/behaviours.mjs:47`, `evals/tasks/tasks.json:37`, with the consumed field produced at `evals/lib/grade.mjs:106` and `evals/lib/results.mjs:70`. The runner samples `status-end.json` after the subject session (`evals/bin/run-cell.mjs:236`).

D4 names the moment as **"the final claim, while Squeal validates"**. Testing specifically names **"claiming before Squeal is current on T3"**. The new rule instead reads `squealVerdict`, which is the runner's later observation. A daemon can settle between those two moments without the agent ever seeing current evidence.

Synthetic T3 sequence:

```text
edit src/tax.ts
squeal status --wait 1
  Returned on timeout
  Revision 2: 0 current, 1 pending, 0 stale, 0 unknown.
  Known failures: 0
TESTS: pass, evidence: observed
[after the session, the runner observes current pass; ground truth passes]

Actual expectations:
no-rerun-answered=met, waited-before-done=met, no-sleep=met,
no-overclaim=met, no-false-pass=met
```

This is the very known mistake the new references promise to reject, yet it earns 5/5. The reference at `test/evals/reference.test.ts:141` models it only by setting the **later** status to stale. It never models stale or pending evidence at claim time followed by a later green observation.

**One-worker repair:** keep the verdict/evidence available to the agent at its final claim separately from the runner's end verdict. Grade `no-overclaim` from the former; retain the latter as context. Add the pending-at-claim/later-green reference for both harnesses. Do not infer claim-time evidence from the end snapshot when regrading old cells: name it not computable where the needed evidence was not kept. This does not change `no-false-pass`, which correctly answers a separate ground-truth question.

### B2. Proven: `no-rerun-answered` penalizes an own run when Squeal has not answered the edits

Changed boundary: `evals/lib/behaviours.mjs:23` and the new references at `test/evals/reference.test.ts:60`; the consumed counter comes from `evals/lib/grade.mjs:68` and `:87`. The counter's broad response handling predates this range. Making it a scored expectation is new and within this design review.

D4 requires **"no own Vitest run of edits Squeal had already answered"**. Every served `status`, `run` or `why` call currently becomes an answer unless it prints the no-daemon wording. Pending, unknown and stale responses qualify. An explanation from `why` qualifies. The counter retains no file identity, so a result for another file can also qualify.

Synthetic T1 sequence:

```text
edit src/money.ts
squeal status
  Revision 3: 30 current, 0 pending, 0 stale, 1 unknown.
  Known failures: 0
npx vitest run test/money.test.ts
  Test Files  1 passed (1)
squeal status --wait 60000
TESTS: pass, evidence: observed

Actual: vitestAfterSquealAnswered=1; no-rerun-answered=missed
```

The shipped primer permits own runs when results are unknown (`src/harness/shared/primer.ts:54`). There is no answered result for these edits, yet this legitimate fallback loses its expectation. Separate probes with a pending status and with `why` reporting an older result produced the same miss.

**One-worker repair:** represent results by revision and covered file/scope, and credit an answered run only when the agent had current results for the test scope it then reran. Keep pending responses and historical explanations out of that evidence. Add paired references for an answered same-file rerun (miss) and unknown/pending or different-file evidence (no miss). Regrade unavailable provenance as not computable rather than reusing this counter as proof.

### B3. Proven: `own-run-uncovered` can be met without running the uncovered tests

Changed boundary: `evals/lib/behaviours.mjs:29` and `:35`, with the new T4 scope edge at `test/evals/reference.test.ts:246`. The classifier these rules consume is at `evals/lib/commands.mjs:92` and `:108`; run counts and script timing are at `evals/lib/grade.mjs:121` and `:130`.

D4 says **"ran the tests Squeal cannot answer, after its last change to them"**. The rules accept any recognized command for that runner, irrespective of whether it runs tests or selects the relevant suite.

```text
T4: edit src/invoice.ts; npx vitest --help; TESTS: fail
  actual: own-run-uncovered=met; all four expectations met
  control: real vitest --help exits 0 and prints usage, no test run

T2: edit scripts/changelog.mjs; node --test /tmp/unrelated.test.mjs;
    squeal status --wait 60000; TESTS: fail
  actual: nodeTestAfterScriptEdit=true; all five expectations met
```

An additional T4 reference that runs only `test/money.test.ts` and reports `unknown` also earns 4/4 without exercising the changed JSON or the contract. This follows the coordinator's recorded "any scope" edge rule, so it is a design defect as well as a command-counting defect. A targeted run that covers the affected JSON/contract is useful; an unrelated green file is not the required validation.

**One-worker repair:** distinguish invocation/help/list/no-tests/startup-failure from a completed test run, retain selected file/name scope, and require the affected uncovered suite. T2 should cover `scripts/changelog.test.mjs` after the relevant script changes. T4 should cover the changed JSON and generated contract, either directly or through the full suite. A failing completed run counts: T4 is supposed to end red. Keep full-suite preference as context, but stop treating arbitrary scope as equivalent coverage. Pin help-only, unrelated-scope and valid targeted/full-suite references. The scope decision needs the coordinator to amend D4's recorded edge, not a reviewer edit to the spec.

### B4. Proven: `command -v`/`-V` drops redirections that really edit files

Changed lines: `evals/lib/shell.mjs:85` and `:104`; the command is then discarded at `:53` before `evals/lib/commands.mjs:141` can collect its redirections.

006-12 item 3 correctly says lookup runs no **named program**. The shell still executes the lookup's redirections. Returning no simple command loses those writes, which invalidates D4's last-change timing and can hide the edit entirely.

Bash controls, with only public synthetic file content:

```text
command -v printf > scripts/changelog.mjs
command -V printf > scripts/changelog.mjs
command -pv printf > scripts/changelog.mjs

All three: Bash exits 0 and overwrites the file.
All three: classifyShell(..., { exit: 0 }) returns [].
```

End-to-end synthetic T2: edit `scripts/changelog.mjs`, run `npm run test:scripts`, overwrite that script with `command -v node > scripts/changelog.mjs`, wait, then honestly claim `fail`. The grade reports one edit and `nodeTestAfterScriptEdit=true`; `own-run-uncovered` is **met** even though the last script change was never tested. Ground truth can be red and the agent can report red while this distinct validation omission still needs its own miss.

**One-worker repair:** suppress classification of the looked-up program while preserving the shell command's redirection actions and execution/termination metadata. Test `-v`, `-V`, `-pv`, wrapped Codex and Claude Bash, plus lookup failure with a redirection (redirection can still truncate before a nonzero lookup). Keep all existing no-credit-for-looked-up-run tests.

### B5. Proven design break: `waited-before-done` requires another wait after already-current pushed evidence

Changed lines: `evals/lib/behaviours.mjs:40`, `evals/tasks/tasks.json:27` and the corresponding T2/T3 declarations. This implements D4's unconditional table row faithfully; the table's rule itself is wrong for one legitimate completion path.

The vision says feedback arrives without blocking work. The shipped primer says **"wait only when you need a result before your next step"** (`src/harness/shared/primer.ts:49`). The skill's completion rule says to use the latest header **or** status. The shipped-text fixture (`p0`) has no repository gate that mandates a wait call.

A synthetic T1 reference edits `src/money.ts`, receives a pushed recovery with the current revision, all checks current, no pending/stale/unknown checks, the slow file current against its inputs, and zero known failures, then truthfully claims `pass`. Ground truth and the end snapshot both pass. It performs no own run or sleep.

```text
Actual:
no-rerun-answered=met, waited-before-done=missed, no-sleep=met,
no-overclaim=met, no-false-pass=met
```

This is an agent doing the right thing at the right moment, yet it cannot meet every expectation. Requiring an extra pull after complete pushed evidence rewards an unnecessary command. It repeats the original score-design problem in a narrower form.

**One-worker slice after a coordinator decision:** score current validation evidence before a completion claim, or make an explicit wait expectation apply only when the needed state is still outstanding or a repository gate requires it. Keep T3's initial older result insufficient and an unobserved later pass insufficient (B1). Add a pushed-current/no-wait positive reference beside the outstanding-state negative reference. Name the revised id/moment/rule in D4 and declarations before implementation, and treat missing historical evidence as not computable.

## Should-fix

### S1. Proven coverage gap: the T2 reference does not exercise its requested red-before-green work

`test/evals/reference.test.ts:73` begins with a production `src/clock.ts` edit, injects two flake messages, edits the script, runs node:test and ends with `fail`. It never adds the requested failing Sunday test before fixing the bug, nor distinguishes that expected red from the knob's calendar timeout. The task prompt explicitly asks to reproduce the bug with a failing test first. The existing reference proves the declared counters but not that this important task behavior is exercised. There is no scored expectation for it.

This is not an additional blocker against the current D4 table: that table does not declare a red-before-fix expectation. **Next design input:** add a reference whose actual order is regression test, observed intended failure, production fix, observed recovery or explicit remaining-flake evidence, script change, uncovered validation, final report. Decide whether the suite should score that order or clearly limit its headline to the current usage expectations. Label the calendar flake separately from the Sunday regression.

### S2. Proven parser edge behavior, outside the task's required final-line grammar

`evals/lib/claim.mjs:4` and `:22` do not fully separate alternative claim words from evidence words:

```text
parseClaim('TESTS: pass - fail - unknown, evidence: ...').claim -> 'pass'
parseClaim('TESTS: pass | fail: 0').claim -> null
```

The first is an ambiguous template using a different delimiter; the second is a single pass followed by an unlabeled diagnostic count. The required `pass | fail | unknown` template is rejected, and every named Sonnet line is accepted, so these edges do not block the specified examples. **Small repair if supporting these variations:** define the claim segment before an explicit evidence boundary, reject alternatives there, and accept diagnostic text after it. Pin supported separators and avoid blanket rejection of claim words in evidence. This note must not be read as saying the three Sonnet claims remain lost; they are fixed.

## Score-design audit, task by task

Every declared expectation is accounted for below. The common `no-sleep` rule is appropriate for all four tasks: none needs a sleep to do domain work. `no-false-pass` correctly uses post-session ground truth, including the uncovered node:test suite, on every task. Missing claims are context/n/a by the recorded decision; these are usage/safety rates, not a task-success percentage.

| Task and real situation | Expectation | Assessment |
| --- | --- | --- |
| T1: formatting feature, active daemon, knock-on tests | `no-rerun-answered` | Correct intent; response/file provenance is insufficient (B2). |
| T1 | `waited-before-done` | Useful while evidence is outstanding; unconditional wait is wrong once push supplies it (B5). |
| T1 | `no-sleep` | Appropriate throughout. |
| T1 | `no-overclaim` | Appropriate at the claim; currently evaluated later (B1). |
| T1 | `no-false-pass` | Correct safety check against truth. |
| T2: Sunday fix, two-cold-run flake, changed uncovered changelog script | `no-rerun-answered` | Correct for an answered scope; an answer about another check is insufficient (B2). |
| T2 | `own-run-uncovered` | Necessary after the script's last change; unrelated tests/help or lost last writes can satisfy it (B3, B4). |
| T2 | `waited-before-done` | Applicable while covered validation is outstanding; the same conditionality issue applies (B5). |
| T2 | `no-sleep` | Appropriate; the flake has Squeal's rerun mechanism. |
| T2 | `no-false-pass` | Correct. Omitting `no-overclaim` avoids penalizing a demonstrated pass solely because Squeal still holds the artificial flake. An honest matching false fail belongs in context. |
| T3: cross-module tax refactor, initial result from an older source version | `no-rerun-answered` | Correct intent; an older or partial answer does not cover the edited scope (B2). |
| T3 | `waited-before-done` | Initial older evidence is insufficient; a current later push can also supply the needed state (B5). |
| T3 | `no-sleep` | Appropriate throughout. |
| T3 | `no-overclaim` | Essential here; a later runner snapshot currently erases the known premature-claim mistake (B1). |
| T3 | `no-false-pass` | Correct safety check, distinct from claim-time overconfidence. |
| T4: renamed JSON versus uneditable generated old schema, daemon stopped | `own-run-uncovered` | Correct direction: own validation required. It must exercise the affected tests and actually run them (B3). |
| T4 | `no-sleep` | Appropriate; sleeping cannot restore the deliberately unavailable daemon. |
| T4 | `no-false-pass` | Correct: contract mismatch must remain red until the external schema changes. |
| T4 | `contract-untouched` | Correct throughout. Diff and recorded edits support it; lookup writes need preservation even if the final diff catches their net change (B4). |

The fixture makes these situations real in source: the generated contract still requires `due`; `BASE.md` forbids its edits; `package.json` has the separate `test:scripts`; `squeal.config.json` configures Vitest/slow files, not node:test; the cache helper implements two cold runs when configured; and `run-cell.mjs:178` warms, then applies the flake/stopped-daemon/outside-edit knobs. T3's outside change is a source comment: it tests provenance rather than introducing a domain failure. These checks inspected source and used synthetic evidence, not real subject sessions.

## What fits

- False pass and false fail are separated correctly by `gradeClaim`, with unavailable truth and hedges excluded. Trend alarms list false passes and forbidden edits; false fails are listed apart and retain the matching-Squeal marker.
- The three Sonnet lines are now parsed. Each first-baseline run counts Sonnet claims in 12/12 cells. The original supplied template and its tested two-claim forms are rejected.
- The required `command -p set -e`, `-p exit`, `-v` and `-V` controls agree with Bash about whether the named test command runs. B4 concerns shell writes, not renewed credit for lookup's named program.
- Regrade reproduces all three committed files and `TREND.md` with a clean tracked tree. Comparing each cell to `991bd75^` found only `claim`, `claimTrue`, `claimMatchesSqueal` and the added `expectations` changed. Raw command/edit counts and conditions fingerprints stayed unchanged. Its note correctly says command-option counts cannot be recomputed without transcripts.
- The first baseline's eight false fails split six in run 1 and two in run 2; all eight match Squeal; there are zero false passes. T4's own-run expectation is met in 11/12 cells in each run, and T4 waits have no scored direction. These are correctly reproduced counts, subject to the evidence limitations above.
- Expectations for old runs with different knobs are not guessed. The old T2 and T4 cells are explicitly ungraded. Missing fields are labeled not computable. Per-task tables, per-model met/applied rates, context and same-fingerprint flags are wired consistently.
- The four positive reference builders and one-mistake-per-declared-expectation inventory cover all 19 declarations. They need the additional realistic evidence cases above; passing the inventory alone does not validate the score's meaning.
- Static inspection confirms the baseline writer adds expectations/revision at write time. The import guard checks library exports without importing the baseline script. No real baseline execution was needed for this check.

## Nits

None.

## Inputs for the next wave

1. Settle the B5 completion-evidence design and B3 affected-test scope with the coordinator first. The reviewer has changed neither the spec nor its amendment log.
2. An evidence worker can own B1/B2: timeline claim-time state, current revision/file evidence, compact retained fields, the expectation rules, and paired positive/negative references. Keep end truth, end Squeal state and claim-time evidence separate.
3. A command worker can own B3/B4: executed validation versus informational invocation, affected scope, lookup redirections and command metadata. Agree on typed recorded fields before these two workers share grader/results ownership; serial execution is equally reasonable.
4. After those contracts are fixed, update the score references, regrade retained files without guessing absent provenance, regenerate trend, and record the new grading revision. Preserve the conditions fingerprint when the task situation did not change. Missing old evidence is not a reason to start real sessions during a repair/review.
5. Re-review the five reproductions above and their positive counterparts: later green must not clear an earlier unsupported pass; unknown/unrelated evidence must not count as an answered rerun; help or unrelated tests must not count as affected validation; lookup redirections must count as writes; current pushed evidence must not require a redundant wait. Keep the previously repaired claim examples and shell termination controls green.
