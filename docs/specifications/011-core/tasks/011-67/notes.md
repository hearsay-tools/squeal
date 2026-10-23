# 011-67: a failure recorded under load names its load retry

Wave 18 W2, 2026-10-23, from main e051dfc1a (0.1.270). gh-52, guidance only: 011 C5 is unchanged.

## What changed

A known failure that meets all three conditions names its load retry after its recorded facts:

- its run was recorded at or above one load per CPU,
- no retry was asked at its key,
- the surface knows the failure's test file.

```
recorded 3 h ago in this worktree at revision 4, load 3.33 per CPU when it ran; no retry asked at these inputs; `squeal retry src/auth.test.ts --reason load` runs it once more when the one-minute load average is below the CPU count
```

The failure stays counted. Nothing is asked or queued. The text is a read.

| Surface | Where | Command | Path |
|---|---|---|---|
| `squeal status` | `format-status.ts`, the `recordedText` call | `statusCommand(env)` (as before) | `fromBase(options.base, testPath)`: from the cwd |
| registration header | `delivery/format.ts`, the `recordedText` call | the hook's `command` | root-relative, as the other delivery commands |
| `squeal why` | `format-why.ts` `recordedLines`, under the known state | `statusCommand(env)`, passed by `src/cli/main.ts` | `fromBase(baseOf(root, cwd), testPath)` |

## Seam map

- `recordedText(facts, here, now, words)` (`src/core/retry/text.ts`) builds the line. `words` is new and required: `{ command, path }` (`RetryCommandWords`). Making it required means a future caller cannot forget it.
- The threshold is `loadAllows` (`src/core/retry/load.ts`), applied to one CPU's share: `loadAllows({ oneMinute: loadPerCpu, cpus: 1 })`. The stored load is `oneMinute / max(1, cpus)`, so "at or above one per CPU" is the same test as a `load` retry's wait, `oneMinute >= cpus`. There is no second constant.
- `why` had no recorded facts before. `why.ts` now fills `WhyReport.recorded` with `withRecorded(store, worktreeId, [knownState], revision ?? 0)`. This is the producer lookup that status and registration use, so the three surfaces state the same facts. `revision` only fills `observedAt` when the state has none. The recorded facts do not read it.
- `why --json` carries `recorded`: the facts only, never the command. The command depends on the reader's shell and cwd.
- The load line in `replaced-failures.ts` (`loadText(loadPerCpu)`) is not changed (coordinator, request 9b4a5a91, item 4). It prints only for REPLACED entries in `squeal failures` and `why`. A later PASS replaced those failures, so no retry applies.

## Decisions the spec did not settle

- **Wording.** The clause comes after `no retry asked at these inputs`. So C5's line format (`Recorded … ; retry asked … | no retry asked at these inputs`) stays a prefix, and existing `toContain` checks and readers keep matching. The words are factual (spec 001 D6) and follow next-step's "`squeal retry a.test.ts` runs it once" and `squeal retry`'s own "runs once more when the one-minute load average falls below the CPU count".
- **Rounding.** A run at 0.995 to 0.999 per CPU prints `load 1.00 per CPU` and names no command, because the stored value is below the threshold. I chose to accept this.
- **Path quoting.** Paths are not quoted, as in next-step's commands. A test file path with a space would print a command the shell splits.

## For the coordinator and later rows

- **Spec text.** C5's consumer-view sentence gives the line's format and ends at `no retry asked at these inputs`. An amendment could add: "at or above one load per CPU, with no retry asked, it then names `squeal retry <file> --reason load` (row 011-67, gh-52); the failure stays counted and nothing is queued." Spec text is not this row's.
- **Evals (006).** `test/evals/retry-texts.ts` `INHERITED` is a hand-written registration for the reference sessions. The `CALENDAR` timeout scenario uses load `2.40`. Squeal now adds the load retry command to that line, so the reference text no longer matches the real output. The scenario measures whether the agent asks a load retry, and the text now names that retry. Whether the references and the measure follow is 006's decision.
- **Not covered.** A FAIL delivered as a transition (PASS -> FAIL) does not carry recorded facts, so it names no command. Its timeout note (`next-step.ts`, "under that load it may time out again") is a separate path.
- **/quality candidates.** Two different functions are named `loadText`: `retry/text.ts` takes a `HostLoad`, and `status/replaced-failures.ts` takes a load per CPU. The per-CPU phrase is also written inline in `recordedText`. `format-why.ts` is now about 385 lines (it was 350, already above the guide).
