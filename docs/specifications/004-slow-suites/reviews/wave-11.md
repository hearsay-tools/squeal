FAIL f79f00ac1cb0b05ae64747819855d84a4e0896f7

# Wave 11 review: named waits and policy-off unknown claims

One proven blocker, one proven nonblocking documentation finding, no nits. Candidate 0.1.219, rows 004-78 and 006-91, including the coordinator's final parser repair. HEAD matched the requested SHA. Compared against `origin/main` at `349d0c3fb0dcd30a8e6d69c49100ff5cb1a9ba36`; the merge base is `0ff8efd6b63d022b801e00bec373afc34459bbaa`. The tracked checkout stayed clean through verification and external probes. Only this review is committed.

## Verification

Node 24.21.0, Vitest 5.0.3. No `npm run build`, as directed. The independent full suite is the review gate; background Squeal results are not substituted for it.

```text
$ git rev-parse HEAD
f79f00ac1cb0b05ae64747819855d84a4e0896f7

$ npm ci
added 196 packages, and audited 197 packages in 7s
32 packages are looking for funding
found 0 vulnerabilities

$ npm run lint
> squeal@0.1.219 lint
> biome check .
Checked 1467 files in 516ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.219 typecheck
> tsc --noEmit
(exit 0, no diagnostics)

$ npm run check:version -- origin/main
version bump: 0.1.218 -> 0.1.219, ok

$ git diff --check origin/main..HEAD
(no output)
```

`npm ci` also printed the `node-domexception` deprecation and an advisory about six packages' install scripts not covered by `allowScripts`. It exited 0.

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/8ceb3d73-acc4-4897-971d-a1ac0d30de7a

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/8ceb3d73-acc4-4897-971d-a1ac0d30de7a/test/fixtures/scheduler/.tmp/3d7be24b-fc95-4efb-b693-6c364da0ff03/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/8ceb3d73-acc4-4897-971d-a1ac0d30de7a/test/fixtures/scheduler/.tmp/36d56ad3-a000-4a39-9cc7-c5062301f353/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 112196
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  740 passed | 1 skipped (741)
      Tests  6352 passed | 10 skipped (6362)
   Start at  22:41:22
   Duration  922.84s (tests 97%, import 2%)

    Isolate  741 workers spawned · ~146ms startup each (spawn + environment, per file)
             at least ~26.81s faster with isolate: false — reuses workers across files instead of one per file
```

Exit 0. The 740 passed files, 6,352 passed tests and 10 skipped tests match the coordinator's gate (one entirely skipped file).

```text
$ flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4 \
  test/cli/status-wait-paths-slow.test.ts test/evals/a8-load-hold.test.ts \
  test/evals/atomic-measures.test.ts test/evals/atomic-pilot.test.ts \
  test/evals/atomic-regrade.test.ts test/evals/slow-claim.test.ts \
  test/evals/unanswered-squeal.test.ts test/harness/primer-wait.test.ts \
  test/harness/skill-wait.test.ts

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/8ceb3d73-acc4-4897-971d-a1ac0d30de7a


 Test Files  9 passed (9)
      Tests  253 passed (253)
   Start at  22:56:46
   Duration  4.24s (transform 49%, tests 38%, import 13%, worker 1%)

  Transform  transforming modules took 4.00s · 49% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns
```

Exit 0. These are all nine touched executable test files; helper-only changes are exercised by them.

Background Squeal (installed 0.1.199) separately reported failures at revision 0 in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`, both expecting an unobserved run to pass but receiving fail. These exact observations are already documented in `reviews/wave-10.md` and predate this range. No retry was requested. They are recorded separately from the independent gate.

External throwaway probes imported the candidate's source modules without modifying the checkout:

```text
144 formatter/count round trips pass: status, registration, delta; plain/hook JSON; policy off/on; 0.1.218 and legacy wording
217-character CLI named at wait, policy off: 1487/1500 characters
217-character CLI named at wait, policy on: 1484/1500 characters
BLOCKER reproduced end to end, codex: unnumbered plural yields count 1 and claim-true=true
BLOCKER reproduced end to end, claude: unnumbered plural yields count 1 and claim-true=true

24 named CLI cases pass: policy off/on, plain/JSON; mixed pass/fail, slow-only exit 3/outcome slow, running slow failure, current/stale slow failure

20 atomic files, 1639 cells: current regrade changes none
Flags and alarms identical to origin/main: one accepted flag, 32 retained alarms
```

The formatter probe used actual `formatStatus`, `formatRegistration` and news `formatDelta` outputs. For legacy cases it replaced only the shared slow-tier line with the actual `slowTierText` implementation from `98beb8cd` (0.1.216). Six tier states covered zero files, pending, current, stale sources and mixed current/pending/not-run counts. Both policies and plain/additionalContext hook JSON were exercised. The probe files were removed before this commit.

## Blockers

### B1. Proven: the singular fallback accepts an unnumbered plural as a count of one

