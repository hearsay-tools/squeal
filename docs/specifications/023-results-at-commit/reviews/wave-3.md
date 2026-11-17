# Wave 3: keys at a commit after fix A

FAIL `f94f09f712632db5bd9e4953ee63692e72bce86c`

Candidate `cand/023-03`, range `d7b5e76f3..f94f09f71` (two commits). Row 023-03 only. **2 proven blockers, 0 should-fix, 0 nits.** Both blockers affect `keysAtCommit` and `sideKeys`. The original shrinking-closure and removed-glob cases are fixed, but target closure equivalence is still not proved. No product file was changed.

## Blockers

### B1. Proven: a larger current static closure gives a wrong older key

**Location:** `src/core/commit/at-keys-coverage.ts:144`, acceptance at line 161; `importsGap` at line 166; `src/core/commit/at-keys.ts:144` hashes the whole current list.

**Contract:** D2.1 requires the commit's key from its files, with the closure rule. The assigned bar is explicit: “keysAtCommit and sideKeys must return the exact key a daemon at that commit would compute, or not determined.” A superset of the target's static imports does not meet that bar when the extra files exist at the target.

The coverage check tests whether a changed target module imports anything outside the current list. It does not check whether the current list contains a file that the target module never imports. That extra file still enters the returned key when it exists in the target tree.

**Real-Vitest fixture:** At both A and B, `src/old.ts` exists and exports `n = 2`. The test imports `value` from `src/registry.ts` and asserts `value === 2`.

```ts
// A: src/registry.ts
export const value = 1;

// B: src/registry.ts
import { n } from "./old";
export const value = n;
```

Run a real scheduler and Vitest adapter at A, then B. A's closure lacks `src/old.ts`; B's contains it. From B, ask for A and for `{ code: A, tests: B, testPaths: [test] }`. The test bytes are identical, so these two requests describe A's content.

The final focused probe produced:

```text
A daemon key: 30e95fa5bb70bbfecf082f9533505453da4410254deb77b6da17c7c8dfdc527e
B daemon key: bc6047f880c6bcf1012329e4f313ca7853e2740e3f805d6e30748afe72234eae
keysAtCommit(A), step 1:
              7bfe065bc7a0cdda55ed9416efbb24ea767a2d1187c2418b7a68d595f94681b1
sideKeys(A code, B test), step 1:
              7bfe065bc7a0cdda55ed9416efbb24ea767a2d1187c2418b7a68d595f94681b1
A after another fresh adapter walk:
              30e95fa5bb70bbfecf082f9533505453da4410254deb77b6da17c7c8dfdc527e
A runner: fail, "expected 1 to be 2 // Object.is equality"
B runner: pass
```

This returns neither the exact key nor uncertainty. It can miss the stored failure at A. Unlike an absent file, this extra path contributes a nonempty segment. This is the reverse direction of the earlier shrinking-closure finding.

**One-worker repair:** At the commit-key boundary, prove that the static list gives the target daemon's key, or refuse the lookup with `not determined (closure)`. Checking only that target imports fit inside the list is insufficient. Cover an added import of a file already present in both commits, through both APIs. Keep the existing shrinking-closure and unchanged-list tests.

### B2. Proven: a manifest import retarget returns B's pass for failing A

**Location:** `src/core/commit/at-keys-coverage.ts:84` parses only changed closure modules; line 160 accepts an unchanged list. No target-side manifest resolution check precedes this acceptance. `src/core/commit/at-keys.ts:144` returns the resulting key.

**Contract:** D2.1 and the same exact-key-or-uncertainty bar. This is a defect of the new commit lookup even though research section 3 also documents a pre-existing daemon restart defect for manifest resolution. Fixing that daemon defect is outside this range; refusing an unproved target key is within it.

**Real-Vitest fixture:** Both commits contain these unchanged files:

```ts
// src/old.ts
export const n = 1;
// src/new.ts
export const n = 2;
// src/registry.ts
import { n } from "#chosen";
export const value = n;
// test/review.test.ts
import { it, expect } from "vitest";
import { value } from "../src/registry";
it("value", () => expect(value).toBe(2));
```

Only `package.json` changes: A has `"imports": { "#chosen": "./src/old.ts" }`; B retargets it to `./src/new.ts`. Both source files already exist. A fresh real adapter at A reports `src/old.ts` in the closure and fails. A fresh adapter at B reports `src/new.ts` and passes. Runner environment hashes agree. The closure contains neither the manifest nor a listing that distinguishes this change.

