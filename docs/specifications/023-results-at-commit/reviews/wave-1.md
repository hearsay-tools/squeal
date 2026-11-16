# Wave 1 review

FAIL `f11962b246ad325495b1b2069a48bc6c77ba5dda`

Range: `2ca6a943c..f11962b24`, candidate `cand/0.1.528`, rows 023-03, 023-04 and 023-05. Counts: **3 proven blockers, 0 should-fix, 0 nits**. No product file was changed in this review.

## Verification

All local checks and probes below used the exact candidate with a clean tracked tree. Throwaway probes and their fixture repositories lived outside the worktree under `/tmp`; they were removed before this file was committed. The only deliverable is this review.

| Command or evidence | Actual result |
|---|---|
| `git rev-parse HEAD` | `f11962b246ad325495b1b2069a48bc6c77ba5dda`, as requested |
| `git status --short`, before and after the build and probes | Empty |
| `pnpm install --frozen-lockfile` | Squawk's launch context reports that it completed dependency setup in 1 s. Not repeated, as the brief explicitly instructs. No install stdout was supplied. |
| `pnpm run lint` | Exit 0: `Checked 3567 files in 1286ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: `tsrs --fast -p tsconfig.build.json && pnpm run build:plugin`; all four harness builds completed; no bundle drift |
| `git diff --check 2ca6a943c..f11962b24` | Exit 0, no output |
| Squeal affected source check, command below | Exit 3 at the wait deadline: 12 current passes, 75 pending, 261 unknown among 348 selected files. No known failures. Directory arguments selected no files; the named-test check below covers the new checkout and ps tests. |
| Squeal check of the nine new or extended test files, command below | Exit 0: `Named test files at revision 0: no known failures; 9 test files, each with a current result, after 11.4 s.` Three unknown files were requested and completed: files-only gate, parent-kill, and relaunch. Other current results can be inherited by content key; these are not a claim of fresh execution at this commit. |
| Broader gate compatibility check, command below | Exit 3 after 63.4 s: **19 current passes, 52 pending** among 71 files. No known failures. Existing gate compatibility is only partly verified. No direct duplicate run was started. |
| `timeout 600 pnpm exec vitest run --config /tmp/squeal-review-023-b7c/vitest.config.mjs` | External focused probes: exit 1, **3 tests failed**, 3.68 s. Failures prove B1, B2 and B3 below. An earlier two-probe run also failed both B1 and B2; the final run added store reuse and copy-in checks. |
| `gh run view 43961917517 --json status,conclusion,jobs` | At 2026-11-16 21:45 UTC: CI **in progress**, no overall conclusion. Node 24 lint/typecheck/version-sensitive job passed. Six Node 22/26 shard jobs were in progress. Nightly and version-bump jobs were skipped. Full-suite result is **unverified**, not a finding. [CI run](https://github.com/hearsay-tools/squeal/actions/runs/43961917517) |

Squeal commands used the pinned launcher. No full suite or full-suite checkpoint was requested. No changed test falls outside Squeal's configured coverage; no e2e change required a separate run.

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  src/core/commit/at-keys.ts src/core/commit/at-environment.ts \
  src/core/checkout/ src/cli/code-gate-files.ts \
  src/cli/code-gate-parent.ts src/core/ps/

"$SQUEAL" status --wait 60000 \
  test/checkout/checkout.test.ts test/checkout/location.test.ts \
  test/ps/checkouts.test.ts test/commit/at-keys.test.ts \
  test/commit/at-environment.test.ts test/cli/code-gate-files.test.ts \
  test/cli/code-gate-kill-parent.test.ts test/cli/code-gate-relaunch.test.ts \
  test/cli/code-gate-files-outcome.test.ts

mapfile -t review_gate_tests < <(rg --files test/cli test/code/gate | \
  rg 'code-gate.*test.ts$|/(evidence|stored|collect).*test.ts$')
"$SQUEAL" status --wait 60000 "${review_gate_tests[@]}"
```

## Blockers

### B1. Proven: a current closure does not prove a key at an older commit

**Location:** `src/core/commit/at-keys.ts:120`, return at line 128; `localClosures` at line 136.

**Contract:** D2.1: “the local closure list must hold every path the result's run read, or the file is `not determined (closure)`.” Row 023-03 must compute the commit's exact key. The brief explicitly says that a wrong key is a wrong pass.

