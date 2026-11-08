# Wave 3.5 review: coverage provider past test mocks

## Verification

Candidate: `4e9117fb6d85d69ca13b73ccefff83277f1fa15d` (`cand/0.1.418`).
Range: `e9eba1e36..4e9117fb6`, the two commits after main's documentation head:
`9498a1aa3` (018-10) and `4e9117fb6` (0.1.418 bundles).

Commands below ran on the clean candidate unless marked as a disposable experiment.

| Command | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `4e9117fb6d85d69ca13b73ccefff83277f1fa15d`; matches the brief. |
| `git status --short` before and after candidate checks | Empty. |
| `pnpm install --frozen-lockfile` | Cezar supplied installed dependencies before this session; not repeated, as instructed. No independent install claim. |
| `pnpm run lint` | Exit 0. `Checked 2878 files in 1467ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0. `tsrs --fast --noEmit`; no diagnostics. |
| `pnpm exec vitest run test/runners/vitest/own-provider-mocks.test.ts test/runners/vitest/own-provider-worker.test.ts test/keys/key-format.test.ts test/version-sensitive.test.ts --maxWorkers=2` | Exit 0. `Test Files 4 passed (4)`, `Tests 23 passed (23)`, duration 7.12 s. Explicit targeted run required by the review brief. |
| `/home/agent/.nvm/versions/node/v22.19.0/bin/node node_modules/vitest/vitest.mjs run test/runners/vitest/own-provider-worker.test.ts test/runners/vitest/own-provider-mocks.test.ts --maxWorkers=1` | Exit 0. `Test Files 2 passed (2)`, `Tests 5 passed (5)`, duration 2.18 s. |
| Node 22.19.0 direct ESM provider import | All five `process.getBuiltinModule` calls return objects; `getProvider().name` is `squeal`. Verifies daemon-side import outside Vitest too. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/runners/vitest/own-provider-mocks.test.ts test/runners/vitest/own-provider-worker.test.ts test/keys/key-format.test.ts test/version-sensitive.test.ts` | Exit 0, revision 0. `4 test files, each with a current result`; no known failures. Worktree has 693 other unknown test files under lookup-only. |
| Squeal status selecting `src/core/code/coverage/provider.mjs` | Revision 0: 87 affected files, 6 current passes and 81 unknown, with nothing queued under lookup-only. These 81 are unverified, not failures. |
| `git diff --check` | Exit 0. |
| Read-only bundle comparison and SHA-256 manifest check | All four bundled providers equal the source byte for byte. All 32 other changed `dist` bundles differ only by `0.1.417` to `0.1.418`. No Codex runtime manifest hash mismatch. |

`pnpm run build` and a local full suite were not run, as the brief requires.
Build reproducibility remains unverified locally; the byte and manifest checks above do not claim a build.

