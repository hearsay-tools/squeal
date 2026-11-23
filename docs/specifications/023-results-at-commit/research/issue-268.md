# Issue 268: a fresh red failure with an unstaged file-level error

Recommend correcting the blocking error's explanation and bringing the mixed-error evidence policy to the human. The classifier reproduces the reported verdict on 0.1.600 and current 0.1.605. Automatically accepting the assertions would change the existing rule that every red failure must qualify; this experiment does not establish that the ACP error is harmless.

Research on 2026-11-23, bounded triage reproduction for [#268](https://github.com/hearsay-tools/squeal/issues/268). Owner: spec 023 D5.5 and D5.6. No product, spec, status, skill or board changes.

| Question | Finding and evidence |
| --- | --- |
| Can the mixed-error verdict be reproduced cheaply? | **verified by experiment**, 0.1.600 and 0.1.605: three assertion failures plus one unstaged file-level error produce `not comparable`, the exact reported rerun reason, and exit 3. |
| Does `location: null` cause it? | **verified by experiment**, both versions: no. Adding a source location to the unstaged error leaves the verdict unchanged; removing locations from staged assertions still allows proof with a supplied green pass. Missing execution `stage` is decisive when no `phase` or timeout metadata classifies the error. |
| Does `--red-error` help? | **verified by experiment**, both versions: matching `ACP input/output transport closed` cannot override `unstaged`. It works in a control where that error records `phase: after-tests`. |
| Why does a fresh run suggest refreshing stored evidence? | **read in source code**, both versions: the classifier receives only `SideEnd`, not run/store provenance, and returns one fixed `UNSTAGED` reason. The CLI passes `redFile.end` despite having `from` and `stored` separately. |
| Was the full ACP incident replayed? | Not determined by a live replay: no external checkout, mock child, full CLI proof or green test run was started. The issue reports three fresh runs; those runs were not independently verified. |

## Experiment and limits

Exact commands from the repository root:

```sh
gh issue view 268 --repo hearsay-tools/squeal --json title,body,url
node --disable-warning=ExperimentalWarning research/probes/issue-268/probe.mjs > research/probes/issue-268/result.json
git diff squeal--v0.1.600 HEAD -- src/core/proof/evidence.ts src/core/proof/verdict.ts src/core/text.ts
git diff squeal--v0.1.600 HEAD -- src/cli/proof-files.ts src/cli/proof-side.ts src/runners/vitest/results.ts
git diff squeal--v0.1.600 HEAD -- src/runners/vitest/run.ts src/core/code/gate/evidence.ts
```

The commands above record the original experiment paths. Before landing, the coordinator moved the throwaway files to `docs/specifications/023-results-at-commit/research/probes/issue-268/` as the triage brief requires. From the repository root, replay with `node --disable-warning=ExperimentalWarning docs/specifications/023-results-at-commit/research/probes/issue-268/probe.mjs squeal--v0.1.600 5b30ee04d`.

All three source comparisons were empty. The probe ran at `2026-11-23T01:03:38.947Z` on Node `v26.13.0`, with load averages `9.68, 4.98, 4.75` and 16 available CPUs. The one-minute load was below the brief's skip threshold. The direct probe took approximately 0.06 seconds wall time and exited 0; its reported proof exit codes below are classifier outputs, not the probe process's exit. This was a small local experiment, not heavy or isolation work.

Examined commits:

- Release `squeal--v0.1.600^{commit}`: `e9c4a490cf2ebd2cf5565dfb207fb8c548905648`.
- Current `HEAD`, version 0.1.605: `5b30ee04dd8d9e422118b2785b827cc308f906e4`.

The probe imports the actual source classifier from each commit after stripping TypeScript types, without copying its logic. It constructs complete error records matching the issue's reported kinds. The issue's trimmed JSON omits `stage`; the three assertion records in the probe use `stage: body`, consistent with the reported `kind: assertion`. Names and assertion messages are synthetic. The ACP error text is quoted from the issue. Its time relative to the assertions is not established by the JSON; the gate places file-level errors first regardless of timing.

**verified by experiment**, both versions, identical outcomes:

| Input | Verdict | Proof exit |
| --- | --- | --- |
| Three assertions plus unstaged ACP error, green unread | `not comparable`, exact reported refresh advice | 3 |
| Same, supplied green pass | Same | 3 |
| Same with matching `--red-error` | Same | 3 |
| Assertions alone, supplied green pass | `proven` | 0 |
| Unstaged ACP error alone | `not comparable`, same advice | 3 |
| ACP error last instead of first | Same | 3 |
| ACP error gains a location only | Same | 3 |
| Assertions alone lose their locations, supplied green pass | `proven` | 0 |
| ACP error records `phase: after-tests` | `red for another reason`: hook or teardown failed | 3 |
| That phase plus matching `--red-error`, supplied green pass | `proven`, labelled red on a thrown error with ACP text | 0 |

The passing green sides in this table are hypothetical controls. Nothing here proves that the reported test passes on HEAD or that its proof should be `proven` in a full run. No repository test suite was run or claimed passing. The session's Squeal skill was read and `squeal checks` inspected before the experiment; the command listed default background tests and excluded e2e, typecheck and build.

## Source explanation

**read in source code**, 0.1.600 and unchanged in 0.1.605:

- `src/core/proof/evidence.ts:74`: `recordedKind` checks phase and timeout, then returns `unstaged` for an absent stage. It never checks source location. `errorKind` explicitly keeps `unstaged` even when `--red-error` matches.
- `src/core/proof/verdict.ts:48`: `UNSTAGED` is the generic refresh reason. `redCounts` requires every failure to be assertion/thrown evidence. `redVerdict` returns `not comparable` when the first disqualifying kind is `unstaged`; no ACP text enters that reason. D5.6's `proofExit` returns 3 for this verdict.
- `src/cli/proof-files.ts:77`: classification receives the end record only. `src/cli/proof.ts:210` selects qualifying red files for green work. This explains why a rejected red side can leave green absent.
- `src/cli/proof-side.ts:230`: stored failures lacking stages are already refused for reuse. A fresh failure can still have the same missing metadata, so the generic refresh advice does not distinguish a record a rerun can repair.
- `src/runners/vitest/run.ts:231`: module and attributed unhandled errors go through `toCheckError` without `withStage`; `src/runners/vitest/results.ts:43` does not add stage or phase. Test-case errors do receive `withStage` at line 202. Fresh file-level errors therefore have a source path to missing stage, independently of old storage.
- `src/core/code/gate/evidence.ts:57`: file errors become `(file-level error)` and precede failed test cases. Array position is not an event timeline.

**inferred**, from those sources and the experiment: rerunning identical fresh evidence cannot repair this verdict. The reporter's three identical runs are consistent with that mechanism. The raw ACP event was not observed here, so its exact attribution path and claimed post-assertion timing remain unverified.

## Decision and open questions

The human must choose whether a located/staged assertion may qualify a mixed red run despite another file-level error, or whether conservative rejection remains with an accurate reason naming the error and missing execution metadata. D5.5 explicitly keeps hook/setup/import/collection/timeout failures distinct, so a mixed-run acceptance rule needs a decision rather than a silent implementation inference. Merely suggesting `--red-error` would be ineffective for the reproduced unstaged case under current code.

Still open: the full ACP incident's green result, whether Vitest exposes reliable phase data for this native child error, and whether its timing can establish that it is secondary. These require a separate authorized implementation or integration investigation; no fix is proposed as proven here.

Sources: the linked issue; spec 023 `spec.md` D5.5/D5.6 and `status.md`; the source paths above at the two exact commits; `test/proof/red-evidence.test.ts` (read only, explicitly tests unstaged rejection and the `--red-error` exclusion); [probe](probes/issue-268/probe.mjs) and [captured output](probes/issue-268/result.json).
