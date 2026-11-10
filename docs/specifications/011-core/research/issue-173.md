# Preserve failed global setup evidence without making it reusable

Recommendation: retain retrievable evidence for failed global setup while keeping
its outcome local to the worktree. The diagnostic gap is reproduced; the original
browser bootstrap cause is not determined. Existing holds stand. This report
authorizes no implementation.

## Scope and questions

Examined on 2026-11-10: Squeal **0.1.426**, release commit
`c471793472c3eaf5e8a1b8801073a66053159c87`; source checkout
`246cdc1855e08ae28c1803376ee5f8cfa0a1de4e`; Node **24.22.1**,
Vitest **5.0.3**, Vite **8.3.2**. The inspected startup, conversion, execution,
state-sink and log-lookup sources have no diff from that release. The live probe
uses the installed version's absolute bundle, and `--version` returned 0.1.426
for both fixtures. No browser, server or Cezarion environment was started.

| Question | Answer and evidence tag (versions above) |
| --- | --- |
| 1. Can the reported setup state and missing `why` evidence be reproduced? | **verified by experiment**: both isolated fixtures report one current setup FAIL, no stored results, and `runLogUnavailable: "unidentified"`. |
| 2. Are captured child bytes unavailable upstream or lost in Squeal? | **verified by experiment**: both cases are possible. Attached streams survive the Vitest rejection but disappear from Squeal evidence. A wrapper that discards them exposes no streams to Vitest's caller. |
| 3. Does no retrievable log mean no log was written? | **verified by experiment**: no. Each fixture has one crashed run and physical `vitest.log` and `report.json` files, despite `why` returning no run log. |
| 4. Why do the summary and log lose detail? | **read in source code**, Squeal 0.1.426: cause conversion is bounded; `withStartup` replaces the run failure with a summary; the setup sink stores known state without run provenance. |
| 5. What remains unknown about issue 173? | **inferred** from the issue and probe limits: the actual bootstrap failure and whether its wrapper exposed captured bytes are not determined. Its implementation and live environment were not examined. |

## Reproduction and output

Commands from the repository root:

```sh
gh issue view 173 --repo hearsay-tools/squeal --json title,body,comments,url
node docs/specifications/011-core/research/probes/issue-173/run.mjs
node docs/specifications/011-core/research/probes/issue-173/api.mjs docs/specifications/011-core/research/probes/issue-173/.scratch/1794330201628/attached
node docs/specifications/011-core/research/probes/issue-173/api.mjs docs/specifications/011-core/research/probes/issue-173/.scratch/1794330201628/discarded
```

The probe's exact Squeal command prefix is:

```sh
node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.426/dist/cli/squeal.mjs
```

It executes `daemon <fixture-root>`, `--version`, `status --json`,
`why setup.js --include-logs`, and `why setup.js --include-logs --json`.
The README describes the private environment and fixture creation. Each fixture
has one test file, which setup prevents from running. These intentional failures
are research evidence, not a product test-suite failure or pass.

**verified by experiment**, versions above: the host gate immediately before
starting each daemon read **8.03/24 CPUs** and **8.19/24 CPUs**. Before the two
Vitest API probes it read **8.86/24** and **9.32/24**, respectively. No case was
skipped. Both daemon fixtures and both API probes completed; both daemons exited
0 after SIGTERM. The probe did not request a full suite.

Both setup states have this summary:

```text
setup failed: Fixture bootstrap failed; cause: Command failed: node child.cjs (1)
```

Both text `why` calls return:

```text
Results: none stored
Run log: unknown, no stored result, or several, fit the known state
```

The JSON calls return `results: []`, `runLog: null`, and
`runLogUnavailable: "unidentified"`. Each private database has **0 result rows**
and **1 run row**, with `end_state: "crashed"`. The actual `vitest.log` is:

```text
squeal vitest run <run-id>
end: crashed (global setup setup.js failed: Fixture bootstrap failed; cause: Command failed: node child.cjs (1)), <duration> ms

RUN END failed, 0 unhandled error(s)
```