```text
A daemon key: 20ed3690c753f9206d02e4ea0446c393f061fe4fe9596ea33790044b320d3dd8
B daemon key: f4a8fc541e9b1e258618bc49559118a89df09a2ae39fdcb32f69e82955ec071f
keysAtCommit(A), step 1:
              f4a8fc541e9b1e258618bc49559118a89df09a2ae39fdcb32f69e82955ec071f
sideKeys(A code, B test), step 1:
              f4a8fc541e9b1e258618bc49559118a89df09a2ae39fdcb32f69e82955ec071f
A after another fresh adapter walk:
              20ed3690c753f9206d02e4ea0446c393f061fe4fe9596ea33790044b320d3dd8
A runner: fail, "expected 1 to be 2 // Object.is equality"
B runner: pass
```

The answer for A is exactly the key holding B's pass. This is a concrete false-pass lookup, not only a missed result.

**One-worker repair:** Include the target's resolution inputs in the closure proof, or conservatively return `not determined (closure)` when a consulted manifest's resolution can differ. Do not infer stable resolution from unchanged importer bytes or from the same bare specifier appearing on both sides. Add the fixture above for both APIs, including a failure at A and a pass at B. The separate proposed row 023-14 need not ship to make this library refuse uncertainty.

## Verification

All product checks and external probes ran at the exact candidate on a clean tracked tree. `git status --short` was empty after build and probes. Fixture repositories used the test helpers' ignored scratch folder; probe source, configuration and logs lived under `/tmp/squeal-review-023-wave3-5pNsjy`. Throwaway probes were removed before committing this file. This review is the only committed change.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `f94f09f712632db5bd9e4953ee63692e72bce86c`, the requested candidate |
| Dependency setup | Squawk reports `pnpm install --frozen-lockfile` completed in 3 s before launch. Setup was not repeated, as instructed. No install stdout was supplied. |
| `pnpm run lint` | Exit 0: `Checked 3587 files in 3s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: `tsrs --fast -p tsconfig.build.json && pnpm run build:plugin`; Claude Code, Codex, Pi and OpenCode builds completed; no tracked drift |
| `git diff --check d7b5e76f3..HEAD` | Exit 0, no output |
| Squeal affected-source command below | Exit 3 after 61.2 s: 906 selected files, 68 current passes, 838 unknown, no known failures. Baseline is lookup-only, so the unknown files were not queued. Broader affected coverage is **unverified**. |
| Squeal four named tests below | Exit 0: `Named test files at revision 0: no known failures; 4 test files, each with a current result, after 3.0 s.` Whole worktree: 1098 of 1901 test files unknown. Current content-key evidence can be inherited; this is not a fresh full-suite claim. |
| Initial external probe, command below | Exit 1: **8 passed, 2 failed**, 22.80 s. Expanded static closure failed. Recursive newly added folder differed from A's historical key; the same-metadata follow-up below settled this as expected behavior. |
| Focused follow-up, same command with narrowed probe content | Exit 0: **6 passed**, 12.47 s. Recorded direct/root added matches, recursive removed match, shadowing twin, untracked input and the initial manifest bootstrap case. |
| Shared-metadata/fresh-walk discriminator, same command | Exit 0: **2 passed**, 10.23 s. A restarted after B gets the recursive-listing key returned by the API. The manifest case exposed the pre-existing bootstrap reuse, so the final proof forced fresh adapter walks. |
| Final focused proof, same command | Exit 1: **2 failed**, 13.13 s. B1 and B2 above both return wrong keys after independently verifying A's real adapter key again. |
| `gh run view 43988875490 --json headSha,status,conclusion,jobs` | At 2026-11-17 00:42 UTC, exact candidate SHA; CI **in progress**. Node 24 lint/typecheck/version-sensitive job passed. Six Node 22/26 shards were in progress; nightly and version-bump jobs skipped. Full-suite CI remains **unverified**, not a finding. [Run](https://github.com/hearsay-tools/squeal/actions/runs/43988875490). |

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  src/core/commit/at-keys.ts src/core/commit/at-keys-coverage.ts \
  src/core/commit/at-keys-globs.ts src/core/commit/at-keys-untracked.ts \
  src/core/commit/at-environment.ts src/core/commit/at-environment-lockfile.ts \
  src/core/store/environments.ts src/core/store/transfer-rekey.ts \
  test/commit/at-keys.test.ts test/commit/at-keys-glob.test.ts \
  test/commit/at-keys-coverage.test.ts test/commit/at-environment.test.ts

"$SQUEAL" status --wait 60000 \
  test/commit/at-keys.test.ts test/commit/at-keys-glob.test.ts \
  test/commit/at-keys-coverage.test.ts test/commit/at-environment.test.ts

timeout 600 pnpm exec vitest run \
  --config /tmp/squeal-review-023-wave3-5pNsjy/vitest.config.mjs
```