The code proves that the list reproduces this worktree's current key, then applies that list to arbitrary older blobs. It never proves that the list covers the older run. A test whose source used to import an extra module loses that module from its current static closure. The current-key check succeeds, but the returned older key omits that input. `sideKeys` has the same problem when an old test reads a helper the current test no longer uses.

**Probe:** Use `catchUpRepo` and `catchUpSide`, the same real-scheduler/fake-runner fixture as the new done-when test. At commit A, `test/a.test.ts` has closure entries `src/a.ts`, `src/old.ts` and itself. Start its scheduler and record its key. At commit B, change `src/a.ts` and give the current runner the reduced closure `src/a.ts` and the test. Start B's scheduler last. Ask `keysAtCommit` in B for A. Its answer is a key, not an uncertainty:

```text
daemon at A: 98beac445953c2d9ac10d38c1e37b9f8ae6ec75d3bfebee81ce44825e2deb9a7
lookup at A: c9a423b55fca1174b16edb811381807d0c2fef3904ddebaa495c3368b8eaa342
step: 1
current closure: ["src/a.ts", "test/a.test.ts"]
expected (notDetermined OR exact daemon key): true
received: false
```

Changes confined to the omitted older input do not enter the returned key. At minimum this misses valid stored evidence; it also lacks the completeness condition that makes reuse safe. This is not the pre-existing re-key implementation: that implementation checks `holdsEvery(closure, file.closure.paths)` against the exported run's closure. The new API has no equivalent target-side proof.

**One-worker fix:** Repair the commit/side key boundary in `src/core/commit/at-keys*.ts` and its tests. Require evidence that the target run's closure is covered before returning a key; otherwise return `not determined (closure)`. Include the target's test-side imports and key parts in that proof. Add a regression with a shrinking closure, not just changed bytes under a fixed closure. Retain the existing exact-key tests for cases whose closure is proved.

### B2. Proven: the gate stores results under an environment it did not run

**Location:** `src/cli/code-gate-files.ts:106`, collectors at lines 135 and 138.

**Contract:** Row 023-04 calls for an entry point taking root, files, budget, **env** and store. D4.4 requires stored results to run under the conditions their keys represent. D5.3 requires the same named conditions on both sides.

`gateFiles` constructs `env` from `options.env` and passes it to `collectWithStores`, which uses it in keying. Neither collector receives it for execution. Runner creation and node:test prepare commands inherit `process.env`. Only `TMPDIR` is applied to the process. With `store: false`, the supplied environment is unused altogether.

**Probe:** A committed node:test fixture declares `REVIEW_023_ENV` in `env.allowlist`. Its single assertion requires the value `wanted`. Set the review process's value to `actual`, then call:

```ts
await runGateFiles({
  root, files: ["test/env.test.mjs"], budgetSeconds: 30,
  env: { ...process.env, REVIEW_023_ENV: "wanted" },
});
```

The result is `failed`, from `run`, with `AssertionError: 'actual' !== 'wanted'`. Set the actual process value to `wanted` and call again with default env. The second call returns that same incorrect failure **from `store`**. This proves that the mismatch persisted a result under the wrong conditions, not just that the option was ignored. The inverse assertion can persist a false pass.

**One-worker fix:** Make keying, config loading, prepares and both runners use one effective environment. Thread it through the execution APIs, or scope and restore it safely for the in-process call. Guard concurrent calls if any process-global environment is changed. Preserve D4's HOME rule: default calls keep the caller's HOME; an explicit proof condition must run under its requested environment and must not store results. Add a real runner test for an overridden and an unset variable, plus a store-reuse check and a `store: false` condition check.

### B3. Proven: copy-in can overwrite the user's tree through a base symlink

**Location:** `src/core/checkout/checkout.ts:128`, `copyFileSync` at line 130.

**Contract:** Goals 3 and 4 keep runs and proof overlays outside the user's tree. D5.2 copies the test version into the temporary checkout. The new copy API also states that it refuses a path that leaves the checkout.

The check rejects lexical `..` but follows destination symlinks, including symlinked parent directories. An old helper can be a tracked symlink while its current version is a regular file. Copying the regular file onto that old path follows the old link and modifies its target outside the checkout.

