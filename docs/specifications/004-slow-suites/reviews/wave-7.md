# 004 wave 7 review

## Verification

Candidate `cand/0.1.202`, pinned to `512eb255e6d2664da0b5bb617c1c6cc76b211845`.
Range `506d9955..512eb255`: 004-62 and its coordinator build/version commit.
HEAD matched the pin; the tracked tree was clean before verification and after the build.
Node `v24.21.0`. The independent reviewer full run was queued under the shared host lock, then withdrawn at the parent's explicit direction, as detailed below. No Squeal checkpoint substitutes for it.

```text
$ git rev-parse HEAD
512eb255e6d2664da0b5bb617c1c6cc76b211845
$ npm ci
added 196 packages, and audited 197 packages in 11s
found 0 vulnerabilities
exit 0
$ npm run lint
> squeal@0.1.202 lint
> biome check .
Checked 1352 files in 604ms. No fixes applied.
exit 0
$ npm run typecheck
> squeal@0.1.202 typecheck
> tsc --noEmit
exit 0
$ npm run build
> squeal@0.1.202 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.202 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0
$ git status --short
(no output)
```

`npm ci` warned about deprecated `node-domexception` and six install scripts outside `allowScripts`; installation and the build succeeded. All four committed plugin trees reproduce without drift. No runtime dependency or key-format change.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Not run: waited for the shared-host lock; withdrawn before acquiring it.
exit 143 (waiting flock terminated, no reviewer Vitest child started)
```

**Independent full suite: unverified.** After about twelve minutes queued, the parent explicitly directed this reviewer to stop waiting and finish: B1 already makes this candidate FAIL, the candidate is being repaired, and its repair gate is queued. The owning 001 coordinator's 0.1.201 gate was progressing normally; a full run on this host takes about fifteen minutes. The reviewer terminated only its own waiting `flock` process. This environmental/authorized check omission is not a finding against the candidate, and no independent full-suite success is claimed.

For context, the parent supplied this result from its earlier gate on the exact pinned candidate. It was **not independently reproduced by this reviewer**:

```text
Coordinator-reported, 512eb255:
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  667 passed | 1 skipped (668)
     Tests  5691 passed | 10 skipped (5701)
Duration  886.75s
exit 0
```

Squeal separately delivered two baseline failures at revision 0: `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. They are outside the changed files and are the worker's already-named load-sensitive pair. This reviewer did not rerun them alone or establish their cause; attribution here is unverified, not a new wave finding. That incomplete baseline is not the independent run or a full-suite checkpoint.

The changed guidance tests also pass independently on the clean pinned candidate:

```text
$ npx vitest run test/harness/primer-slow-policy.test.ts test/harness/primer-coverage.test.ts test/harness/skill.test.ts --maxWorkers=1
Test Files  3 passed (3)
     Tests  56 passed (56)
Duration  5.39s
exit 0
```

Discriminating checks:

```text
$ npx tsx docs/specifications/004-slow-suites/research/probes/issue-5/probe.ts
stop.requireSlowSuite: false (policy read: false, stopSlowWaitMs: null)
  Primer: this repository does not require them before you finish
  Header: Squeal runs the pending ones when the agent pauses and has not queued the rest
stop.requireSlowSuite: true (policy read: true, stopSlowWaitMs: 120000)
  Primer: this repository requires them before you finish ... and Stop waits for them
  Header: Stop waits up to 2 min for them or holds the agent once
exit 0
```

The probe output above is excerpted; both Claude Code and Codex forms had the matching policy text. It starts no daemon and queues nothing.

A private detached worktree at the base `506d9955` received only the candidate's three changed guidance test files. Its product and installed skill text stayed at the base. The focused negative control used the candidate's installed dependencies:

```text
$ npx vitest run test/harness/primer-slow-policy.test.ts test/harness/primer-coverage.test.ts test/harness/skill.test.ts --maxWorkers=1
Test Files  3 failed (3)
     Tests  17 failed | 39 passed (56)
Duration  6.78s
exit 1 (expected negative control)
```

All eight new policy cases fail on the base, including both values in Claude Code, Codex, Pi and OpenCode. The two policy branches, changed Codex folds, and skill/reference wording assertions detect their predecessors. The new unchanged-line and copy-parity invariant cases pass on the base: they are useful invariants, not evidence of the regression being absent. W2's literal “each new test fails on the base” is therefore not true of those invariant cases; the behavior regressions do fail.

A second private two-case probe imported the pinned candidate's Pi/OpenCode entry points by absolute path, with the unchanged repository/store fixtures. For each harness it registered a repository with `stop.requireSlowSuite: true`, `slowWaitMs: 120000`, passing fast evidence and one queued slow file. It checked that the primer promised `and Stop waits for them.`, then awaited the actual settle/Stop call without supplying any slow result. Both calls returned the immediate policy hold, with the slow file still queued:

```text
$ npx vitest run test/harness/reviewer-004-63.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration  3.92s
exit 0
```

This probe deliberately establishes the mismatch in B1; its passing assertions do not mean the promise is correct. All private probe files and the detached negative-control worktree were removed. The candidate's product and tests were not modified.

## Verdict

**FAIL `512eb255e6d2664da0b5bb617c1c6cc76b211845`: 1 proven blocker, 1 plausible should-fix, 0 nits.**

Issue #5's optional-completion behavior is corrected. The remaining blocker is narrower: the newly added policy-on primer makes an untrue Stop promise in supported harnesses, contrary to W2's explicit sentence/Stop check and D9's fallback. The existing runtime enforcement remains intact.

