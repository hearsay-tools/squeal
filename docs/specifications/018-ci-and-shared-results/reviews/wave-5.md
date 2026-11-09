# Wave 5 review: CI recording, import keys, Node build identity

## Verification

Candidate: `cand/0.1.420`, `43fb35087cec16251b9adf146c8dbc7a018f58cd`.
Range: `63089489a6c8b03a3d514a9c8ca97efe7fb6bb60..43fb35087cec16251b9adf146c8dbc7a018f58cd` (`origin/main..candidate` at review).
Rows: 018-16, 018-18, 018-19. Reviewed against the second slice, `tasks/wave-5.md`, worker notes and accepted amendments in `status.md`.

All checks below ran at that candidate, with a clean tracked tree. Probes lived outside the checkout and were removed. No product file changed.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `43fb35087cec16251b9adf146c8dbc7a018f58cd`, matches the brief |
| `git status --porcelain=v1` | Empty, before and after checks |
| `pnpm install --frozen-lockfile` | Cezar reports it completed in 1 second before this session. Not repeated, as instructed. Exact-candidate CI also passed this step. |
| `pnpm run lint` | Exit 0. `Checked 2901 files in 1516ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`; no diagnostics |
| `pnpm run build` | Not run locally, as instructed. Exact-candidate CI's Node 24 job passed Build, Bundles match the build, and The build adds no plugin file. |

Affected results:

```text
/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/cli/ci.ts src/core/store/transfer-rekey.ts src/core/keys/environment-descriptor.ts src/runners/node-test/adapter-environment.ts
Revision: 0
Current (123): 123 pass
Unknown (642): 642 never run at their inputs, nothing queued them (the baseline is lookup-only)
Named test files have no verdict: 642 test files without a current result at revision 0
Worktree: known failures 0; not current: 781 of 1533 test files (781 unknown)
```

Exit 3. Those unknown results are **unverified**, not findings. This lookup-only baseline does not queue them. The brief requests targeted Vitest checks; those unknown results also justify the direct run:

```sh
pnpm exec vitest run --maxWorkers=2 test/cli/ci-record.test.ts test/cli/ci-usage.test.ts test/cli/import-rekey.test.ts test/keys/import-tolerance.test.ts test/store/transfer-rekey.test.ts test/store/environments.test.ts test/runners/node-test/environment-build.test.ts test/runners/vitest/ci-record.test.ts test/runners/vitest/ci-runs.test.ts test/status/import-observed.test.ts test/keys/key-format.test.ts
```

```text
Test Files  1 failed | 10 passed (11)
Tests       1 failed | 70 passed (71)
Duration    24.63s
```

Exit 1. The failed parent assertion is `test/cli/ci-usage.test.ts:63` (S1 below). The intentional failing/crashing child runs in `ci-record.test.ts` passed their parent assertions. All other selected files passed, including the key-format alarm. A focused repeat, justified by this new failure:

```text
pnpm exec vitest run --maxWorkers=1 test/cli/ci-usage.test.ts
Test Files  1 failed (1)
Tests       1 failed | 7 passed (8)
Duration    4.29s
```

