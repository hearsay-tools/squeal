# #246: offline edit, lookup-only restart and a focused wait

Keep the lookup-only hold; separate the reproduced startup behavior from the unreproduced focused-wait timeout before approving a change.

2026-11-19. [Issue #246](https://github.com/hearsay-tools/squeal/issues/246), reported against **0.1.563**. Probe used the installed, version-pinned **0.1.563** runtime, Node **26.13.0**, Vitest **5.0.3**, Linux, **24 CPUs**. One-minute load was **12.95** at inspection, **11.26** before the probe and **10.41** after it. This was a cheap one-test fixture on the shared host; no full suite, benchmark or VM job. The released tag resolves to `b30a7e1d1c03917f3db69af34832ce4f27c1cbf3`; source inspected at `128c9c6dad725411e76d552635a9e2e6245a3514` (also package version 0.1.563).

## Questions and verdicts

| Question | Answer and evidence | Tag / version |
| --- | --- | --- |
| Does a restart queue a test edited while stopped? | **No, reproduced twice.** A passing file edited while stopped was stale after restart, with “nothing queued it (the baseline is lookup-only)”. | verified by experiment, 0.1.563 |
| Does `--check` spend its deadline without a result? | **Not reproduced.** Two waits returned the selected check's pass in **1.456 s** and **1.951 s**, exit **3**, with the file still stale. Each focused run took about **0.2 s**. | verified by experiment, 0.1.563 |
| Does a plain named wait ask a run? | **Yes.** After the first focused wait, it printed “Run asked”, ran the stale file and returned exit **0** in **1.471 s**. | verified by experiment, 0.1.563 |
| Does explicit retry recover the stale file? | **Yes.** After the second focused wait, `retry` queued it (exit **0**, **0.174 s**); the next plain wait returned current/pass (exit **0**, **0.449 s**). | verified by experiment, 0.1.563 |
| Does existing policy allow broad automatic restart catch-up or whole-file demand from `--check`? | C4 preserves lookup-only misses; C15 explicitly excludes source selections and `--check` from the one-run demand exception. C15 separately permits focused execution without making the file current. | read in source code: repository spec and implementation, 0.1.563 checkout |

## Commands and observations

The throwaway [probe](probes/issue-246/probe.py) creates an isolated Git repository with no commits, one passing Vitest test, a one-worker configuration and `baseline.onStart: lookup-only`. It links the checkout's installed dependencies. It changes the assertion from `expect(1).toBe(1)` to `expect(2).toBe(2)`, then to `expect(3).toBe(3)`, only after stopping its own daemon. Coverage and complexity collection are disabled. It never edits the product or uses its daemon.

Run from the repository root (the probe was first run in `research/probes/issue-246/`, then relocated here):

```sh
python3 docs/specifications/011-core/research/probes/issue-246/probe.py \
  ~/.codex/plugins/data/squeal-hearsay/versions/0.1.563/dist/cli/squeal.mjs \
  node_modules
```

Within the fixture, `squeal` below means `node <the pinned squeal.mjs>`; these are the exact CLI arguments:

```sh
squeal --version
squeal start
squeal status --wait 15000 tiny.test.ts
squeal stop
# Offline edit 1 -> 2.
squeal start
squeal status tiny.test.ts
squeal status --wait 5000 tiny.test.ts --check 'serves every named query from its index'
squeal status --wait 15000 tiny.test.ts
squeal stop
# Offline edit 2 -> 3.
squeal start
squeal status --wait 5000 tiny.test.ts --check 'serves every named query from its index'
squeal retry tiny.test.ts
squeal status --wait 15000 tiny.test.ts
squeal stop
```

[Recorded command output](probes/issue-246/results.json) preserves exits, elapsed times and text; local home paths are shortened. Initial unknown-file demand returned current/pass in **1.711 s**. The first offline edit became revision **1**, the second revision **2**. Each focused wait reported a passing check and explicitly said it was not the file's verdict; neither printed “Run asked”. The plain named wait did print it. Every stop returned **0**; the fixture, dependency link and runtime store were removed after the probe.

## Policy, overlap and limits

**Read in source code, 0.1.563 checkout:** [C4](../spec.md#c4-scheduler-and-result-validity) permits no ordinary lookup-only miss to be queued at startup. [C15](../spec.md#c15-named-demand) permits the plain named wait's one request at a stale/unknown key, while source paths and `--check` remain lookup-only for this whole-file request. Its focused-check section requires the selected checks to run separately and treats their answer as different from a current file result. `src/cli/wait/named.ts:82` constructs `WaitAsks(checks.length === 0)`; `src/cli/status-wait-ask.ts` checks stale/unknown state, lack of queued work, lack of another claimant and absence of an earlier request at the key. Existing tests name both contracts: `test/cli/status-wait-ask-scheduler.test.ts` and `test/cli/status-wait-focus-unqueued.test.ts`. These were read, not rerun.

**Read in repository research, 0.1.236:** [daemon-memory.md §3b](daemon-memory.md#3b-what-an-exit-costs-the-next-edit) already records three startup-adjacent edits left stale under lookup-only. The board's follow-up points there. #246 overlaps that startup symptom; it adds the claimed focused-wait timeout. The daemon exit reported in [#163](https://github.com/hearsay-tools/squeal/issues/163) precedes this sequence and was not investigated here.

**Inferred from 0.1.563 evidence:** the issue's suggestion that named waits cannot ask a run is too broad: its actual command includes `--check`, and the plain command succeeds in this fixture. Automatic restart catch-up would change the existing hold and needs a human decision. The timeout could still expose a focused-run scheduling or readiness defect; this small reproduction does not establish its cause.

Not determined: why the incident's focused request never returned within 65.5 s. The probe used a standalone repository with one fast passing test, an intentional stop, shorter waits, no competing fixture work, no harness registration and no monorepo project configuration. It did not recreate an hour-old daemon exit, the original store, incident load, locks, runner lane, retry history or long-running tiers. Its two successful focused waits do not disprove the incident. Further research should capture the focused request/outcome and queue state in that environment, without lifting the source/check wait hold or changing startup policy by implication.
