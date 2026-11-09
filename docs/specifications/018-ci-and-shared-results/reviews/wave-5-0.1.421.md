# Wave 5: CI export, candidate 0.1.421

## Verification

Reviewed `73524259454b1b77efcfae0f2f679b7d0b7a0603`, range `005e0d7f3..73524259454b1b77efcfae0f2f679b7d0b7a0603`, on 2026-11-09. `git rev-parse HEAD` returned that exact SHA. `git status --short` was empty before and after verification. No product file was changed. External throwaway probes used ignored fixture directories; both removed their fixtures, and the probe scripts were deleted before committing this file. Dependencies were already installed by Cezar; the brief says not to repeat installation. No local build or full suite, as the brief requires.

| Command | Actual result at the candidate |
|---|---|
| `pnpm run lint` | Exit 0: `Checked 2917 files in 1402ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm exec vitest run test/ci/export.test.ts test/ci/export-check.test.ts test/ci/export-keys.test.ts test/cli/ci-export.test.ts --maxWorkers=2` | Exit 1: **3 files passed, 1 failed; 24 tests passed, 1 failed**, 8.89 s. Failure is S1 below. The real two-shard/daemon comparison and CLI round trip pass. |
| `pnpm exec vitest run test/store/transfer-rekey.test.ts test/keys/key-format.test.ts --maxWorkers=2` | Exit 0: **2 files, 25 tests passed**, 41.26 s. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/core/ci/export.ts src/core/ci/export-check.ts src/core/ci/export-parts.ts src/cli/ci-export.ts` | Exit 3 at revision 6: **57 selected files pass, 139 pending** after 61.0 s; worktree known failures 0. Pending includes tests queued behind the active tier and claims in the coordinator's worktree. This is unverified affected coverage, not a finding. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/ci/export.test.ts test/ci/export-check.test.ts test/ci/export-keys.test.ts test/cli/ci-export.test.ts test/store/transfer-rekey.test.ts test/keys/key-format.test.ts` | Exit 3 after 61.9 s: **2 pass, 4 pending** at revision 6. A later Squeal notification independently reports the same `export-check.test.ts:134` failure as the manual run. |
| `pnpm exec tsx /tmp/review-421-probe.mts` | Exit 0: assertions prove B1, B3 and B4 below. The fixture's two shard commands pass. Its independent run at changed ignored content exits 1. Import stores all eight exported pass rows with `rekeyed: 0`. Instrumented export: `NETWORK { listens: 0, connects: 0 }`; scratch-store remainders `[]`. |
| `pnpm exec tsx /tmp/review-421-snapshot.mts` | Exit 0: assertions prove B2 below. The recorded snapshot test passes, export exits 0 with two pass rows, independent Vitest at the export's format exits 1 with `Snapshot ... mismatched`. |

