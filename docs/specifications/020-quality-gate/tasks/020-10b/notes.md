# 020-10b notes: child-process coverage in the gate and the daemon

Worker 919b645c, 2026-11-10. Spec D12 items 6 and 7, on 020-10a's collection. For a reviewer and whoever continues.

## Seam map

- **Gate, policy.** `gate/policy.ts` `BasePolicy.children` is `coverage.children` at the merge base. It is read without `coverage.enabled`, because the gate never reads the `enabled` keys (D1) and always collects coverage.
- **Gate, collection.** `cli/code-gate.ts` passes `children: policy.children` in `CollectOptions`. `collect.ts` gives both runners `coverage.children: () => children`. The payload mapping moved to `gate/records.ts` `mapPayloads`. With children on, it counts each payload's child files before `mapHere` deletes them, and counts the drops through `mapHere`'s 5th argument. A drop is a stderr note, never a gap (D12.4).
- **Gate, stored evidence.** `cli/code-gate-stored.ts` `storedFiles(root, env, note, children)` keys the stores with the base's value, over the worktree's policy (request 35b31f66). The coverage marker is in the key, so a branch that turns children on in its own config cannot have its child-collected records reused.
- **Gate, report.** `TestFileEvidence.children` and `GateRunReport.children` (`{ read, dropped }`, coverage files, not processes) are present only with the key on, for files this command ran. `base.policy.coverageChildren: true` is present only with the key on (`evaluate.ts`, one line). With the key off, the report is byte for byte as before.
- **Daemon, loaders (D12.6).** No change in `crap/loaders.ts` (request 76f5e57b). The child inherits `NODE_OPTIONS`, so the runtime-input recorder sees what it reads. With `observe.runtimeInputs` on (the default), the observed set is part of the key's closure (`keying.ts` `effectiveObserved` → `assembleClosure`), so `LoaderBuild` already makes the test file a loader. With observation off, there is no observed set, and a file only a child loads reads `unknown (no-loader)`. `test/code/crap/children-daemon.test.ts` pins all three cases.
- **Record merge (020-10a's file, request 7665085b).** `coverage/record.ts` `mergeFunctions`: one function in two processes' records is one entry, with the hits ORed. A record that holds two functions at one span (review 0.1.297 B4) keeps every hit seen there as its own entry. Before the fix, a source the test imports in its own process and a child also runs got `[span, 0]` and `[span, 1]`. The join then left the function unjoined: `incomplete (not-joined)` in the gate, `unknown` in the daemon.
- **Words (request 7f914e71).** `CoverageChecks.children` comes from the policy. `crap/step.ts` writes `CoverageSummary.children`. `delivery/code-coverage.ts` `evidenceOf` sets `CodeCoverageEvidence.children` from the summary, and `cli/code-coverage.ts` reads it into `CodeReportCoverage(Of).children`. The words follow what the states were judged with, not the policy now. `sameChecks` is unchanged: a flip re-keys every test file, and their runs step again.

## Decisions the spec did not settle

- The gate's child counts are coverage files (one per process thread that ran), not processes. A payload that cannot be mapped counts all its child files as dropped.
- A file read from the stores has no child counts, because this command read none of its files.
- The delivery reads the summary once per listed coverage entry with evidence (at most 5): 194 KB and 0.8 ms per parse on this repository's largest summary.
- With the key on, the words name processes and threads. Worker threads a test starts inherit the variable, so they are measured too (020-10a's node:test test proves a thread).

## Measured

- Gate end-to-end (`test/cli/code-gate-children.test.ts`). Key on: `classify` (child-only script, `--test`) pass, CRAP 2. `grade` (imported, only a child calls it) pass, CRAP 6. 3 child files read, 0 dropped. Exit 0. Key off: `classify` incomplete (`no-loader`), `grade` violation, CRAP 42, exit 1. A branch that turns the key on is judged without it.
- Daemon (`test/code/crap/children-daemon.test.ts`). Key on: both functions CRAP 2, untested pass. Key off: CRAP 6, untested fail. Observation off: the imported file is covered, and the child-only file is `unknown no-loader`.

## For whoever continues

- `src/cli/ci-export.ts:191` builds its Vitest adapter with no `children`. With `coverage.children: true`, its keys differ from the daemon's (020-10a's marker), so `ci export` would match no stored result. That file belongs to the `ci` rows (spec 018, 020-08a), so this row did not change it.
- `commands.md` still says of `squeal code --base`: "A daemon that runs is not asked and its store is not read". Since 020-07c it reads the stores read-only. That is 020-08b's section.
- `cli/code-coverage.ts` is 441 lines and `delivery/code-coverage.ts` is 311 lines, over the 300-line guide. `gate/collect.ts` stays at 324 lines after the move to `records.ts`.
