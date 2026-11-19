# Issue 249: manifest reads and selection

2026-11-19. Recommendation: retain as a manifest-precision proposal; this probe does not reproduce the reported blanket observation, and implementation needs the human's decision on arbitrary manifest data reads.

Source examined: Squeal **0.1.566**, commit `6b490e0fa1d58cf4c889140a56be445401d6f49a`. The experiment uses that source, not the installed 0.1.565 runtime or the incident's 0.1.563. Node `v26.13.0`, Vitest `5.0.3`, Vite `8.3.2`, pnpm `12.15.0`. No product, spec, status, skill or board changes belong to this research.

| Question | Answer and evidence |
| --- | --- |
| Does a small fixture reproduce automatic observation of every manifest? | **verified by experiment**, 0.1.566: no. Two tests importing a plain source file observed no manifest. Their keys stayed equal after a scripts-only edit. |
| Does a recorded manifest read key arbitrary data? | **verified by experiment**, 0.1.566: yes for the test explicitly reading `scripts`. Its observed closure held `package.json`, and its key changed. **read in source code**, same version: observed paths use whole-file hashes without a manifest-field distinction. |
| Do declared inputs retain data sensitivity independently? | **verified by experiment**, 0.1.566: yes. With observed paths removed in a core-level control, the declared reader's key still changed; both other keys stayed equal. |
| Is semantic manifest handling absent everywhere? | **read in source code**, 0.1.566: no. The Vitest transform-invalidation path already excludes scripts/version and other metadata after recording an earlier manifest state. This does not filter closure hashing or named-path selection. |
| Are 1,792 selected files and 309,000 actual runs proved here? | **inferred**, incident at 0.1.563: not determined. Those numbers are the issue's report; this research neither reads the incident store nor reconstructs its workload/history. A named status selection is not a count of executed files. |

## Experiment and boundary

**verified by experiment**, 0.1.566. One bounded probe, one Vitest run of three tiny files, no daemon and no broad suite. Its temporary repository lives under the OS temp directory, has its own manifest, and links the existing dependency installation. The probe removes the temporary directory in `finally`. It never edits a live repository's manifest. The task's explicit load rule takes precedence over the process document's VM fallback.

Commands from the repository root:

```sh
uptime
getconf _NPROCESSORS_ONLN
node --version
pnpm --version
timeout 90s pnpm exec tsx docs/specifications/011-core/research/probes/issue-249/probe.ts > docs/specifications/011-core/research/probes/issue-249/output.txt 2>&1
cat docs/specifications/011-core/research/probes/issue-249/output.txt
```

The earlier check printed `10:20:27 up 4 days, 13:23, 3 users, load average: 10.60, 11.43, 12.99`, and 24 CPUs. Immediately before starting Vitest, the probe itself rechecked `uptime`, `os.cpus()` and `os.loadavg()`: `10:24:23 up 4 days, 13:27, 3 users, load average: 10.01, 11.05, 12.51`, 24 CPUs. The one-minute load was below the CPU count. The command exited 0 within its 90-second bound.

The adapter returned `end: completed` and three `pass` results. Its real observations and the core's key calculations were:

| Test | Observed manifest | Manifest in runner closure | Declared manifest | Key changes after scripts-only edit |
| --- | --- | --- | --- | --- |
| `test/a.test.ts` | none | none | none | no |
| `test/b.test.ts` | none | none | none | no |
| `test/data.test.ts` | `package.json` | none | `package.json` | yes |

The reverse index selected only `test/data.test.ts`. A second key calculation within the same probe used closures containing only each test and its declared inputs, with no observed paths. Another scripts-only edit again changed only the data reader's key. The test accepts either script value, so the edit changes input content without changing its expected pass outcome.

This is an adapter-plus-core probe: it uses real `createVitestAdapter`, `assembleClosure`, `createDeclaredInputs`, `ReverseIndex` and `checkKey`, with a fixed environment segment and the C3 git-blob hash formula. It does not start a watcher, scheduler or status server, does not measure automatic reruns, and does not reproduce the original five-manifest workspace topology. It performs no second test run after the edit. The declared-only control isolates declaration sensitivity; it is not a second adapter run with observation disabled.

## Mechanism and contract

