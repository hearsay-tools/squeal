# 004-79 amendment draft: a continuous slow lane for source-keyed suites; build-output suites leave Squeal's scope

Status: accepted by the human 2026-10-18 (the four confirm points answered below), from the slow-tier doubts session (73e545c7; `research/slow-tier-doubts.md`). Decided there by the human, in discussion, on `research/slow-tier-role.md` (004-74), `research/slow-tier-advisory.md` (004-75) and the issue research (#3, #4, #5, #16, #29, #35):

1. **Squeal does not cover tests of a build output it does not produce.** Such suites (this repository's `test/e2e`, cezarion's `test:package`) are out of scope, named as such, and belong to CI or to the agent after it builds. Every scope-wide friction issue so far sat in this machinery (#3, #16, #35: runs against a missing `dist`; the stale-artifact wording of 004-74 and 004-76). In the measured window no build-output `PASS -> FAIL` against an own baseline was ever recorded; every one of its 152 failures was a missing build, and every rebuild re-run was pass to pass (004-75 §2).
2. **The slow lane stays for files that are only slow or that prepare themselves from the sources** (cezarion's browser specs, the eval fixture's `test/slow`), keyed on sources like every other file.
3. **The slow lane runs continuously by default.** A slow file runs as soon as the fast tests of the current revision are done, whether or not the agent is mid-turn, and its result reaches the agent at its next tool call. The idle-only rule came from the time slow files shared the fast lane (`research/slow-suite-policy.md` 3); 004-18 gave them their own lane and 004-74 §4 measured the fast lane's median unchanged beside it. `"idle"` stays as the opt-out.
4. **004-73 (token ranking) comes off hold and lands with the continuous trigger**, not split: under a continuous lane a long suite is re-keyed before it finishes, so ranking decides which files get a result mid-turn.

## Plain definitions

- **Idle** (today): a slow file waits until the agent has stopped working, a silent Stop or no consumer registered. Mid-turn it stays pending however long the fast lane is quiet. The result arrives with the next prompt.
- **Continuous** (new default): a slow file runs once the fast work of the current revision is done and the revision has been quiet for `slow.quietMs`, mid-turn or not. The result arrives at the next tool call, in the same turn. Same lane, priority and load guard in both.

## Spec text, section by section

**Problem.** Drop the two sentences about build outputs ("since both suites test a build output their static closures cannot see…", "A slow result inherited from another worktree can describe a build this worktree never had"). Add: a suite that tests a build output Squeal does not produce cannot be tied to the code state (vision principle 2), so Squeal names it out of scope rather than promising provenance for an input it refuses to control (goal 8).

**Goals.** 2: "when no edit's fast work is pending at the current revision and the revision has been quiet for `slow.quietMs` (`slow.trigger: "continuous"`), or when the consumer is idle (`"idle"`), or on `squeal run --slow` or `run --all`". 3: drop "declared artifact inputs included". 4: "reaches the agent with its revision: in a continuous lane with the next tool call, otherwise through the idle waiter or the next prompt". 5: "A slow result is inherited as any file's is (001 D5)". 6: drop "current against which revision's build" for "current at which revision". 8: "Squeal never builds anything and covers no test of a build output it does not produce; `setup --check` names such suites as excluded."

**Non-goals.** Add: covering, keying or pre-checking tests of a build output Squeal does not produce (preconditions, declared artifacts, stale-artifact wording). Keep the rest.

**D2.** Trigger (a) becomes: the fast lane of the worktree has nothing pending or running at the current revision and the latest revision is at least `slow.quietMs` old (`slow.trigger: "continuous"`, default); with `"idle"`, today's text (a consumer idle or none registered). The scheduler pumps the slow lane when a fast tier ends or a revision ages past the window, not on `SLOW_RECHECK_MS`. Everything else holds: the lane, one file at a time while fast work is pending and `slow.maxParallel` when the machine is idle, D3's guard, D4's finish-then-discard, (b) and (c), the exit drain (004-29). The 2026-10-18 ranking amendment stands and is built (004-80).

**D3, D4, D10.** Unchanged. D4 gains one sentence: under a continuous lane a mid-turn edit discards the slow file in flight more often than at a pause; the cost stays bounded by one tier, and ranking (D2) puts the files most likely to matter first.

**D5.** A slow file is keyed as any file (001 D3, 003 D3), its declared `inputs` included when the repository names them. Delete: "which for slow files must name the artifact it tests", the no-artifact note, the node:test recorder's artifact purpose (the recorder stays for observed closures), and the last paragraph ("When the artifact is a declared input and the sources behind it changed without a rebuild…").

**D6.** A slow result is inherited under 001 D5 step 4 as any file's: byte-identical key. Delete the artifact condition and its reasoning; keep the claims sentence (001-205) without "may inherit" qualifiers. For the human: this widens inheritance for a slow file with no declared inputs to the same rule fast files already live under.

**D7.** Delete `slow.precondition`, `nodeTest[].precondition` and the pytest equivalent (004-65, 0.1.214). Add `slow.trigger` (`"continuous"` default, `"idle"`), `slow.quietMs` (default 5000, to be set by the code row's measurement on the eval fixture and cezarion), and `vitest.exclude` (globs relative to the worktree root, default `[]`): Vitest test files Squeal does not list, run, key or count, named by `setup --check` and the primer's "not covered" clause, with the meaning `nodeTest[].exclude` and `pytest[].exclude` already have. Every runner then has one exclude glob list; `vitest.excludeProjects` (001 D11, task 001-349) stays for whole projects. A pytest or node:test build-output suite uses its project's existing `exclude`. `slow.rank` stays (004-72). `stop.requireSlowSuite` and `stop.slowWaitMs` stay.

**D8.** Delete the 2026-10-17 skipped-tier paragraph (004-65), the "sources changed since" clause and 004-76's untested-change clause, and D5's note. The `Slow tier:` line ends "Squeal runs them after the fast tests" (continuous) or "when the agent pauses" (idle), then "`squeal run --slow` runs them now" as today. A slow failure's provenance line reads as any file's (001 D6), without "against <artifact> as of revision N". 004-71's quiet-wait clause stays. The primer says when slow suites run per `slow.trigger`, and that excluded suites are not covered (the 001-234 clause now has a list to name).

**D9.** Unchanged in substance. The `stop-slow` wait, 004-66, 004-67 and the exit drain stay. Delete the skipped-tier sentences. Under a continuous lane the wait is shorter, since the tier is already running at Stop.

**Testing.** Replace the artifact and precondition cases with: a continuous lane starts within `slow.quietMs` of the fast tier's end with the consumer in a turn and delivers its result at the next tool call; `"idle"` keeps today's behaviour; an `exclude` glob's files appear nowhere; ranking's cases from 004-73's done-when.

## This repository

`test/e2e` is a build-output suite. 0.1.218 (004-76) declared it `slow.include` and widened its inputs to every plugin; both are undone, and `"vitest": { "exclude": ["test/e2e/**"] }` replaces them. CI and the candidate gate keep running it (`npx vitest run`). The committed `plugins/*/dist` drift check is unchanged.

Cezarion: `test:package` (node:test, `slow: true`) should move to its project's existing `exclude`; the 77 browser specs stay slow and keyed on sources. Whether they run continuous or `"idle"` is cezarion's call once the code row measures their `globalSetup` cost under continuous running (unmeasured; it rebuilds the web bundle when its source fingerprint changed).

## What is deleted, and what it loses

Source files touching preconditions or artifacts: 22 and 24 (`src/core/slow/precondition.ts`, `slow-skip.ts`, `slow-skipped.ts`, `policy-precondition.ts`, `src/cli/run-skipped.ts`, `src/cli/setup/{artifacts,candidates,preconditions}.ts`, `inherit.ts`, `slow-sources.ts`, parts of `slow-text.ts`, `slow-tier.ts`, `stop-slow.ts`, `status-wait-lines.ts`, types). Tests: 19 and 26 files (`test/slow/precondition-*.test.ts`, `slow-artifact*.test.ts`, `run-*-skipped.test.ts`, `stop-slow-skipped.test.ts`, `slow-provenance.test.ts`, …). The README section "Slow tests that need a build" is rewritten as "Slow tests" plus "Tests Squeal does not cover". Spec 005 D3 "Slow tests and their inputs" (the setup wizard's artifact proposals) needs its own amendment from the 005 coordinator: the wizard proposes the runner's `exclude` for a build-output directory and says why.

Lost, on the measured window: nothing caught. Lost in principle: a repository that wanted Squeal to run its package tests after it built now runs them itself or in CI, which is what both repositories did anyway (004-75 §5: 1 of 98 sessions asked Squeal).

## Issues

- #3, #16, #35 (missing build output): resolved by exclusion, not by 004-65's precondition, which is removed; reporters are told to add the project's `exclude` for the package suite. 004-65's rows close as superseded.
- #4: lands as 004-80 (ranking).
- #5, #29 (policy-off wording): unaffected, 004-62 stands.

## Board rows (for the coordinator; numbers are the coordinator's)

| Task | Status | Scope | Done when |
| --- | --- | --- | --- |
| 004-79 this amendment | proposed (docs, coordinator, after the human accepts) | Spec text above into `spec.md`; `status.md` line; `research/slow-tier-doubts.md` marked decided; 004-73 folded into 004-80; 004-65 rows closed as superseded. | The spec reads as amended; the board shows the two code rows. |
| 004-81 build-output suites leave Squeal; `vitest.exclude` | planned, code, one worker, its own candidate, **first** | Remove D5's artifact keys and note, D6's artifact rule, D7's preconditions, D8's skipped and stale-artifact texts and the 004-76 clause, `setup`'s artifact proposals; add `vitest.exclude`; this repository's config as above; README; `setup --check` names excluded globs. | Deleted paths gone with their tests; an excluded glob's files are listed, keyed, run and counted nowhere, and named by `setup --check` and the primer; this repository's `test/e2e` excluded and CI green; version bump; review PASS. |
| 004-80 the slow lane runs continuously; slow files ranked by evidence | planned, code, one worker, after 004-81 | D2 trigger (a) as amended with `slow.trigger` and `slow.quietMs`; the scheduler pumps on fast-tier end and quiet-window expiry; D8 wording per trigger; 004-73's ranking as designed (`tasks/004-72/design.md`). | Scheduler test: fast tier ends, consumer in a turn, slow file starts after `quietMs` with no timer advance (red before); delivery test: its result reaches the next tool call; `"idle"` keeps today's tests; `quietMs` default set from a measurement on the eval fixture and cezarion's browser specs at two loads, the browser `globalSetup` cost recorded; 004-73's done-when; version bump; review PASS. |
| 005-xx the setup wizard proposes the runner's `exclude` for build-output directories | proposed to the 005 coordinator | Spec 005 D3 step 2 ("Slow tests and their inputs"). | The wizard never proposes a slow glob over a build output; it proposes the runner's `exclude` with its evidence. |

Order: 004-81 before 004-80, so the trigger change lands on the smaller scheduler (the precondition check sits in `SlowTier.next()` before the load guard).

## The human's answers (2026-10-18)

1. Inheritance: one rule. D6 drops its artifact condition; slow files inherit as any file under 001 D5.
2. Exclusion: `vitest.exclude` globs, since node:test and pytest projects already have `exclude` and 001-349's `vitest.excludeProjects` is project-level and Vitest-only. No top-level key, no new Vitest project.
3. `slow.quietMs` default 5000; the code row measures and sets the final default.
4. Deletion first: 004-81 lands before 004-80.
