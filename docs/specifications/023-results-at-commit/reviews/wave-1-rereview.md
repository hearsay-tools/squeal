# Wave 1 narrow re-review

FAIL `c56b15d844b83be566b6fa7aed0a248dbbbf6c75`

Range: `f11962b24..c56b15d84`, candidate `cand/0.1.528`. Scope: B1, B2 and B3 from `a6743b5a3:docs/specifications/023-results-at-commit/reviews/wave-1.md`, plus the repair delta. **1 proven blocker remains: B1. B2 and B3 are closed. No new findings, should-fix items or nits.**

## Verification

The checks used the exact candidate and a clean tracked tree. The build left it clean. Probes and fixture repositories lived under `/tmp` and were removed before committing this review. No candidate code was changed.

| Command or evidence | Actual result |
|---|---|
| `git fetch origin && git checkout --detach c56b15d844b83be566b6fa7aed0a248dbbbf6c75` | Exit 0; HEAD is the requested commit |
| `git status --short`, after build and probes | Empty |
| Dependency setup | Existing install retained, as the original task instructs. This repair does not change the lockfile or dependency declarations. `pnpm install` was not repeated. |
| `pnpm run lint` | Exit 0: `Checked 3570 files in 2s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0; all four harness builds completed; no bundle drift |
| `git diff --check f11962b24..c56b15d84` | Exit 0, no output |
| Squeal command below | Exit 0: `Named test files at revision 2: no known failures; 8 test files, each with a current result, after 38.8 s.` Other worktree tests remained queued or unknown. Current content-key results can be inherited; this is not a claim that every file executed freshly at this SHA. |
| `timeout 600 pnpm exec vitest run --config /tmp/squeal-rereview-023-b7c/vitest.config.mjs` | External focused probes: 4 tests, **3 passed, 1 failed**, 8.78 s. Original abstract B1 probe completed and logged its answer; B2 and B3 passed; real-runner B1 coverage assertion failed. |
| Same command with `-t 'B1 real runner'` | Extended the same real-runner probe through `keysAtCommit` and the scheduler: **1 failed, 3 skipped**, 6.32 s. Exact output below. |
| `gh run view 43966537744 --json headSha,status,conclusion,jobs` | Observed at 2026-11-16 22:09 UTC: `headSha` equals the candidate; CI **in progress**, no overall conclusion. Six Node 22/26 shards and the Node 24 job were in progress. Nightly and version-bump jobs were skipped. Full-suite CI is **unverified**, not a finding. [Run](https://github.com/hearsay-tools/squeal/actions/runs/43966537744) |

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  test/commit/at-keys.test.ts test/commit/at-keys-coverage.test.ts \
  test/cli/code-gate-files-env.test.ts \
  test/cli/code-gate-files-environment.test.ts \
  test/cli/code-gate-files.test.ts test/checkout/checkout.test.ts \
  test/cli/code-gate-relaunch.test.ts test/cli/code-gate-kill-parent.test.ts
```

No full suite or checkpoint was requested. The repair adds no relevant test outside Squeal's coverage.

## Remaining blocker

### B1. Proven, still open: an unchanged glob changes a real runner's closure

**Location:** `src/core/commit/at-keys-coverage.ts:75` filters parsing to changed files; line 112 accepts the closure when its listed paths have equal blobs. The glob rejection at line 142 is therefore never reached for an unchanged importer.

**Contract:** D2.1: “the local closure list must hold every path the result's run read, or the file is `not determined (closure)`.” This is the original B1 completeness failure, not a new scope item.

The repair catches a changed test or source whose older text explicitly imports an omitted file. It does not establish the broader assumption in its comment: a static closure is not solely a function of the bytes in its current list. Vite expands `import.meta.glob` from the repository's file set. Removing a matching file changes the static closure even when every remaining closure file is byte-identical. Resolution configuration can also affect a closure, so file-byte equality is not a general proof of target coverage.

**Real-runner reproduction:** Create a committed fixture under `/tmp`, with `vitest.config.mjs` selecting `test/*.test.ts`. Use the real `createVitestAdapter`, not a fake graph. At A, these files exist:

```ts
// src/plugins/kept.ts
export const name = "kept";
// src/plugins/old.ts
export const name = "old";
// src/registry.ts
const plugins = import.meta.glob("./plugins/*.ts", { eager: true });
export const count = Object.keys(plugins).length;
// test/a.test.ts
import { it, expect } from "vitest";
import { count } from "../src/registry";
it("counts", () => expect(count).toBe(1));
```