CI: [run 42488454322](https://github.com/hearsay-tools/squeal/actions/runs/42488454322), exact candidate SHA.
At the final CI read, all three Node 22 shards were `in_progress`; the Node 24 lint/typecheck/version-sensitive job had completed with `success`.
The version-bump job and nightly Node 24 full-suite job were skipped.
Full-suite CI remains pending and is not claimed as passing. The release still needs the process's exact-commit CI evidence.

## Verdict

**FAIL**: 1 proven blocker, 1 proven should-fix, 0 plausible findings, 0 nits.
Unavailable or pending verification above is not a finding.

## Blockers

### B1. Corrected URL mapping can reuse incorrect version-3 records

**Proven.** Changed boundary: `src/core/code/coverage/provider.mjs:27`, used at line 87.

Spec 015 D8: a record is stored at the test file's result key plus the provider version.
`src/core/code/coverage/record.ts:19` states that the version is bumped when a record's meaning changes, including its mapping, so another meaning is never read as this one.
The wave brief explicitly permits a raise when "the records' meaning requires it."
Vision principle 2 forbids old evidence posing as current truth.

A URL-only mock distinguishes this from the path failure that produces no usable record:

```ts
import { clamp } from "../src/math.js";
vi.mock("node:url", async (original) => ({
  ...(await original()),
  fileURLToPath: () => "/mocked",
}));
test("clamp", () => expect(clamp(-1, 0, 10)).toBe(0));
```

Disposable experiment: archive the candidate, link its dependencies, and run this single fixture through `covering()`, `openFixture("own-provider", ...)`, `adapter.run`, and `buildRecord`.
First replace only the provider with `git show e9eba1e36:src/core/code/coverage/provider.mjs`; then restore the candidate provider and repeat the identical fixture.
Do not mock `fs`, `crypto` or `path` in this experiment. Both runs complete successfully and produce an ordinary record with `unread: []`.

| Provider | Provider version | Covered lines of `src/math.ts` |
| --- | --- | --- |
| Before fix | 3 | `[1,2,5,6,7,8,11,16,17]` |
| Candidate | 3 | `[5,6,11,13]` |

The function spans and hits differ too. The old provider looks up `moduleExecutionInfo` under `/mocked` and defaults the wrapper offset to zero. It maps the V8 ranges to incorrect source positions. The candidate restores the real lookup and changes the record's meaning.

An existing developer store can already hold the old record. Upgrading does not invalidate it:

- `src/runners/vitest/environment.ts:111` encodes Squeal coverage as only `{ provider: "squeal", version: COVERAGE_PROVIDER_VERSION }`; the constant stays 3.
- `src/core/keys/environment-hash.ts:21` explicitly excludes the Squeal release version. The 0.1.418 bump therefore does not distinguish these results.
- `src/core/code/crap/cache.ts:128` reads the record by the unchanged result key and provider version; the code-store reader has no further producer distinction.

A lookup-only start can adopt the passing test result and its incorrect coverage as current without a run. The key-format test passing does not rule this out: its component list does not independently version coverage mapping.

**One-worker fix:** raise the coverage provider version and add a focused URL-only regression plus an adoption check that an old version-3 record is not accepted by the new reader. Update the version comment, handle any key-alarm changes with evidence, and regenerate the bundles through the coordinator's normal candidate step. Do not change the global key format merely to silence an alarm. Verify the corrected covered lines and function spans, and that the old coverage cannot remain current after upgrade.

## Should-fix

### S1. The regression leaves a checkout-root artifact when it catches the old bug

**Proven, non-blocking.** `test/runners/vitest/own-provider-mocks.test.ts:75` through line 89.

In the disposable candidate archive with only the old provider restored:

```text
vitest run test/runners/vitest/own-provider-mocks.test.ts --maxWorkers=1
Test Files 1 failed (1)
Tests 1 failed (1)
AssertionError: expected false to be true
own-provider-mocks.test.ts:89:79
```

After Vitest finished, including its teardown, the disposable checkout root still held a file named:

```text
\tmp\squeal-vitest-1654059-jO1MSS\sq-own-provider-lKDFVl\coverage-G6rrZQ\.tmp\coverage-21c245fb-36f2-484a-9c62-20dc2a0699e9.json
```

The shared helpers remove fixture roots and coverage temp directories. The escaped relative filename is in the outer runner's working directory, outside both. The test catches the path failure but leaves the checkout dirty when that failure returns. This is a test containment issue; the fixed candidate's normal run stays clean.

**One-worker fix:** run the regression in a child with a disposable working directory and remove that directory in `finally`, or track and remove only the escaped artifacts owned by this test on every exit. Keep the assertions that the payload stays under reports and that a record exists. Repeat the before-fix failure and verify its enclosing checkout is clean after teardown. Avoid changing the parent process's working directory while other tests can run.

## Nits

None.

## What fits

- Every built-in used by the provider now comes from `process.getBuiltinModule`: `node:crypto`, `node:fs`, `node:inspector/promises`, `node:path`, and `node:url`. There is no remaining static or dynamic module import in this file for a module-runner alias or `vi.mock` to redirect. The direct calls use the real Node loader rather than Vitest's import path.
- `package.json` requires Node `>=22.19`; `install.sh` has `NODE_FLOOR=22.19`. The API exists before this floor. Actual Node 22.19.0 checks cover all five calls, daemon import, real Vitest mocks, and both Vitest worker call shapes.
- The changed provider preserves method signatures, directory precedence, batch delivery and the inspector session lifecycle. No parallel-module interface changed.
- The new regression fails before the fix and passes after it. Its normal candidate run keeps both payloads and verifies mapped source lines, rather than checking only that tests pass.
- `test/keys/key-format.test.ts` and key-relevant sources are unchanged; the explicit targeted key-format run passes. `COVERAGE_PROVIDER_VERSION` remains 3. That unchanged version is the blocker above, not evidence that mapping compatibility holds.
- All harness provider copies match. Other bundled JavaScript changes are solely the release version substitution, and the Codex manifest hashes match the committed files.

## Inputs for the repair wave

1. Keep the five native built-in lookups. Repair the version boundary, not the lookup fix.
2. Give the record-version repair ownership of `src/core/code/coverage/record.ts` and focused tests. Give regression containment ownership of `own-provider-mocks.test.ts` and a narrow helper if needed. A single worker can do both without a seam.
3. Test URL mocking on its own. The existing combined stub also disables filesystem writes, so it cannot prove the old URL-only record is rejected after upgrade.
4. Keep `startCoverage` before test execution, `takeCoverage` before `stopCoverage`, and read/map the payload before disposing its directories. Preserve worker directory fallbacks for Vitest 4 and explicit arguments for Vitest 5.
5. Use the existing 120-second adapter-test timeout. Read affected Squeal results and run the named key-format test. No routine full suite is needed for the repair review. The coordinator owns bundle regeneration and new candidate CI; exact-release full-suite evidence remains required before release.

The review changed no product code. Disposable probes and the escaped file were removed before committing this report.
