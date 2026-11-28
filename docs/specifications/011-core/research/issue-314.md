# #314: browser slot after remote refusal

Recommendation: keep #314 open for lifecycle diagnosis; do not assume the cleanup lacks a `finally`.

Examined 2026-11-28: Squeal **0.1.667**, commit `7b7e595db88e3440606f7c073d2c5e567994836b`, Node **v26.13.0**, Vitest **5.0.3**. [Issue #314](https://github.com/hearsay-tools/squeal/issues/314) reports local **0.1.665**, remote VM **0.1.640**, revision 55. The actual remote runner-host binary was not inspected. Scope: 011 C4/C6/C10/C13/C15 and 026 D8/D10/D12, with their status logs.

| Question | Finding and evidence |
| --- | --- |
| Does ignored-input refusal alone leak the browser slot? | **Verified by experiment, 0.1.667:** no leak in the focused component probe. The real remote lane refused a locally present git-ignored input before execution, the real scheduler released the SQLite `maxParallel: 1` slot, and the next named browser file became current without restart. |
| Is the incident reproduced? | **Not reproduced, because** the bounded probe did not produce the wedge. It uses fake adapters and in-process transport, separate scheduler and remote fixture roots, two files, and one scheduler. It does not replay the live daemon, Agent37 connection, 100-file workload, other worktrees or incident timing. |
| Is a release path absent? | **Read in source code, 0.1.667:** `Scheduler.#fly` releases `slow?.slot` after recording and again in `finally` (`scheduler.ts:1616,1626`). `SlowTier.#launch` releases a slot when no flight starts (`slow-tier.ts:444`). The four principal files below are unchanged from the 0.1.665 release tag. |
| What remains uncertain? | **Inferred, 0.1.667:** a flight could remain awaiting work before reaching cleanup; alternatively another worktree could hold the shared slot. Neither is established by this probe or the issue excerpt. The reported `0 running` does not identify the OS lock owner. |

## Experiment and commands

Host admission checks: `uptime` and `getconf _NPROCESSORS_ONLN` returned one-minute load **0.98 / 16 CPUs** at 12:55:44; immediately before the probe, `uptime` returned **0.48** at 12:57:17. No cloud was created and no full suite ran. The session Squeal skill was read; `squeal checks` reported the default tests after each edit. This documentation probe is outside their configured paths, so it ran directly with one worker.

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-314/vitest.config.ts docs/specifications/011-core/research/probes/issue-314/refusal.test.ts --reporter=verbose --silent=false
```

Exact probe output (runner banners omitted):

```text
{"afterRefusal":{"attempts":["test/a.test.ts"],"failure":"remote box refused (git-ignored input ignored.js exists locally and is not synced to remote); not run here (whenLost \"not-run\")","heldPermits":0,"activity":null,"remoteRuns":0,"localFallbackRuns":0}}
{"afterNextRequest":{"attempts":["test/a.test.ts","test/b.test.ts"],"secondCurrent":true,"heldPermits":0}}
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Start at  12:59:07
   Duration  2.14s (transform 73%, import 15%, tests 12%)
```

Exit 0. The corrected probe also passed once in 2.02 s before enabling visible console output. Initial probe wiring used `lanes: ["all"]`, but that internal API expects expanded tier names; it ran locally and failed the refusal assertion. Corrected to `["group"]`; the recorded runs assert both zero remote test executions and zero local fallback executions for the refused file.

```sh
git diff squeal--v0.1.665 HEAD -- src/core/scheduler/scheduler.ts src/core/scheduler/slow-tier.ts src/core/slow/slot.ts src/core/runner-host/remote/lane.ts
```

Output empty, exit 0. This compares those files only; it is not a run of the entire 0.1.665 build.

Final affected check: `squeal status --wait 60000 docs/specifications/011-core/research/issue-314.md docs/specifications/011-core/research/probes/issue-314/refusal.test.ts` returned `No verdict`: no configured runner lists the probe and no test closure holds the findings. Worktree: zero known failures, 2 of 2,351 test files unknown. Biome ignored both probe source files (`Checked 0 files`); no lint pass is claimed.

## Sources and next evidence

- [Probe and reproduction instructions](probes/issue-314/README.md).
- `src/core/runner-host/remote/lane.ts:726-757,1023-1075`: the refusal status and `{ refused }` outcome become a crashed report with no completed files under `whenLost: "not-run"`.
- `src/core/scheduler/scheduler.ts:1560-1640`: the flight awaits execution, recording and commit-report update before its first slot release; its `finally` releases again. `src/core/scheduler/slow-tier.ts:418-445` owns pre-flight cleanup.
- `src/core/slow/slot.ts:72-124`: SQLite exclusive locks hold group permits; `release()` closes the connections, and process exit also frees them. `src/core/state/slow.ts` / `slot-now.ts` and `test/scheduler/slot-words.test.ts` distinguish a presently held slot from an old published wait.
- `docs/specifications/011-core/status.md` and `docs/specifications/026-tiered-and-cloud-execution/status.md`: existing lifecycle changes and 026-24's ignored-input refusal, shipped in 0.1.634.

On recurrence, preserve the slot holder's PID/worktree and files, daemon phase/flight state and refusal-to-recording logs before restart, including other worktrees sharing the slot. That evidence can distinguish an unreleased local flight from another live holder. No product change is authorized by this finding.
