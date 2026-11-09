# Wave 5: CI export 0.1.421, review after repair R3

## Verification

Candidate: `3fa3f9189d86d8e51c23abb311554f5e4bb06e2c`. `git rev-parse HEAD` returned that exact SHA. Reviewed `origin/main..3fa3f9189d86d8e51c23abb311554f5e4bb06e2c`; the local `origin/main` was `674ffbc690fc78775a7432e42aa5c5ca43d31546`. This is a bounded re-review of `wave-5-0.1.421.md` and `wave-5-0.1.421-r2.md`, including the new R2/R3 hook and the cases the brief names. Read D8/D9, the amendment log, the R1/R2/R3 briefs and the worker notes.

The candidate tree was clean before and after all checks and probes, before writing this report. No product source or test changed. Dependencies were installed by Cezar; the brief expressly forbids repeating installation. No build or local full suite was run, as requested. Temporary scripts and fixtures lived below this task's `$TMPDIR`, outside the worktree, and were removed before this report's commit.

| Command | Actual output/result at the candidate |
| --- | --- |
| `pnpm run lint` | Exit 0: `Checked 2923 files in 1034ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm exec vitest run test/ci/inputs.test.ts test/ci/export-evidence.test.ts test/ci/export-snapshot.test.ts test/ci/export-check.test.ts test/ci/export-keys.test.ts test/ci/export.test.ts test/ci/export-wrapper.test.ts test/cli/ci-export.test.ts test/runners/vitest/ci-evidence.test.ts test/runners/vitest/ci-evidence-writes.test.ts test/runners/vitest/ci-runs.test.ts test/keys/key-format.test.ts --maxWorkers=2` | Exit 0: **12 files, 74 tests passed**, 16.70 s. This explicit run was required by the brief. It includes all seven wrapper cases, the four-file two-shard comparison and the key-format alarm. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/ci/inputs.test.ts test/ci/export-evidence.test.ts test/ci/export-snapshot.test.ts test/ci/export-check.test.ts test/ci/export-keys.test.ts test/ci/export.test.ts test/ci/export-wrapper.test.ts test/cli/ci-export.test.ts test/runners/vitest/ci-evidence.test.ts test/runners/vitest/ci-evidence-writes.test.ts test/runners/vitest/ci-runs.test.ts test/keys/key-format.test.ts` | Exit 0 at revision 0: `12 test files, each with a current result, after 1.3 s. Worktree: known failures 0; all 1543 test files current`. These are Squeal current results, not a local full-suite run. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/core/ci/export.ts src/core/ci/export-inputs.ts src/core/ci/inputs.ts src/runners/vitest/ci-record.ts src/runners/vitest/ci-runtime/evidence.cjs src/runners/vitest/ci-runtime/evidence-hooks.cjs` | Exit 0 at revision 0: `273 test files, each with a current result, after 2.2 s. Worktree: known failures 0; all 1543 test files current`. |
| `pnpm exec tsx "$TMPDIR/squeal-review-421-r3-ox4bg48f/probe.mts"` | Exit 0. Real record: **2 test files, 2 tests passed**, command exit 0. Real export: `Exported 2 test files, 4 results`. The artifact contains two pass rows for the descriptor test at `BAD!`. Independent Vitest at that content: exit 1, `expected 'BAD!' to be 'GOOD'`. Details in B1. |
| `pnpm exec tsx "$TMPDIR/squeal-review-421-r3-ox4bg48f/matrix.mts"` | Exit 0. Fourteen small hook fixtures assert the write, link, recursive-listing, child and thread results below. They also prove the read-only `FileHandle` variant and the two nonblocking notes. |
| `git diff --name-only origin/main..HEAD -- src/runners/observe src/core/keys src/core/hash src/core/scheduler/keying.ts test/keys/key-format.test.ts` | Exit 0, empty output. The source diff is confined to CI code and CLI entry points. No daemon recorder, key input or key-format test changed. |