Location: `evals/lib/slow-claim.mjs:40` (`SINGULAR`), consumed at `evals/lib/atomic-measures.mjs:39`.

D10's amendment requires the evidence to state how many slow files are not current. The coordinator's settled rule at `docs/specifications/006-model-evals/status.md:231` explicitly says "a plural without a number ... state[s] nothing"; only singular definite "the slow file", "the slow test file" or "the slow test" states one.

```text
$ node --input-type=module
import { statedSlowCount } from './evals/lib/index.mjs';
console.log(statedSlowCount('the slow test files are still pending'));
1
```

Expected: `null`. The `test file` alternative cannot finish before plural `files`, so the regex falls back to the shorter `test` alternative; `[^.;,]*?` then consumes ` files are still ` and reaches `pending`.

This changes a measure, not just an exported helper. In both real reference-session harness paths (`graded` -> `pilotRecord`), with a registration at revision 0, an edit, and current revision-1 Squeal evidence showing 28 current checks, two pending checks, one pending slow file and no failures, the claim below scores `claim-true: true` under p0:

```text
TESTS: unknown, evidence: the slow test files are still pending
```

It must score `false`, since it states no count under the settled rule. The independent probe reproduced both Codex and Claude Code. The committed count cases test "the slow files are pending", but omit "the slow test files" and therefore miss the shorter-alternative fallback.

Bounded repair: make singular recognition reject plural noun continuations rather than backtracking to `test`. Add direct count cases and full reference sessions in both harnesses for the unnumbered "slow test files" form; retain the three legitimate singular forms. With a count-bearing current timeline the bad claim must be missed; with an old timeline it must remain missed rather than become not computable. Re-run the focused eval tests, regrade audit and normal candidate gate. No CLI or formatter changes are needed.

## Should-fix

### S1. Proven, nonblocking: the status amendment misstates the regrade tally and arms

Location: `docs/specifications/006-model-evals/status.md:231`.

The new line says 480 `slow-through-squeal` values changed to null "in p0 a2 and a8 cells". A structural comparison of every committed atomic/variant JSON file against `origin/main` finds 460 such changes: 380 true-to-null and 80 false-to-null. They comprise 425 p0 cells, 30 `old-slow-line` cells and five `d8-deny` cells. All 40 `stop-slow` values stay unchanged. The 16 Luna `claim-true` false-to-null changes in the line are correct.

Coordinator-sized fix: correct that one documentation tally and name the policy-off arms. The stored measures and accepted flags are not wrong because of this tally.

## Nits

None.

## What fits

- **Proven: named wait and verdict scope.** `pauseOnlyIds` excludes queued slow files only when they have no own running phase, no open run in their lane and no other worktree's claim. `waitForNamed` computes the verdict over the remaining files, while status and class lines retain the full selection. The 24 direct CLI cases cover both policies and output modes, fast pass and failure, slow-only `outcome: slow`/exit 3, and running/current/stale slow failures that stay in the verdict. JSON always includes `wait.leftForPause`. No changed output names a build command.
- **Proven: primer and skill copies.** The 217-character CLI is named at the wait within the 1,500-character cap under either policy. The short-sentence fold runs before CLI naming is dropped; the 230/240 boundary tests document its accepted reach. The three shipped `references/commands.md` copies are byte-identical; OpenCode ships no fourth skill copy. The selected-file wait and checkpoint distinction from 005-68 remains where it fits.
- **Proven: D10 except B1.** The policy reader matches `buildFixture`'s fixture-plus-variant merge. The implementation follows the coordinator's accepted fast-current approximation: current revision, live daemon, no known failures, and pending+stale+unknown no greater than twice the stated slow count. A known fast failure, fast backlog beyond that allowance, a wrong/disagreeing/missing count, count zero and pre-edit evidence miss. Policy-on behavior and pass/fail/no-false-pass behavior remain covered separately. Historical unknowns become null only after the other computable conditions pass and the retained slow count alone is missing.
- **Proven: formatter compatibility.** All 144 count round trips pass. The coordinator's final fix correctly finds 0.1.218's stale-artifact clause after its own semicolon, and the older `, sources changed since` clause remains supported. Current counts are deducted only for files whose source changes are tested.
- **Proven: committed regrade.** Structural comparison found only the 460 slow-through-squeal nullings and 16 claim-true nullings in measures. Historical evidence refresh additionally supplies 2,416 `slowNotCurrent` fields and 561 `answered` fields from raw cells. No other cell fields change. All 16 claim changes concern valid counted or singular Luna unknowns in a2/a3; none uses B1's plural. A fresh in-memory regrade of all 20 files / 1,639 cells changes nothing. Flags and alarms compare identically with origin/main; the accepted flag list is untouched.

## Inputs for the next wave

Repair B1 on the candidate and request a narrow re-review of the count grammar, the new reference sessions and any regraded measures. Keep S1 as a coordinator documentation correction. Preserve the named wait's split, its `leftForPause` payload and the formatter round trips; they need no rewrite. The requested candidate eval rerun remains the coordinator's release work and was not performed by this reviewer.
