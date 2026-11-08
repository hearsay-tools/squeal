# Waves 1 and 2 review: environment records and result transfer

Candidate: `ee17cb2306c449e2a31acea3e524121ff8da20f7` (`cand/0.1.417`). Range: `7280f4469..ee17cb230`. Rows: 018-06 and 018-07. Reviewed 2026-11-08.

## Verification

All local checks below ran at the candidate SHA on a clean tracked tree, before this findings file was written. Temporary probes and the old source copy lived under `/tmp`, outside the tree.

```text
$ git rev-parse HEAD
ee17cb2306c449e2a31acea3e524121ff8da20f7
$ git status --short
(empty)
$ pnpm run lint
$ biome check .
Checked 2871 files in 1417ms. No fixes applied.
exit 0
$ pnpm run typecheck
$ tsrs --fast --noEmit
exit 0
$ git diff --name-only 7280f4469..HEAD -- test/keys/key-format.test.ts
(empty)
$ pnpm exec vitest run test/keys/key-format.test.ts
Test Files  1 passed (1)
Tests  12 passed (12)
Duration  11.51s
exit 0
```

Dependencies were installed by Cezar before launch with `pnpm install --frozen-lockfile` (reported duration 1 s). Per the brief, I did not repeat install, run `pnpm run build`, or run a full suite.

Affected checks used `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`:

```text
$ squeal status --wait 60000 src/core/keys/environment-descriptor.ts src/core/keys/environment-hash.ts src/core/scheduler/keying.ts src/core/store/transfer.ts src/core/store/environments.ts src/core/status/imports.ts src/cli/export.ts src/cli/import.ts test/keys/key-format.test.ts
Revision: 0
Current (458): 458 pass
Unknown (274): 168 waiting for the coordinator's run; 106 never run, nothing queued them
Named test files have no verdict: 274
Worktree: known failures 0; not current: 301 of 1514 test files (301 unknown)
exit 3

$ squeal status --wait 60000 test/keys/key-format.test.ts test/keys/environment-descriptor.test.ts test/keys/environment-record.test.ts test/store/environments.test.ts test/store/transfer.test.ts test/store/imported-origin.test.ts test/status/import-reasons.test.ts test/cli/transfer.test.ts
Revision: 0
Current (7): 7 pass
  test/keys/environment-descriptor.test.ts
  test/keys/environment-record.test.ts
  test/store/environments.test.ts
  test/store/transfer.test.ts
  test/store/imported-origin.test.ts
  test/status/import-reasons.test.ts
  test/cli/transfer.test.ts
Unknown (1): test/keys/key-format.test.ts, waiting for the coordinator's run
exit 3
```

These are output excerpts. The direct key-format run above supplies its missing verdict. The broader unknown checks remain **unverified**, not failures. The first wait also reported a temporarily stale daemon heartbeat while its socket was alive.

CI observation:

```text
$ gh run view 42461609267 --json headSha,status,conclusion,jobs
headSha: ee17cb2306c449e2a31acea3e524121ff8da20f7
status: in_progress
conclusion: ""
Node 24 (lint, typecheck, version-sensitive): completed, success
Node 22 (1/3), (2/3), (3/3): in_progress
Node 24 (nightly, full suite): skipped
Bundle changes bump the version: skipped
```

Run: <https://github.com/hearsay-tools/squeal/actions/runs/42461609267>. The final observation has a passing Node 24 verification job, including build and bundle checks. Full-suite completion remains **unverified** while the Node 22 shards are pending. No local full suite substitutes for CI.

## Verdict

**FAIL**: 1 proven blocker, 1 plausible nonblocking note, 0 nits.

The import preserves local evidence. The new status file counter can still attribute a file to an import when the local result at its key is a failure and the import added nothing.

## Blocker B1: matching keys are counted as current files from an import without its results

**Proven.** `src/core/status/imports.ts:65`, `src/core/status/imports.ts:94`; rendered at `src/core/status/import-lines.ts:27`.

D5 requires “how many of the exported test files are current here from the import.” Goal 3 requires status to say “how many imported results are current.” Vision principle 2 says old evidence must not pose as current truth. `reasonOf` returns `current` on key equality alone. It does not inspect the adopted result, its outcome, or its import origin. `currentResults` separately checks those states, so the two counts can contradict each other.

Concrete reproduction, using the candidate's public store and status functions in a temporary store:

1. Store a local `fail` for test `t/a.test.ts` at key `key`. Store that key as the local file key, and derive its current failing known state with `stateFromResult`.
2. Call `importResults` with one exported pass for the same check and key. The environment equals the local environment.
3. Read `readImports` with the local keys and known states, then render `importLines`.

Actual output from `pnpm exec tsx /tmp/squeal-018-review.mts`:

```text
counts: results=0, alreadyStored=1, closures=1, observed=0, startup=0
local result after import: fail
currentResults=0, currentFiles=1, testFiles=1
notCurrent={environment:0,closure:0,observed:0,content:0,noKey:0}
Imported: 1 of 1 test file current from local export at cccccccc (0 current results)
```

The probe asserted that the local key row and failure were unchanged. This is a status defect, not unsafe result adoption. It also affects a second import at an already occupied key, and a matching key before the daemon adopts imported states: matching keys alone do not prove the reported source.