**Probe:** Make a `/tmp` repository with `src/user.ts` containing `original user content`. At A, commit `test/helper.ts` as an absolute symlink to that user-tree source. At B, replace the helper symlink with a regular file containing `new helper content`. Create a checkout of A with `createCheckout`, then call `copyIntoCheckout(checkout, root, ["test/helper.ts"])`. Reading `root/src/user.ts` gives:

```text
expected: original user content\n
received: new helper content\n
```

The experiment removed its checkout and fixture. The review worktree was not modified.

**One-worker fix:** Repair copy-in in `src/core/checkout/checkout.ts` with focused checkout tests. Ensure every destination parent is inside the checkout without following a symlink outside it. Replace or refuse a destination symlink before copying; do not write through it. Cover both a symlink at the destination file and a symlink in a parent directory, and assert that the user's files stay byte-identical.

## Should-fix

None in addition to the blockers.

## Nits

None.

## What fits

- D2's environment steps have distinct results for equal inputs, one stored pnpm match, ambiguous matches, config-only ambiguity, lockfile-only derivation, and npm/Yarn refusal after step 1. Tests cover these branches. Untracked closure input detection and mixed blob replacement have focused tests. B1 concerns closure completeness at the target, not blob hashing or the environment test cases already settled here.
- The library selects named files without passing dirty paths or declared `inputs` to selection. It returns file outcomes and failure text without evaluating CC/CRAP. Tests cover an assertion failure, an import failure, store reuse, HOME preservation and per-call TMPDIR restoration. B2 is the missing effective-environment boundary.
- The JSON relaunch leads its own group and watches its actual parent. The current passing SIGKILL test covers the relaunch process, a Vitest worker and its spawned child, and a separate node:test group within 5 s. Descendant-group enumeration and ordinary relaunch behavior have focused checks. No additional orphan defect was proved.
- Checkout creation takes the common-dir lock, prunes, writes a PID/start-time marker before adding a detached locked worktree, and creates the run directory. Tests cover an offline npm install, install failure output, removal, group shutdown, dead-owner sweep and incomplete-create cleanup. `ps` lists path, PID and age, flags dead owners, and filters by repository. B3 is the copy-in boundary.
- `squeal code --base` retains its selection and verdict path. The changed evidence fields add failure details; the new files-only API is separate. The broader compatibility run is pending as recorded above, so this is not a claim that all existing gate tests passed.

## Inputs for the fix wave and later rows

Dispatch B1, B2 and B3 as disjoint commit-key, gate, and checkout repairs. Re-review those repairs against these three findings before proceeding to wave 2. Preserve the existing current-key tests, named-file behavior, failure text and parent-kill check.

For 023-06: `keysAtCommit({ root, store, worktreeId, commit, files?, parts?, projectDir?, rehash? })` and `sideKeys({ ..., code, tests, testPaths })` return maps by `testFileId`. Honor every `notDetermined` result. `projectDir` must identify the project folder in a workspace. Step 3 needs `rehash` from the caller; per-package/runtime parts need exact target-side evidence, not an unchecked copy of the current parts. Do not expose the present API as an exact lookup until B1 is fixed.

For 023-07 and 023-08, the intended order remains:

1. Resolve a realpath common dir. Discover the package store and use `locateCheckouts`; print its fallback warning once. Sweep both this repository's cache and git checkout directories with `sweepCheckouts`.
2. `createCheckout` takes the repository mutation lock itself. It returns `tree` and `run`; use `run` for TMPDIR. Copy named test-side files with the repaired copy API.
3. Install with `installCheckout`, passing the **remaining** overall timeout. Call `runGateFiles` with the remaining seconds and the same effective environment, after B2 is fixed. Keep the default 600 s budget inclusive of install. Do not reset the budget at each step.
4. Only unconditional results may use `store: true`; proof conditions require `store: false`. The ordinary gate retains the caller's HOME. `runGateFiles.runs` carries per-file outcome, origin and failure text.
5. In cleanup, stop the run's groups before `removeCheckout`. Connect dead-owner sweep at command start and daemon prune. Those hooks are explicitly deferred in 023-05's notes and are not implemented by this foundation wave.

The future orchestration must also ensure that an in-process gate's runner groups and the install's detached group cannot survive the command's SIGKILL. The current relaunch-parent test proves the JSON child path only; the marker has no group ID and sweep removes folders, not processes. This is unfinished later-wave integration, not an additional finding against the scoped done-whens here.