CI: [run 42635292959](https://github.com/hearsay-tools/squeal/actions/runs/42635292959), queried with `gh run list --commit 43fb35087cec16251b9adf146c8dbc7a018f58cd --json databaseId,headSha,status,conclusion,url,name` and `gh run view 42635292959 --json status,conclusion,jobs`. At the final observation, Node 24 (lint, typecheck, version-sensitive) passed, including its build and bundle checks. All three Node 22 full-suite shards were still in progress. Their results remain **unverified**. No local full suite, Squeal full-suite request or local build was run.

## Verdict

**FAIL**. Two **proven blocking** findings. One **proven nonblocking** test finding. No nits.

## Blockers

### B1. Re-keying can remove an input that the exported run read

**Proven.** `src/core/store/transfer-rekey.ts:93`, especially the local-only closure assembled at lines 101–106. `src/core/store/transfer-import.ts:181` and `:197` preserve existing lists and observed entries, so they do not fill this gap.

Spec goal 3 requires “no new wrong-pass exposure.” D11 says that at different content the local daemon does not find the imported result. The reproduction proof verifies the exported key, but it does not prove that the destination key still covers every input the exported run used.

Concrete case:

1. The local store already has `test/a.mjs` with closure `[test/a.mjs]` and an empty `observed` entry. Such a store can come from an earlier version of the test that read no data file.
2. At commit C, the test reads `data/value.txt` and requires `good`. CI passes. Its closure is `[data/value.txt, test/a.mjs]` and its observed entry names `data/value.txt`.
3. The developer has C's test bytes but edits `data/value.txt` to `bad`. Its static closure still has no project import for this filesystem read. The existing observed entry remains empty.
4. Import's exported-key proof succeeds over C's actual git blobs. It then replaces the exported closure with the shorter local closure. The new key drops `data/value.txt` entirely.
5. The daemon's `KeyIndex` computes that same shorter key at the edited content and finds the imported pass, although executing the test fails.

A throwaway `pnpm exec tsx /tmp/squeal-wave5-review-probe.mts` used a real committed fixture, `committedBlobs`, `environmentRecord`, `importResults` and `KeyIndex`. It executed the data-reading test before and after the edit. Actual output:

```json
{"exportRunExit":0,"localRunExit":1,"rekeyed":1,"localObserved":[],"importedAtLocalDaemonKey":["pass"],"localKeyEqualsExported":false}
```

The probe used valid, matching environment inputs; no environment tolerance was needed for B1. This is new exposure: the exported key includes the data blob and does not match the shorter local key until this wave re-keys it. Existing tests cover a local list larger than the export's list, but not the reverse or disjoint lists.

**Worker-sized fix:** before accepting a destination key, prove that it retains the exported run's content dependencies, including observed files and directory listings. If the existing local closure omits one, keep results at the exported key. Do not widen the shared observed set or move a local run's key to make this import fit. Add regressions for an empty existing observed entry, a disjoint entry and a missing exported static input. Keep the existing larger-local-union success case.

### B2. `allowOnly` tolerance accepts the unsafe direction

**Proven.** `src/core/keys/environment-descriptor.ts:234`, which removes `allowOnly` from both descriptors for every Vitest comparison. `transfer-rekey.ts` then uses that comparison to choose the local environment hash.

D10's stated reason is “a pass with `allowOnly: false` and no watch implies the same pass locally.” This code also accepts a pass made with `allowOnly: true` under a local environment with `allowOnly: false`. Goal 3's no-new-wrong-pass bound does not hold in that direction.

Concrete case: the file contains `it.only(...)`. The exporting command permits focused tests, so it passes. The local project forbids them. Vitest fails the local run, but import removes the only config difference and stores the pass under that strict local environment's key. This can arise with an ordinary local export, or with CI explicitly setting `--allowOnly=true`; D3 does not require the source to be CI.

The same source-only probe ran Vitest 5.0.3 on an `it.only` fixture with `--allowOnly=true` and `--allowOnly=false`, then exercised `importDifferences` and `importResults` with environments differing in that field alone. Actual output:

```json
{"allowOnlyTrueExit":0,"allowOnlyFalseExit":1,"error":true,"importDifferences":[],"rekeyed":1,"resultsAtStrictKey":["pass"]}
```

**Worker-sized fix:** permit an unequal `allowOnly` only in the proven safe export-to-local direction. Keep true-to-false, unknown and unrecognized values keyed. The descriptor already contains hashes, so this can compare known boolean hashes without storing config values. Use the same rule for status and re-keying. Add the focused-test regression and both directions to `import-tolerance.test.ts` and the import tests. Keep `snapshotOptions`, browser mode and all other fields strict.

## Should-fix

### S1. The unsupported-runner test assumes a resolver context that does not hold here

**Proven, nonblocking.** `test/cli/ci-usage.test.ts:63`.

The new test fails both in the selected run and alone. It expects `only Vitest is supported`, but receives:

```text
squeal ci record: no Vitest run in this command: nothing recorded
```

The command still returns the expected code 5. A fresh Node process using `createRequire('/tmp/squeal-plain/package.json').resolve('vitest/package.json')` returns `MODULE_NOT_FOUND`; `NODE_PATH` is unset. Thus the test runner's resolution context matters. The exact resolver cause is not settled here, and this failure does not prove a product violation of D8. It also prevents this test from reaching its later missing-executable assertion.

**Worker-sized fix:** exercise the unsupported-project guard in a real child CLI process, or provide an explicit isolated resolution seam. Retain assertions for the exit code, named note and unchanged tree. Do not weaken the expected note just to accept the recorder path. Re-run this file alone and with `ci-record.test.ts`.

## Nits

None.

## What fits

- **018-16, D8:** the two-shard fixture writes disjoint parts with checks, durations and relative observed reads. The pass, fail, crash and non-Vitest child exit codes pass through. The output-tree and temp-cleanup assertion passes. No daemon, store or coverage provider is added to this path.
- A missing-internals probe made a minimal `vitest` package whose `vitest/node` export has no `Logger`. `pnpm exec tsx /tmp/squeal-wave5-review-fallback.mts` printed the command's original `UNCHANGED_STDOUT`, returned 7, wrote no part, and printed `could not record (vitest/node has no Logger.setVitest); no part`. Its project tree remained `.git` and `node_modules`. The wrapper does degrade for this missing internal. The hook also explicitly guards `onAfterSetServer`; that second missing-member case was read in source, not separately executed.
- The part writer keeps failure messages and logs out. Config values become per-field hashes; allow-listed variable values become one hash. `ci-runs.test.ts` verifies the variable value does not appear. Paths produced by the normal fixture are relative. The privacy claim concerns the structured fields; test names and project names remain caller-supplied identifiers, as in D2.
- **018-18, D10:** browser mode stays keyed; disabled-browser tolerance requires both flags to be false; descriptors without the flag remain conservative. `snapshotOptions`, root, Node version and other runners remain strict in the tests. B2 is the exception to the claimed safe pass tolerance.
- **018-18, D11:** the exported-key reproduction check is in place. Missing key parts, changed build-output content, missing commit blobs, an incompatible environment and no local environment keep results at the exported keys. Larger local lists and edited content in those larger lists pass the existing checks. Import keeps local keys and existing local results unchanged. B1 is the uncovered shorter-list case.
- The optional browser field does not change an environment hash. The reader in `squeal--v0.1.419:src/core/store/environments.ts` accepts extra fields; the candidate keeps its shape and known field meanings. The one-time replacement for a descriptor at its correct hash is compatible with that reader. The descriptor replacement tests pass.
- **018-18, D15:** the observed-set reason and full-status no-coverage note pass their selected tests. Default successful-import silence remains.
- **018-19, D12:** the same Node build at two paths keys equally. Changes to config, dependency versions, platform or architecture key apart; option ordering does not. `nodeBuild` replaces `execPath` in resolved config, so old and new node:test environments cannot collide even without an adapter raise. The accepted no-raise deviation is sound. The key-format alarm passes; the patch changes neither Vitest nor pytest key inputs.

## Inputs for the repair and next wave

1. Repair B1 and B2 before a product landing. One worker can own the import rule, its destination-key guard and the regressions. Keep the no-local-key-moves requirement; inability to re-key is a miss, not a reason to relax a proof. Fix S1 in the recorder tests.
2. Preserve the import order: add only missing stored lists and observed entries; prove the exported key with the export's environment, closure, commit blobs and `keyParts`; check the destination's dependency coverage and safe D10 direction; then write the result and import provenance in the same transaction. The proof of the source key alone is insufficient.
3. 018-17 must consume `squeal-ci-part/1` through `readPart` and compute closures and keys with the daemon's existing rules. Emit the exact dependency and runtime segments as `keyParts`. Store-made exports do not retain these segments, so their re-keying remains limited to reproducible empty segments. Missing or unproved segments must keep the exported key.
4. The part's descriptor has hashes from the actual run. The existing descriptor comparison test names `includeTaskLocation` as a difference from the daemon's instance; `snapshotOptions` can differ outside CI. Settle how the export job uses those fields before claiming equal daemon keys. D10 does not currently tolerate either. Refuse snapshot updates other than `none`, incomplete runs, duplicate files, mixed commits and incompatible project descriptors as D9 requires. Do not silently widen D10.
5. 018-20 must pass the selected export commit's actual blobs and the correct worktree id to `importResults` through `Rekeying`; status and import must call the same safe environment rule. Preserve local fallback for a missing commit or any failed proof.
6. No new runtime or CPU budget was measured here. Keep the brief's bounded checks on this loaded host. CI supplies full-suite evidence; require passing full-suite CI at the exact release commit before release. D9, D13, D14 and the cezar trial are still later rows, not claims of this candidate.