**One-worker fix:** make the file attribution and result attribution use the same adopted current evidence, grouped by test file and import id. Keep key-match eligibility separate if it is useful. Name a matching-but-retained local result or a not-yet-adopted result honestly; do not call it a content or environment mismatch. Add fixture tests for the retained local failure, a retained local pass, two imports with equal keys, and the interval before daemon adoption. Keep the existing add-only import behavior. If that needs a new status count beyond D5's mismatch reasons, the coordinator must record that clarification in D5/status before dispatch.

Done when a local current failure cannot appear as a current file **from** an import, and file/source counts agree with adopted states through both `--full` and `--json`.

## Should-fix note N1: default status explains a mixed cause as an environment difference

**Plausible, nonblocking.** `src/core/status/import-lines.ts:41`.

D5 says the default line is for an import with none current “because the environment differs,” and calls for silence otherwise. The predicate tests that at least one file has that reason. A two-project import with one environment mismatch and one content mismatch prints:

```text
Imported results from source: none current here, the environment differs (Node differs)
```

This behavior was reproduced through `importDefaultLines` with `currentFiles=0`, `environment=1`, `content=1`, and `testFiles=2`. It does not claim a false pass. The ambiguity is whether the sentence should imply the environment explains all non-current files. Before extending this text in the next slice, clarify that condition and add a mixed-project fixture. If it means every file, compare the environment count with the relevant file count; if it means some files, say so in the line. Existing fixtures cover only the all-environment case and the case with a current file.

## Nits

None.

## What fits

- **D1:** `environmentRecord` hashes and describes the same inputs from one read of runner files. Environment values and top-level config values are hashed. The added tables leave `schema.ts` and the key format unchanged. The new descriptor, environment-record and storage tests are current passes.
- **D2:** export reads keys, results and supporting lists in one read transaction. It selects results at each local key, omits pending/unkeyed files, and omits a whole file with any failure. It projects result fields rather than copying errors, summaries, logs or provenance.
- **D2 privacy probe:** exported bytes excluded sentinel environment value `secret-env-018`, config value `secret-config-018`, an absolute config value `/private/secret-home`, stored failure text, and the local worktree id. A closure path `/private/absolute` raised `AbsolutePathError`. This confirms the explicit data paths, not a promise to sanitize arbitrary strings in test names. GitHub source fields are the deliberate D2 exception: their values are recorded as required by the spec.
- **D3:** the single `BEGIN IMMEDIATE` import transaction includes result insertion, add-only lists and environment writes. Nested repository transactions use savepoints. It never writes `test_file_keys` or `known_states`. A key already held in `results` keeps its rows. Existing closure rows and observed entries are left alone. Dry-run throws inside the transaction and rolls it back. No run request is inserted by import.
- **D3 running daemon seam:** the round-trip and active-scheduler tests pass. Imported results have the import time as `recorded_at`; a running scheduler adopts them on its next interval without a restart or a test run. The CLI sends the existing retry IPC message; it does not claim immediate adoption.
- **D4 compatibility probe:** extracted actual 0.1.416 source from `7280f4469`, then opened a candidate-created temporary store with its `openStore`. That store held `imports`, `import_files`, `environments`, `worktree_environment_hashes`, an imported result, and a candidate-written imported known state. The old reader opened schema 1, listed the results (including `worktreeId: import:two`), and read the known state with `origin: null`, without throwing. No schema migration or version raise was needed.
- **D4 display:** the CLI round-trip test proves imported origin text through `status --full`, `why`, and no-run-log explanations. Hook count and recovery-provenance fixtures pass. Imported origin switches in derivation, result lookup and provenance handling agree on `import:<id>`.
- **D5:** the five mismatch reasons render in the specified order. Environment, closure and observed precedence precede content/no-key fallback. The ordinary no-import and irrelevant-import paths stay silent. The all-environment default case shows the first two differences. B1 limits the current-file attribution claim; N1 limits the mixed-cause wording claim.
- **D6:** the importer never adopts an exported key as a local key. Current result adoption still goes through the daemon's own computed key. A forged outcome at an actual key remains within the explicitly accepted user-chosen-file trust model.

## Inputs for the repair and next wave

- Dispatch B1 as a status-only repair. Ownership: `src/core/status/imports.ts`, import status types/rendering as needed, and `test/status/import-reasons.test.ts` plus one command-level fixture if needed. Do not change the import writer to replace local failures.
- Source attribution must follow `KnownState.validity === "current"` and `origin.kind === "imported"` with the matching import id. A local key match is eligibility evidence, not evidence that the daemon adopted that import.
- The trial must import first, start the lookup-only daemon, wait for key computation/adoption, then read status. Do not use the immediate CLI import counts as the trial's reuse count.
- Environment comparisons use `worktree_environment_hashes`; `worktree_environments` belongs to an older feature. Keep descriptors free of environment/config values. Preserve the `known_states` NULL-kind encoding for old readers.
- Retain all D5 reason precedence and the existing default-line silence tests while repairing attribution. Resolve N1's mixed-cause wording in the same fixture area if the coordinator chooses.
- No full-suite or local build budget was used for this review. Read the exact candidate CI result before landing/release; release still requires the exact release commit's passing full-suite CI. The cezar trial and transport are not implemented by these rows.