CI: [42684175864](https://github.com/hearsay-tools/squeal/actions/runs/42684175864), exact candidate. Last observed: Node 24 lint/typecheck/version-sensitive/build job **success**; all three Node 22 shards **in progress**. Nightly Node 24 and the version-bump job are conditionally skipped. Exact-candidate full-suite CI remains **unverified**, not a finding. The coordinator still needs the exact release commit's passing CI before release.

## Verdict

**FAIL: one continuing proven blocker, B1. Two proven nonblocking notes; no nits.** B2, B3, B4 and S1 stay resolved. R3 fixes the reported same-turn overwrite of evidence, but the evidence set still does not include every content used by the run. A read-only open's hash stands for later descriptor reads that the hook does not observe. A real recorded pass is exported at content on which the same test fails.

## Blocker

### B1 — Proven, continuing: a read-only descriptor's later contents never enter the evidence set

Locations: `src/runners/vitest/ci-runtime/evidence-hooks.cjs:124` (read-only open certified immediately), `:85` and `:120` (read wrappers omit `read`, `readSync`, `readv` and handle methods); `src/runners/vitest/ci-runtime/evidence.cjs:162` (numeric descriptors and file handles are not paths).

D9 requires **“every input has evidence the run took while reading it ... no write during the run cancelled it, and the export checkout matches it.”** R3 rule 1 requires a set across the whole run, where two contents cancel a path. Vision: **“An old result never gets to pose as the current truth.”**

The new per-turn flush correctly preserves two values when both accesses reach `evidence.read(path)`. It does not help an access through a read-only descriptor. The hook hashes the path before `openSync(path, 'r')`, then neither observes the bytes that descriptor consumes nor invalidates its earlier evidence. `readFileSync(fd)` also passes a number to a function that accepts only paths. `FileHandle.readFile()` bypasses the wrappers altogether.

One real recorder/export proof, with an independent failing run:

1. Make a committed fixture with Vitest config `include: ['test/*.test.ts']`, `maxWorkers: 1`, `disableConsoleIntercept: true`; ignore `data/` and `node_modules/`. Add a plain passing control file. Prepare ignored `data/value.txt` as `BAD!`.
2. The committed descriptor test opens that file with `openSync(url, 'r')`. It uses `readSync(fd, bytes, 0, 4, 0)` and confirms `BAD!`. It logs `REVIEW_DESCRIPTOR_READY`, then polls the same descriptor at position 0, at 5 ms intervals for at most 1,500 ms, and expects the bytes to become `GOOD`. It closes the descriptor. The test changes no input itself.
3. Record a wrapper that starts the project's Vitest with piped stdout. Upon that marker, the wrapper calls `sh` to write `GOOD` to the file. After Vitest exits, it calls `sh` to restore `BAD!` and returns Vitest's exit code. The wrapper performs no Node filesystem write to the input. The marker's direct output makes the write occur while the test runs; recording succeeds only if the test actually reads `GOOD`.
4. Record exits 0: two files and two tests pass. The part records `data/value.txt` as `2d44917b56c83488042edd88a44fd34eaae0764f`, the Git blob of `BAD!`. It reports the descriptor test as pass, with that data path among its observed inputs. There is no evidence of `GOOD`.
5. Export at the restored `BAD!` content exits 0 and writes two files/four results, including both file and check passes for the descriptor test. Its exported closure is:

   ```text
   data/value.txt
   test/__snapshots__/fd.test.ts.snap
   test/fd.test.ts
   ```

   The exported file key is `2dc2a5958d65481b276bcd64432c70093e967b9797f250f1a442ef4e9ae69a08`. Both its result rows are `pass` at that key. The unchanged plain control also exports.
6. Run the same project's Vitest directly on `test/fd.test.ts`, with the same `CI=true` and the same `BAD!` input. It exits 1: `expected 'BAD!' to be 'GOOD'`. The source and config are unchanged. The input's temporary version, which made the recorded test pass, was never certified.

This continues B1's input-proof failure. It is not a missing input in the exported closure, a changed key algorithm, or a snapshot/environment tolerance issue. Export receives an internally consistent key for the wrong result content.

The smaller hook matrix independently confirms the mechanism without Vitest timing: open `v` read-only at `GOOD`, let `sh` change it to `BAD!`, consume it with `readSync(fd)`. The script prints `BAD!`; `readEvidence()` still keeps only the blob of `GOOD`. Repeating with `await fs.promises.open('v', 'r')` and `handle.readFile('utf8')` gives the same result. No second hash reaches the set.

Worker-sized conservative fix: in the CI layer, track the path reached by each successful descriptor/handle open. On descriptor or handle consumption, cancel that input unless the implementation can certify the content actually consumed and its stability. Cover `read`/`readSync`, vector reads, file-handle read methods, descriptor overloads of `readFile`, and streams using existing descriptors. A path hash taken only at open must not survive as proof of later reads. Do not modify the daemon recorder, remove the data path from the key, or restore the endpoint shortcuts. A conservative omission for these unsupported consumers is enough; the ordinary four-file comparison must still export four files. Retain the fixture above and the read-only handle variant as regressions.

This report does not claim that adding one more pre-read hash proves stability against every external writer. The repair must either supply the requested proof or leave the dependent file out.

## Should-fix notes

These are proven hook-level gaps from the requested matrix, recorded as nonblocking notes under the bounded re-review rule. No second complete false-pass proof was run.

### N1 — Proven, nonblocking: a replacement child/thread environment loses the CI evidence hook

Locations: `src/runners/vitest/ci-record.ts:163` (hook/settings installed in the command environment); `src/runners/vitest/ci-runtime/vitest-ci.cjs:207` (evidence installation depends on those settings). The CI layer adds no child/Worker propagation wrapper.

With the daemon recorder and CI hook both preloaded, the parent reads `v` as `GOOD`. It then starts a Node child with `execFileSync(process.execPath, ['worker.mjs'], { env: {} })`; the child writes `GOOD` back to `v`. The evidence still retains the blob of `GOOD`. The same occurs for `new Worker(url, { env: {} })`. These are real writes and should cancel the path under R2/R3 even when the bytes are unchanged.

The daemon's recorder restores its own settings/preload to these descendants, but does not know the separate CI evidence hook. Thus losing CI evidence can leave earlier parent evidence in place; it does not always just omit a file. Default inherited child and Worker environments, including `SHARE_ENV`, pass the matrix's read/conflict checks.

Suggested follow-up: propagate the CI hook and evidence settings through the CI layer at the child/Worker boundary, or conservatively cancel certification when a descendant can run outside it. Preserve the command's exit and output contract and keep the daemon recorder unchanged. Test replacement environments as well as inheritance.

### N2 — Proven, nonblocking: descriptor timestamp changes retain evidence

Location: `src/runners/vitest/ci-runtime/evidence-hooks.cjs:101`. Path `utimes`/`lutimes` are wrapped; `futimes`, `futimesSync` and `FileHandle.utimes` are not.

Open `v` read-only, call `fs.futimesSync(fd, 1, 1)`, close it. Open `w` read-only with `fs.promises.open`, call `await handle.utimes(1, 1)`, close it. The matrix's evidence keeps both paths' original hashes. The timestamp updates succeed. In contrast, the path-based `utimes`/`lutimes` cases cancel evidence.

R3 made time changes optional when not trivial, so this is not a new blocking interpretation. If they are intended to count as touched, use the same CI descriptor/handle path tracking as B1 to cancel them and add the two regressions.

## Nits

None.

## What fits and what was checked

| Required case | Evidence and result |
| --- | --- |
| Wrapper A, ignored input changed after tests | Both Node and `sh` writers pass the regression: changed test omitted, plain control retained, independent run fails. |
| Wrapper B, tracked module changed then restored | Both writers pass with the same omission/control/failing-run assertions. |
| Wrapper C, generated module created then removed | Both writers pass with the same assertions. No clean-checkout or absence shortcut remains. |
| Wrapper D, two path reads in one turn around `sh` rewrite | Passes. `GOOD` and `BAD` both reach the evidence reader and cancel the path. The standalone evidence test also cancels content/absence and changed listing pairs. B1 above is the descriptor variant, not a repeat failure of D. |
| Descriptor/handle writes | Existing tests and matrix cancel paths opened `r+`/`O_WRONLY`, sync and callback writes, `FileHandle.writeFile`, `ftruncateSync`, `FileHandle.truncate`, and a stream using an existing writable fd. Cancellation at writable open is conservative and effective in these cases. Read-only consumption remains B1. |
| Streams, truncation, append, copies | Factory and constructed write streams, path truncate, empty append, `copyFile` and `cp` destinations cancel evidence. Copy sources remain certified when unchanged. |
| Renames and deletes | Matrix cancels both rename names, unlink, rm, and a descendant of a recursively removed directory. Tree cancellation is applied by `readEvidence`. |
| Timestamp updates | Path `utimes`/`lutimes` cancel. Descriptor/handle forms remain N2. |
| Symbolic links | Reads through file and directory links record the target. Writes through file links, directory links, descriptors and streams cancel the real target. The matrix also confirms cancellation when a write through a dangling final link creates its target. No claim about arbitrary concurrent link retargeting is made. |
| Recursive directory listings | Every listed directory gets its own names hash. Matrix changes `tree/sub/` through `sh` between two recursive listings: only that conflicting listing loses evidence; unchanged parent/deeper listings remain. |
| Child processes and worker threads | Default inherited child, default Worker and `SHARE_ENV` Worker each record a child-only read and cancel two different values across parent/child. Replacement environments remain N1. |
| B2 and S1 | Real snapshot-format mismatch refuses, matching format exports; snapshot fields are compared apart from the separately refused update mode. Boolean tolerance fixture uses the safe direction and passes. |
| B3 | Real incomplete-shard and empty-directory regressions pass. Unit tests retain unequal count and duplicate index refusal. |
| B4 | Both different-line duplicate names and same-name `test.each` files are omitted with a reason. No guessed daemon identity is exported. |
| Useful clean export | Real two-shard comparison exports **4 files, 12 results, 0 uncertified, 0 unkeyed**, equal to the daemon's keys, closures and results. All four source-key reproduction checks pass. |
| Daemon and keys | Recorder output with and without the CI hook agrees in `ci-evidence.test.ts`. `test/keys/key-format.test.ts` passes unchanged. The range changes no daemon recorder or key input. |

Part format remains `squeal-ci-part/3`. The exporter requires evidence from the file's own shard for every closure path; the evidence reader correctly unions conflicting values across files/processes/threads and removes written trees. Those seams work when the access reaches the hook. No import re-keying change is needed to fix this producer's missing evidence.

## Inputs for the coordinator and next wave

- B1 is still a producer honesty failure. Do not publish these exports as certified current passes while unsupported later reads can retain an earlier hash. Another repair is the coordinator/human's decision under process step 6; this review authorizes none.
- A follow-up can stay within the CI runtime and its tests. Use one owner for descriptor/handle-to-input identity and evidence cancellation. Preserve the four-file useful export and all seven wrapper regressions. Keep the daemon recorder, key inputs, import reproduction proof and B2/B3/B4 repairs unchanged.
- Use no post-command content hashes, clean-tree inference or missing-path inference as substitutes for run evidence. A missing or unsupported observation must cancel certification, not silently preserve a prior value.
- Keep publish downstream of a successful export. Exit 0 currently does not establish B1's content rule. Exact-release full-suite CI remains separate, still pending when this review was filed.
