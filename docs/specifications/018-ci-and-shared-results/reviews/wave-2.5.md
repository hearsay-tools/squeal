# Wave 2.5 narrow re-review: import attribution

Candidate: `ea776c75c0f80a5ec17793a444d69f793450db06` (`cand/0.1.417`). Range: `ee17cb230..ea776c75`. Reviewed 2026-11-08.

## Verification

Checks ran at the exact candidate on a clean tracked tree, before writing this file. The independent probe lived outside the tree and used temporary repositories and stores. No product code was changed.

```text
$ git fetch origin cand/0.1.417
From https://github.com/hearsay-tools/squeal
 * branch cand/0.1.417 -> FETCH_HEAD
$ git checkout ea776c75c0f80a5ec17793a444d69f793450db06
HEAD is now at ea776c75c chore: 0.1.417 bundles with repair 018-09
$ git rev-parse HEAD
ea776c75c0f80a5ec17793a444d69f793450db06
$ git status --short
(empty)
$ pnpm run lint
$ biome check .
Checked 2871 files in 1062ms. No fixes applied.
exit 0
$ pnpm run typecheck
$ tsrs --fast --noEmit
exit 0
$ git diff --check
(empty, exit 0)
$ git diff --exit-code ee17cb230..HEAD -- test/keys/key-format.test.ts src/core/store/transfer.ts src/core/store/transfer-bundle.ts src/core/store/transfer-rows.ts src/core/store/imports.ts
(empty, exit 0)
```

Dependencies were already installed. Per the brief, no install, local build, full-suite request or full-suite run was repeated. Squeal was validating the changed tests, so no duplicate Vitest run was needed.

Affected checks used `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`. Output excerpts:

```text
$ squeal status --wait 60000 src/core/status/imports.ts src/core/status/import-lines.ts src/core/types/status.ts test/status/import-reasons.test.ts test/cli/transfer.test.ts
Revision: 3 · ea776c75 + 0
Selected: 583 test files
Current (224): 224 pass
Pending (359)
Named test files have no verdict: deadline passed after 60.8 s
Worktree: known failures 0
exit 3

$ squeal status --wait 60000 test/status/import-reasons.test.ts test/cli/transfer.test.ts
Revision: 3 · ea776c75 + 0
Selected: test/status/import-reasons.test.ts, test/cli/transfer.test.ts
Named test files at revision 3: no known failures; 2 test files,
each with a current result, after 2.8 s.
exit 0

$ squeal status --wait 60000 src/core/status/imports.ts src/core/status/import-lines.ts src/core/types/status.ts test/status/import-reasons.test.ts test/cli/transfer.test.ts
Revision: 3 · ea776c75 + 0
Current (404): 404 pass
Pending (179)
Named test files have no verdict: deadline passed after 61.0 s
Worktree: known failures 0; not current: 180 of 1514 test files
exit 3
```

The broader selection remains **unverified**: 179 selected files were still pending after the second wait, including files awaiting the coordinator's shared run. The two changed test files have current results. Temporary heartbeat delays recovered while the daemon continued validation. Pending checks are not findings.

```text
$ gh run list --branch cand/0.1.417 --limit 4 --json databaseId,headSha,status,conclusion,url
42463506305: ea776c75c0f80a5ec17793a444d69f793450db06, in_progress
42461609267: ee17cb2306c449e2a31acea3e524121ff8da20f7, success
$ gh run view 42463506305 --json headSha,status,conclusion,jobs
headSha: ea776c75c0f80a5ec17793a444d69f793450db06
status: in_progress; conclusion: ""
Node 22 (1/3), (2/3), (3/3): in_progress
Node 24 (lint, typecheck, version-sensitive): in_progress
Bundle changes bump the version: skipped
Node 24 (nightly, full suite): skipped
```

Exact-candidate CI: <https://github.com/hearsay-tools/squeal/actions/runs/42463506305>. Its full-suite and build/bundle results are **unverified**, pending completion. The earlier candidate's passing run is not evidence for the repair commit.

## Verdict and scope

**PASS**: 0 blockers, 0 new should-fix findings, 0 nits. Prior B1 is resolved. Prior N1 is resolved under amended D5.