The recorded durations are 111 and 114 ms. The report JSON has the same summary,
empty completed-file and file-error arrays, and no nested error object.

## Where evidence stops

**verified by experiment**, Vitest 5.0.3 / Squeal 0.1.426: the child prints
`CHILD_STDOUT_173` and `CHILD_STDERR_173`, then exits 1. In the attached case,
the raw Vitest API rejection retains both streams on `error.cause`, the numeric
code 1, and both wrapper and cause stacks. None of these stream markers appears
in Squeal's run files, known state or `why` output. This is available error-object
data that Squeal does not preserve, not an absence of subprocess output.

In the discarded case, the child still prints into pipes, but the wrapper creates
a cause with only a message and code. The API rejection has no `stdout` or
`stderr`. Retaining that error in full cannot recover those discarded bytes.
This control prevents attributing every subprocess diagnostic gap to Squeal.

**verified by experiment**, the same versions: the global setup's own
`SETUP_CONSOLE_173` appears on the captured daemon stdout in both fixtures, but
not in either run log. The direct Vitest probe observes the console marker on
process stdout and **zero `onUserConsoleLog` callbacks**. This is a separate
capture gap from error-object conversion.

**read in source code**, Squeal 0.1.426:

- `results.ts:35–78` keeps the outer error stack, but causes keep only message
  and code: three links, first line, 200 characters per cause. It copies neither
  `stdout` nor `stderr` properties.
- `run.ts:88–95` initially retains the rejection and its stack text.
  `startup.ts:105–116` replaces the report's failure with the setup file, first
  message line, code and bounded causes. `writeRunLog` then writes that summary
  and reporter events. The generic reporter formatter can print cause stacks,
  but these probe rejections produce no such reporter error event.
- `sink.ts:146–164` stores a setup outcome as known state with summary,
  fingerprint and location. It supplies no result or producing run to the state
  write. `SetupCheckId` explicitly has no key or stored result.
- `why.ts` seeks the result behind a state and its log. With no such result,
  `why-log.ts:47–78` tries failure-producer evidence tied to a failure key. The
  setup has neither that link nor a test-file key and reaches `unidentified`.
  `--include-logs` cannot repair the missing association.

## Recommendation and limits

**inferred**, Squeal 0.1.426: preserving evidence and retaining reuse semantics
are distinct requirements. C5 explicitly says setup is “never a result under a
key”, so the issue's proposed keyed file-level result is not a settled design.
C6 promises a check's last run log; the measured setup path lacks that link.
C7 governs persistence, C13 governs untrusted runs, and C14 gives each run its own
log directory. V4's fuller run-error cause rule and V8's failed-start rule are
also relevant. Keep the compact summary for push, but make the available setup
evidence retrievable on pull. The coordinator must settle the storage contract.

Untested: the original `test-env-up.sh` failure, browser mode, the incident's
Vitest version, restart/recovery, pruning, concurrency and large-output limits.
Whether the original wrapper retained streams on its thrown cause is **not
determined, because its source was outside this bounded reproduction**. No
claim is made that arbitrary private child pipes can be reconstructed later.

## Sources and artifacts

- [Issue 173](https://github.com/hearsay-tools/squeal/issues/173), fetched with the
  command above; reported Squeal 0.1.426, revisions 34 and 41.
- [Probe README](probes/issue-173/README.md), [runner](probes/issue-173/run.mjs),
  [API probe](probes/issue-173/api.mjs), and
  [captured evidence](probes/issue-173/evidence.json).
- [Pinned Squeal source](https://github.com/hearsay-tools/squeal/tree/c471793472c3eaf5e8a1b8801073a66053159c87):
  `src/runners/vitest/{results,startup,run,reporter}.ts`,
  `src/core/state/sink.ts`, `src/core/types/check.ts`,
  `src/core/status/{why,why-log}.ts`.
- Local `docs/specifications/011-core/spec.md` C5/C6/C7/C13/C14 and `status.md`;
  `docs/specifications/013-vitest-runner/spec.md` V1/V4/V8 and `status.md`, at the
  checkout commit above. No specification or amendment was changed.