CI: [42642512193](https://github.com/hearsay-tools/squeal/actions/runs/42642512193), exact candidate. Last observed: Node 24 lint/typecheck/version-sensitive job **success**; all three Node 22 shards **in progress**. Nightly Node 24 full suite and bundle-version job are skipped by their conditions. Full-suite CI and build/bundle verification remain **unverified**, not findings. The coordinator needs exact-release CI evidence before release.

## Verdict

**FAIL. Four proven blockers, one proven nonblocking should-fix, no nits.** Two blockers can turn a real failing local run into an exported pass at that content's key. The other two break the required complete-part and equal-result contracts. This reviews the new 018-17 consumer; it does not reopen the settled 0.1.420 import review.

## Blockers

### B1 — Proven: observed input content is taken from the later job, not certified by the recorded run

Location: `src/core/ci/export.ts:159` (also lines 145–167 and 108–116).

Vision: **“An old result never gets to pose as the current truth.”** D9 requires keys and results for the same content. `observedGrowth` hashes the part's observed paths in the export checkout. The exporter uses those hashes to label the earlier pass without evidence that the shard read those bytes. A shared commit does not identify ignored or generated inputs.

Reproduction, using the real recorder and CLI:

1. Commit `package.json`, a Vitest config including `test/*.test.ts`, `.gitignore` containing `data/`, and two tests. Each test reads `new URL('../data/value.txt', import.meta.url)` and expects `GOOD`.
2. Write ignored `data/value.txt` containing `GOOD`. Record `vitest run --shard=1/2` and `--shard=2/2` with `CI=true`; both pass.
3. Clone the same commit twice. Prepare the ignored file as `GOOD` in one and `BAD` in the other. Export the same complete set of parts in each checkout.
4. Both exports exit 0 with pass rows. For `test/a.test.ts`, the good key is `9d5eacdf3a71f5aa1b6fb9a0f84603cc33889b7aa15be04469e8907fda79d9e0`; the bad key is `b0826e8c724d13edbc64d128f2967eba8aa7134638a7a740c74c33cf8d6b7950`. The closure includes `data/value.txt`.
5. Run Vitest in the bad checkout: both reads fail, `expected 'BAD' to be 'GOOD'`, exit 1. Yet its export holds eight pass rows, including those reads. Import of this bundle adds `results: 8`, `rekeyed: 0`.

The import's source-commit proof correctly fails for the ignored file. That does not protect this case: D3's fallback stores the supplied pass at the exported key, which the exporter already computed from the wrong bytes. The worker note requiring identical preparation cannot establish that fact.

Worker-sized fix: refuse to export a result unless its inputs can be tied to the recorded run. A conservative repair can refuse files with uncertified non-commit inputs, including observed ignored files and directory listings; do not just omit those inputs from keys. If retaining them, extend the part evidence and verify hashes/listing identities before using the job's key. Also establish the recorded run's tracked content when its checkout was dirty. Add the `GOOD`/`BAD` regression and a case where an ignored input exists only in the shard. Leave the import proof and D3 fallback intact.

### B2 — Proven: dropping the entire snapshot options field accepts outcome-changing formats

Location: `src/core/ci/export-check.ts:47`, used at line 147.

D9: **“refuses parts whose environment descriptors differ for one project.”** D10 tolerates only the named safe fields. `snapshotOptions` includes more than the update mode; it includes `snapshotFormat`. Removing the whole hash ignores an outcome-changing difference between the shards and the job, and between parts.

Reproduction:

```ts
// vitest.config.ts, committed with the test and its snapshot
export default defineConfig({ test: {
  snapshotFormat: {
    printBasicPrototype: process.env.REVIEW_SNAPSHOT_FORMAT === 'true',
  },
} });
// test/a.test.ts
it('snapshot', () => expect({ x: 1 }).toMatchSnapshot());
```

Prepare and commit the snapshot with the flag true (`Object { ... }`). Record with `CI=true REVIEW_SNAPSHOT_FORMAT=true`, without `-u`: one test passes, part `updateSnapshot` is `none`. Export without the flag, at the same commit. Actual output:

```text
code: 0
Exported 1 test file, 2 results, to .../out.gz.
shard snapshotOptions: c3021dba349b85ff37aac8efcb43090ab43a9d6303dd9ba2bbc7b1fdd244b30d
job snapshotOptions:   61096a57645882d2ba9599bd54d5301a289b9ccbd8190d32e7402712f3f61ace
outcomes: ["pass", "pass"]
```

Independent Vitest without the flag exits 1: the snapshot expects `Object {`, but receives `{`. No snapshot update occurred in either recorded or export environment. The new artifact labels the pass with the job's environment hash, so import cannot recover the discarded difference.

Worker-sized fix: preserve comparison of the outcome-changing snapshot options. Do not exempt their entire top-level hash. If normalization is needed for a Squeal-owned update setting, record/compare a normalized hash where that fact is known, with a documented part-format seam; keep `snapshotFormat` and other project options checked. Add this real snapshot regression and an unequal-part-format-options refusal test.

### B3 — Proven: a missing shard produces a successful partial export

Location: `src/core/ci/export.ts:145`; `src/cli/ci-export.ts:146`.

The review brief explicitly requires **“a part set with any gap ... a missing shard ... is refused rather than exported partially.”** D9's job runs after every shard and takes their union. The implementation checks only supplied parts. It never checks their completeness, and an empty requested directory is ignored if another holds a part.

Use B1's two completed, disjoint shards. Copy just the first part into `single/`, create an empty `empty/`, then call:

```text
squeal ci export --parts single empty --out partial.gz
Exit 0
Exported 1 test file, 4 results, to .../partial.gz.
```

The job's runner lists both test files. The artifact holds only `test/a.test.ts`. The missing part is neither counted as unkeyed nor named as a refusal. Passing a single nonempty part directory has the same gap.

Worker-sized fix: verify part-set completeness before writing. Add sufficient run/shard manifest evidence, or a documented check against the expected test-file set, so absent shards and unfinished files are detectable. Reject an explicitly supplied empty shard directory. Compare coverage before filtering failed files, because D2 intentionally omits failed results. Add a real two-shard test that removes one part and asserts exit 1, a named reason and no output artifact; retain the successful union case.

### B4 — Proven: duplicate test names export check identities that the daemon never gives

Location: `src/core/ci/export-report.ts:34`; comparison coverage at `test/ci/export.test.ts:183`.

018-17 done-when: **“Fixture export equals a daemon-made export of the same content.”** The brief requires equal keys and results per file. The new consumer trusts the recorder's location-free names as daemon check IDs. For repeated test names, that changes identity, not just optional location metadata.

In a file with `it('duplicate', ...)` on lines 2 and 3, the real part/export holds:

```text
["duplicate", "duplicate (line ?)", "reads data"]
```

The real daemon adapter's run of the same file reports:

```text
["reads data", "duplicate", "duplicate (line 3)"]
```

The import stores a pass for a check no local run emits and provides none for `duplicate (line 3)`. The comparison test uses only unique names, so it misses this seam. The old recorder's naming limitation alone is outside this range; the new exporter accepting it as equal daemon results is the finding.

Worker-sized fix: preserve daemon identity for duplicate names, or refuse ambiguous parts with a named reason until the recorder can supply enough identity evidence. Do not guess source locations or change daemon naming/key semantics. A conservative exporter refusal is enough for this repair. Add a fixture with two equal names on different lines, and an equal-name `test.each` on one line; compare check IDs as well as outcomes. Keep the project's original runner config unchanged.

## Should-fix

### S1 — Proven, nonblocking: the tolerance test uses invalid hashes and expects the unsafe direction

Location: `test/ci/export-check.test.ts:133` (descriptor at line 31).

The new test uses `allowOnly: "1"` and then `"0"`, expects acceptance, and fails with:

```text
config fields allowOnly differ (the export ran with CI set)
```

The released import comparator correctly accepts unequal `allowOnly` only for `configFieldHash(false)` to `configFieldHash(true)`. Arbitrary strings cannot prove that direction. Fix this fixture with real hashes and the safe direction; assert rejection in the reverse direction. Update the snapshot-options expectation with B2. This failure is a test defect, not evidence that production tolerance should be widened. The coordinator must also resolve the resulting CI failure before release if CI reproduces it.

## Nits

None.

## What fits

- The real four-file, two-shard fixture passes: file keys, closures, observed entries and environment hashes equal the daemon's. Source-commit key reproduction succeeds for every file there. Unique-name outcomes agree; missing locations are explicit and not a finding by themselves.
- The daemon's `WorktreeKeys`, `observedGrowth` and `recordsForFile` are reused. No keying, key-format or adapter-version source changed in this range. The key-format alarm passes. This does not excuse attaching a result from other content to a correctly computed key (B1/B2).
- `keyPartsOf` is outside the keying path. The import still reproduces the exported key before re-keying and still requires the destination list to keep every exported input. Its targeted tests pass; wrong `keyParts` conservatively prevent re-keying. No import rewrite is needed for this wave.
- Refusal tests for unfinished runs, duplicate files, different commits, a different checkout, snapshot updates and incompatible Node environments pass. The job also rejects a project absent from its runner. These settled cases need no new architecture review.
- Failed files are omitted whole. Ordinary artifacts contain passes/skips, relative path fields and hashed config/environment descriptors; failure errors are not copied. The existing absolute-path guard runs before writing. No content leak was observed in the probes.
- Instrumenting `net.Server.prototype.listen` and `net.Socket.prototype.connect` during an ordinary successful CLI export counted zero calls. The CLI closes its runner/store and removes its scratch store; the probe found no remaining `squeal-ci-export-*` directory. This proves the exercised path, not arbitrary user config behavior.
- CLI help, usage exits and refusal before runner startup pass. Publish/fetch is not implemented by this range and remains 018-20's job.

## Inputs for the repair and next wave

- Repair B1/B2 before publishing any CI export. A valid artifact needs evidence that each pass belongs to its content and outcome-changing environment, not just proof that the key encoding is internally consistent.
- Repair B3 before 018-20 treats a successful export as a complete shard union. Do not infer missing-shard success from exit 0 until then. Failed-result omission under D2 is a separate fact.
- Repair B4 at the recorder/export boundary without changing daemon check IDs or the project's command. Keep the original runner-output/config/exit contract from D8.
- Preserve the current import order: add closure/observed facts, prove the source key over the export commit and supplied `keyParts`, require the destination to retain every source input, then store results at the proven local key or use the exported-key fallback. The fallback requires a sound producer.
- For 018-20, `ciExportCommand` writes one D2 gzip bundle only after checks; `ciExport` owns runner lifetime, and the CLI owns the scratch store lifetime. Keep publishing downstream of a successful, complete export. These calls add no daemon and no test rerun.
- Re-review the four bounded reproductions plus S1. Use targeted tests with at most two workers on this loaded host. No local build/full suite for routine review. Exact-release full-suite CI and bundle checks are still the coordinator's release evidence.