The direct runs were external discriminating probes, not duplicate runs of Squeal's covered tests. No full suite or full-suite checkpoint was requested. No changed test lies outside Squeal's coverage.

**Probe method:** Import `createRepo`, `addWorktree`, `openRepoStore` and `openHarness` from the existing scheduler test helpers. Restrict fixture Vitest configuration to `test/review.test.ts`, use `RUN_MISSING`, then await `scheduler.start()` and `quiet()` at each side. Read `keyOf(test)` and `store.testFiles.get(ref).closure.paths`. Stop each scheduler and adapter before opening the next. In the final proof, call `store.testFiles.remove(ref)` between sides to require a fresh adapter walk; keep results and environment records. This avoids treating the known daemon bootstrap manifest bug as target truth. Query both APIs from B before reopening A for a second fresh walk. The second A key equals the first in both blocker fixtures. All tests and source files are committed in each fixture; neither blocker relies on an untracked input.

## Should-fix

None beyond the blockers.

## Nits

None.

## What fits

- The earlier B1 shrinking-closure case now refuses the older key. The existing test also covers the mixed side whose old test imports a removed helper.
- With unchanged literal globs and a removed direct match, the real-runner fixture now returns `not determined (closure)` because the older folder contains an unlisted file. Root-level globs and a removed recursive match also pass that exact-or-refuse check.
- Added matches in an existing direct or root folder return A's exact key. An extra ordinary file absent at A contributes no key segment, as `encodeSegment` specifies.
- A new recursive subfolder adds a listing to the merge-only shared set. The older historical key differs, but restarting A with that same set computes exactly the API's returned key, including the absent directory's listing segment. This is a metadata evolution/miss, not a proven wrong key under the same metadata. Do not dispatch it as a third blocker.
- A target-side shadowing `.js` twin beside `.ts` is refused even when the importer bytes agree. The discriminator names `src/chosen.js` as able to take the place of `src/chosen.ts`.
- An external real-runner probe with an untracked directly imported source returns `not determined (untracked input src/untracked.ts)`. Existing tests cover ignored files and listing entries as well.
- The four current test files cover D2 environment steps 1 to 4: equal files/lockfile, unique stored pnpm match, ambiguous/config-only refusal, derived lockfile-only hash, stale install/runner-change refusal, and npm/Yarn stopping after step 1. No additional environment blocker was proved. B2 uses step 1 with equal runner environment inputs; it is a closure-resolution gap.
- No bundle or version change is required for these unbundled helpers. Build leaves committed bundles unchanged.

## Inputs for the repair and next wave

Both blockers belong to the target-closure proof. Repair them in one owned slice, or sequentially if split, since both touch `at-keys-coverage.ts` and its tests. Keep fix A's folder membership as the shared owner of glob listings. The target proof must establish exact key equivalence, including resolution inputs and extra present static paths, or refuse. A matching current key only proves the current list; it proves neither target resolution nor target list equality.

For 023-06 and 023-08, the existing signatures remain usable: `keysAtCommit({ root, store, worktreeId, commit, inputs, files?, parts?, projectDir?, rehash? })` and `sideKeys({ ..., code, tests, testPaths })`. Both return maps by `testFileId`. Honor every `notDetermined` result and never substitute the current key for it. `inputs` is policy input matching; `projectDir` locates each project's lockfile; `rehash(project, installed)` is needed for environment step 3. Do not expose either API as exact lookup until these two blockers are repaired and reviewed.

The rest of 023's CLI orchestration, checkout runs, budget use and proof conditions is outside this two-commit range. This review does not reopen the earlier settled gate and checkout repairs.
