# 011 wave 123: test slots stop capping busy CPUs; a hung beside file is reported

Rows 011-404 and 011-405. Coordinator 4abb5168, 2026-11-19 (the human approved this round on coordinator b99e3c05's card). Two workers in parallel on disjoint seams, one candidate (0.1.570), one review.

Rules for every worker: no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage: grep ALL of `test/` for paths you change and run each such e2e file directly, one at a time, `timeout 900`. Every direct `vitest` run gets `timeout`. Before you report, read `squeal status --wait 60000 <changed-path>...`. Write `~`, never a `/home/<user>/` path; no company or VM host names. Notes in `tasks/<row>/notes.md` with the proposed spec amendment in plain text; the coordinator lands spec and status edits.

## W1: 011-404 test slots stop capping busy CPUs (gh-225)

Use /worker. Shape: slice. Outcome: a background tier (backlog, baselines) takes a permit while the busy CPUs it counts are below the CPU ceiling (`capacity.backgroundShare` of the CPUs, default 0.75) alone; `capacity.hostSlots` no longer lowers that bar. Slots still count test runs: the permit files and each daemon's fair share stay sized by `hostSlots`.

Why: the human, 2026-11-19 (021 `status.md`): slots acting as a busy-CPU bar is not intended. Evidence: `021-remote-store-and-execution/research/cpu-ceiling-measured.md` (hostSlots 6 made the bar 6 busy CPUs on a 24-CPU host). Read 021 spec D18, 011 spec C10 Size and "A pool wait is told", `research/broad-change-throughput-2.md` section 4.

First edit: `src/core/capacity/cores.ts` `gatedPermits`, background branch: the limit is `background.ceiling`, also when `busy` is unread (then the marks' cores count against it). Then `ceilingRefusalLine` (`background.ts`) loses its test-slots clause, and every reader that shows the bar follows: `src/core/ps/host.ts`, `src/core/runner-host/remote/admission.ts`, the pool wait facts (`src/core/scheduler/pool-wait.ts` where it names the bar; its "N of M test slots" count stays). Leave the checkpoint branch (`cores < hostSlots || grants < hostSlots / 2`) unchanged; say in notes whether any text still calls slots a CPU bar. Second part (021-19 recommendation 4, agreed with spec 021's coordinator 585446dc): the daemon logs one refusal line per refusal episode, not one per look (`pool.ts` `#logRefusal`; 490,833 lines in 4.5 days on this host): the first refusal of a waiting tier logs, later ones stay quiet until a permit is granted or the wait ends; the episode's end may log one line with its length.

Owns: `src/core/capacity/**`, `src/core/ps/host.ts`, `src/core/runner-host/remote/admission.ts`, `src/core/scheduler/pool-wait.ts`, their tests. Leave alone: `src/core/scheduler/{overrun,yields}.ts` (W2), spec files.

Done when: a test with `hostSlots` 6, ceiling 18 and 10 busy CPUs grants a background permit (fails before the change); one at 18 busy refuses; the refusal line names the ceiling only; 100 refused looks in one wait log one line; existing checkpoint gate tests unchanged and passing.

## W2: 011-405 a hung beside file is reported (N1 of `reviews/0.1.567.md`)

Use /worker. Shape: repair. Outcome: when the tier running beside an overrunning one also passes its own overrun threshold, status, the named wait and the late line report its files as overrunning, as they report the first tier's. No third instance opens: at most two tiers per lane, as now.

Read: `reviews/0.1.567.md` N1, `-r2.md` and `-r3.md` on 011-399; spec 011 C4 step 5 and C6 (overrun facts); `tasks/wave-122.md` W4.

First edit: `src/core/scheduler/overrun.ts` `overrunAt` returns `null` for `tier.beside === true`, which serves two purposes. Split them: one function says when a tier's files are reported as overrunning (beside tiers included), another says whether its lane may open the next instance (`overrunLanes`, beside excluded as now). Then the publish path in `yields.ts` (`Overruns`) uses the first for the facts.

Owns: `src/core/scheduler/{overrun,yields,yield-waits}.ts`, the status overrun facts and their texts where they need a change, their tests. Leave alone: `src/core/capacity/**` (W1), spec files.

Done when: a test holds the original tier and its beside tier past both thresholds: both tiers' files appear in the published overruns (text and JSON), there are still exactly two tiers in the lane, and no stored result changes. The 011-399 tests pass unchanged.