Read A's real adapter closure and close that adapter. At B, only remove `src/plugins/old.ts` and commit. Read B's real adapter closure. The importing test, registry, kept plugin and runner config have not changed. The closure arrays are:

```text
A: src/plugins/kept.ts, src/plugins/old.ts, src/registry.ts,
   test/__snapshots__/a.test.ts.snap, test/a.test.ts
B: src/plugins/kept.ts, src/registry.ts,
   test/__snapshots__/a.test.ts.snap, test/a.test.ts
targetCoverage(B's list over A): null
expected: a closure gap, because A reads src/plugins/old.ts
```

For the API check, start the real scheduler in B with the real Vitest adapter. The external test reused `catchUpSide` for store and scheduler setup and supplied the actual adapter through `wrapRunner`. It did not use the fake runner's closure or results. A local symlink for the `vitest` package allowed fixture resolution without an install or network; no installed lockfile was present. Call `keysAtCommit` with that scheduler's store and worktree ID, A's commit and `inputs: []`. It returns:

```text
key:         6f0dc737f7a8ca6494b646d37b32d7cfa83e02a4f064dafd73df81c35d0d746e
environment: 65d00755ecdcb6a11203df2efcf224597581ed345f2a9a52ce73433c7694e5d5
step:        1
```

Using the same environment, A's actual adapter closure and A's blobs with `keyOver` gives:

```text
expected:    d2af7be6cac9ae5c16fd611bd08696f44586793b52c27750310f7c2f0e02ff9b
```

All paths retained in B's list have equal blobs at A and B. The projected key therefore also ignores changes in the omitted plugin. The existing current-key proof cannot repair that omission. A's test counts two plugins while B's counts one, so reusing B's pass at the projected key is not evidence for A.

The original abstract probe was also repeated. It still produces a key when the fake runner changes its list without corresponding import text. That stub alone need not decide the review. The real glob case above proves that the stated limit is reachable with a supported runner.

**Bounded fix:** Repair target-closure proof in `src/core/commit/at-keys-coverage.ts`, its use in `at-keys.ts`, and the relevant tests. Inspect unchanged importers before accepting equal list blobs. Refuse globs and other resolution-dependent cases when target coverage has no proof, or derive their target inputs from the target file set. Keep the uncertainty result as `not determined (closure)`. Add a regression using the real Vitest adapter with the unchanged glob and a removed match. Assert the API's uncertainty or exact target key, including `sideKeys`. Preserve the fixed literal-import and unchanged ordinary-file cases.

Do not treat another extension/stem check as a general closure proof. One owner must establish target completeness, including target file-set and resolution inputs, before the code returns a key.

## Closed blockers

### B2. Proven fixed: execution and store keying use the supplied environment

`runGateFiles` now holds one effective environment across config loading, collection, prepares and store writes. `withEnvironment` restores variables, including unsets, and rejects overlapping calls when one holds a changed environment. Conditions outside the key require `store: false`.

The original external node:test probe now passes under `REVIEW_023_ENV=wanted`, while the caller's `actual` value is restored. A second call after the process adopts `wanted` reads a **pass from the store**. The repair's current passing tests cover both Vitest and node:test, overridden and unset variables, conditions without storage, restoration and concurrency. The original poisoning scenario is closed.

### B3. Proven fixed: copy-in replaces a final symlink and refuses symlink parents

The copy function walks destination parents with `lstat`, refuses symlink parents, unlinks an existing destination file or symlink, and creates the copy exclusively. The original external fixture now keeps `src/user.ts` equal to `original user content`; the helper in the checkout receives the new content. Current passing checkout tests also cover a symlinked parent directory. The original write-through scenario is closed.

## Should-fix and nits

None. No additional finding was raised from the repair delta.

## What fits and next-wave inputs

B2 and B3 need not be re-prosecuted unless another diff changes those boundaries. The eight affected test files, lint, typecheck and clean build passed as recorded. Existing named-file selection, relaunch and parent-kill behavior stayed current in the focused Squeal checks.

The B1 repair makes `KeysAtInput.inputs` mandatory. Later callers must pass the target policy's declared inputs. That API addition does not itself prove target closure completeness. The CLI lookup and proof-side consumers must continue to honor `notDetermined` and must not turn the present projected keys into known results until B1 is closed.

Other orchestration inputs remain as in the first review. This re-review does not reopen those settled sections. CI is still pending in the recorded evidence. This is the second FAIL for this candidate mechanism; the coordinator decides the next step under `docs/process.md` step 6.