**read in source code**, 0.1.566. `src/runners/observe/recorder.cjs` wraps filesystem calls and records read paths as kind `f`; successful module resolutions record loaded targets as `f` and `m`. `src/runners/observe/inputs.ts` returns kept paths after subtracting writes. These facts identify paths and module loads, not the JSON fields a caller consumed or whether a filesystem read came from a resolver versus user code. An arbitrary `readFileSync(package.json)` is currently covered without requiring a declaration (011 C12, and C3's observed-input closure rule).

**read in source code**, 0.1.566. `src/core/keys/closure.ts:assembleClosure` unions runner paths, declared inputs and observed paths into one path set. `check-key.ts:checkKey` includes each existing path's file hash. `key-index.ts:rekey` refreshes changed paths and recomputes their reverse-index readers. Therefore a manifest already observed by many test files can re-key them all after a scripts-only edit. No such blanket observation arose in this fixture; that prerequisite remains unproved for the original incident. C3 explicitly merges observed sets without pruning, so prior observations can remain relevant even when a later run no longer reads the path.

**read in source code**, 0.1.566. `src/cli/named-selection.ts:selectNamedFiles` selects a source path's readers from daemon-supplied readers or stored closures; `src/cli/stored-closures.ts:storedReaders` checks path membership and closure validity. It does not compare old and new manifest fields. Thus the reported `.selection.testFiles` establishes breadth of a named-path query, if accepted as reported; that output alone proves neither changed keys nor 1,792 scheduled or completed runs. The issue's commit-weighted cost estimate needs separate execution evidence before it is described as measured runs or wall-clock cost.

**read in source code**, 0.1.566. `src/runners/vitest/stale.ts` already has `IGNORED_FIELDS`, including `scripts`, `version`, `description`, links and author/license metadata. `resolutionMoved` compares remaining fields with the instance's recorded value, conservatively treating its first edit as changed. Every unlisted field counts, including custom resolution fields. Spec 013 **V2** documents this. It saves transform invalidation work; it does not remove a manifest from C3's observed or declared closure. Spec 013 **V3** supplies runner closures, **V6** supplies environment/package inputs, and **V10** delivers the recorder. Row 023-14 also puts manifests used by `#` and workspace imports into runner closures (`resolution-inputs.ts`, `adapter.ts`), a separate provenance from observed reads that future scope must account for.

**inferred**, based on the same source. The deciding tradeoff is unnecessary revalidation versus losing arbitrary manifest-data dependencies. The issue expects explicit declarations to preserve such data reads, while today's C12 automatically observes them. Treating all observed manifest reads as resolution-only would change that contract. The evidence supports discussing that boundary explicitly; it does not prescribe a field list, implementation or migration.

## Related work, unknowns and sources

**read in source code**, repository documentation at the examined SHA. Completed rows **011-85 and 011-87 through 011-90** address install fingerprints, project config scope, linked dependency specifiers and reading earlier keys. The accepted observation-off root-manifest miss in 011-85 is not a semantic filter for observed reads. **011-86** is the Node version floor. **023-14** fixes manifest `imports` correctness, with its shadowing-twin half held. These are related mechanisms, not evidence that this exact request shipped.

**inferred**, open questions: which calls and project topology produced all five observed manifests in the incident; whether they remain observed at 0.1.566; which readers also have runner or declared manifest inputs; how much of the stated historical selection actually executed; and whether the human accepts requiring declarations for manifest fields currently protected by automatic observation. No further experiment was run to answer these within this bounded triage.

Sources read:

- [GitHub issue #249](https://github.com/hearsay-tools/squeal/issues/249), fetched with `gh issue view 249 --repo hearsay-tools/squeal --json title,body,url`. Incident assertions are attributed to the issue, not independently verified.
- [Probe](probes/issue-249/probe.ts), [complete output](probes/issue-249/output.txt), [probe instructions](probes/issue-249/README.md).
- [011 spec](../spec.md), C3 and C12; [amendment log](../status.md), especially observed-path retention and 011-85. [013 spec](../../013-vitest-runner/spec.md), V2, V3, V6, V10, and its [amendment log](../../013-vitest-runner/status.md).
- Source paths and symbols named above, pinned to [6b490e0fa](https://github.com/hearsay-tools/squeal/tree/6b490e0fa1d58cf4c889140a56be445401d6f49a); [board](../../../board.md), rows named above.

Verification scope: the session's Squeal skill was read and `squeal checks` inspected before the probe. It covers this repository's 1,993 configured test files, not this throwaway standalone script. No repository test suite, lint, typecheck or build was run for this documentation-only research. The three fixture passes are the only new test-run claim.