## Blockers

### B1. Proven: the new policy-on primer promises a wait where Pi and OpenCode can only hold once

Location: `src/harness/shared/primer.ts:188`; pinned by `test/harness/primer-slow-policy.test.ts:75` for every harness.

W2 requires “each sentence is true under its policy value in every harness, and Stop does what each says.” D8's new “Stop waits for them” explicitly refers to D9, whose fallback is a hold when no waiting entry is known to run. The new unconditional ending drops that fallback.

Pi's `src/harness/pi/run.ts:103` documents that it has no waiting Stop entry; `settle` calls `stopTurn` with `harness: "pi"`. OpenCode's `src/harness/opencode/bridge-turn.ts:105` uses the same fallback. Neither ever runs a waiting entry. A policy-on session with pending slow work gets an immediate continuation/hold, rather than a Stop that waits for the tier to settle. The independent two-case probe above proves it on this candidate; the existing Pi regression at `test/harness/pi/run.test.ts:136` also pins this behavior. Claude Code/Codex can take the same fallback before a waiting entry is recorded.

The header already tells the truth: “Stop waits up to … for them or holds the agent once.” This is a newly false assertion in changed guidance, not a request to change the pre-existing runtime or expand this wave's ownership.

One-worker repair: qualify the shared primer's ending, for example “and Stop waits or holds you once”, preserving the required before-done command and the optional branch. Update the text assertions for both policy values and all harnesses; keep the primer within `PRIMER_CAP_CHARS`. Rebuild the committed bundles through the coordinator. Do not add waiting entries to Pi/OpenCode or change Stop policy to make prose true.

Done when the required primer describes both actual enforcement paths, the four-harness tests pin that truth, and the policy-off primer still names no slow-tier completion requirement.

## Should-fix

### S1. Plausible: step 4's “otherwise” can attach to the inner “while”

Location: `plugins/claude-code/skills/squeal/SKILL.md:15` and its Codex/Pi copies; pinned in `test/harness/skill.test.ts:103`.

“If the last one says `Stop waits`, the repository requires them: while one is not current, run …; otherwise say how many are not current” admits two readings. The intended branch is the outer policy test. A nearby reading attaches “otherwise” to the `while`, making the count instruction say “report zero after completing required runs” and leaving the policy-off action implicit. The final “current or counted” criterion and `commands.md` help recover the intended meaning, and the optional primer is explicit. No agent misreading was observed, so this is not blocking.

One-worker wording repair: make the outer branches grammatical peers, such as “If …, run … until every slow file is current. Otherwise, say how many are not current.” Keep all three copies identical and within the existing 5000-character skill budget (the current body has only five characters spare). Update the exact wording assertion. This can ride with B1.

## Nits

None.

## What fits

- **Proven, D8 and issue #5:** `coverageOf` adds only `policy.stop.requireSlowSuite` to the primer input; absent defaults to off. Both branch strings flow through all four harness entry points. Policy-off guidance states slow coverage is optional and gives `run --slow --wait 60000` as an explicit action rather than a completion gate. Policy-on keeps the required command and current-line exception.
- **Proven, unchanged policy/enforcement:** the only changed `src/` files are `coverage.ts` and `primer.ts`. Stop, `slowTierText`, quiet-wait output, scheduling, explicit `run --slow`, and policy readers outside the primer input did not change. The issue's runtime queue behavior is preserved.
- **Proven, skill/header seam:** `slow-text.ts:138` includes `Stop waits` under the enabled policy in every rendered state, even all-current and no-files-listed. Off, it emits the idle/not-queued/mixed ending without that marker. Therefore the marker correctly distinguishes policy values. Contrary to W2's suggested all-current case, this candidate's renderer does not omit the policy ending when every slow file is current; either way there is no remaining slow file to run. The skill's loop and claim condition already cover that state.
- **Proven, claim rule:** both skill and reference require current slow-tier evidence before a slow-pass claim, under either policy. The off primer states it directly; the on primer retains the current-line exception and the required command. Optional completion is not a pass claim. `evals/lib/rubric.mjs:41` and `currentBeforeClaim` still require current evidence for a pass claim; an unknown/no claim remains inapplicable. `slow-through-squeal` additionally scores an answered explicit slow/full request and current evidence, only when a claim exists. No evaluator or rubric changed. The next atomic tier must measure any change in claim frequency; this code review does not predict model behavior or claim that those evals ran.
- **Proven, budgets and copies:** the existing folding order still keeps representative coverage lists and long command paths within 1500 characters. Losing node:test project names in the Codex mixed-suite case is the designed counted-project fallback, not a new runner omission. The skill/reference copies agree; the build reproduces all bundles and manifests at 0.1.202.

## Inputs for the repair and next review

1. Repair B1 in the shared wording and tests; S1 is a small optional companion. No runtime policy, scheduler, Stop hook, evaluator, key pin, board or status edit belongs to the worker repair.
2. Preserve both policy branches, the every-current exception, the slow-pass claim rule, all naming forms, caps, and byte-equal skill/reference copies. The coordinator owns bundle/version work.
3. Re-review the wording delta and its assertions against D9's waiting and immediate-hold paths. The policy-off behavior and existing scheduling do not need redesign.
4. The independent full suite was not run, at the parent's direction after the lock wait; preserve that limitation and distinguish it from the supplied coordinator result. The repaired candidate needs its own required gate and narrow re-review. Node 22 and macOS are unverified by this review.