This is bounded by `reviews/wave-1-2.md` B1 and N1. I read that file first, then checked the delta against D5 and the recorded amendment. The product delta is limited to import status derivation, rendering and types, their two test files, and rebuilt bundles. The prior review's export, key safety, privacy and old-reader conclusions were not re-prosecuted. The import writer and key-format test are unchanged in this range.

## B1: resolved

`src/core/status/imports.ts:101` now sends an equal key through adoption checks. `currentByFile` at line 129 includes only current test/file states. `adoption` at line 116 requires a nonempty set whose origins all name this import. File attribution and result attribution use that same grouped evidence.

An equal key with a different current producer reads “another result kept at the same key.” An equal key with stored imported evidence but no adopted current state reads “not adopted yet.” This matches D5 as amended. The repair does not replace local results to manufacture import credit.

Independent reproduction command:

```text
$ pnpm exec tsx /tmp/squeal-018-rereview.mts
exit 0
```

The throwaway probe created separate git repositories and real stores. It stored local key rows and results, called `importResults`, and invoked the actual CLI `main` with `status --full`, `status --json` and default `status`. It parsed the JSON and checked the full-text counts and reason labels against it. It also asserted that current-file and non-current reason counts sum to the relevant file count. The probe was removed after verification.

| Case | Actual current files/results from the named import | Actual reason |
|---|---:|---|
| Local failure retained at the same key, import A adds zero results | 0 / 0 | `sameKeyKept: 1` |
| Local pass retained at the same key, import A adds zero results | 0 / 0 | `sameKeyKept: 1` |
| Import A stored, not yet adopted | 0 / 0 | `sameKeyNotAdopted: 1` |
| Import B at A's key, before A is adopted | 0 / 0 | `sameKeyKept: 1` |
| Import A after adoption | 1 / 1 | All reasons zero |
| Import B after A is adopted | 0 / 0 | `sameKeyKept: 1` |

Both retained-local cases also asserted that the local result's outcome and key row stayed unchanged. The kept-failure reproduction now renders:

```text
Imported: 0 of 1 test file current from local export at cccccccc (0 current results)
  Not current: 1 another result kept at the same key
```

Before adoption, A renders:

```text
Imported: 0 of 1 test file current from local export at cccccccc (0 current results)
  Not current: 1 not adopted yet
```

The JSON uses the same zero counts and the corresponding `sameKeyKept` or `sameKeyNotAdopted` count. After adoption only A gains the current file/result. Default status stays silent for these non-environment reasons. No mismatch between `--full` and `--json` was found.

The changed fixtures also exercise the real scheduler round trip: the command-level retained-results test keeps a local failure and passes as local results after import, then checks zero import credit and the kept-result reason. Both changed test files are current in Squeal.

## N1: resolved

Amended D5 requires every non-current file to differ by environment before the default line appears. `src/core/status/import-lines.ts:44` now checks the environment count against all relevant files while requiring zero current files.

The independent CLI probe imported two files in different projects, with one local environment mismatch and one local content mismatch. Actual JSON counts were `currentFiles: 0`, `currentResults: 0`, `environment: 1`, `content: 1`; `--full` named both reasons. Default status contained no import line. The new mixed-cause fixture verifies the same condition. The existing all-environment fixture still verifies the positive case and its first-two-differences text.

The reason order is now: another result kept at the same key, not adopted yet, environment, closure, observed, content, no local key. The original mismatch order is preserved after the two new reasons. The coordinator's revised labels appear in the source, fixtures and generated CLI bundles.

## Blockers, should-fix and nits

None in this narrow re-review. The prior blocker and note need no further repair.

## What fits and inputs for the next wave

- Keep status credit tied to adopted current states. Import counts printed immediately by the CLI describe added rows; they do not prove adoption.
- The trial must import, start the lookup-only daemon, wait for key computation and adoption, then read status. Report `sameKeyKept` and `sameKeyNotAdopted` separately from key mismatches.
- The default import line is only for an all-environment mismatch. Mixed reasons remain available through `--full` and `--json`.
- Keep the import writer add-only and the older-reader encoding intact. This repair does not change them or any key input.
- Read the exact-candidate CI result before landing. Release still needs passing full-suite CI at the exact release commit. Pending broad affected checks and CI are verification limits, not a new FAIL finding.
