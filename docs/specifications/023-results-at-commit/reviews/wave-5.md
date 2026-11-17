# Wave 5: keys at a commit by a checkout walk

FAIL `337b2fa565cb900dae98e8e6fa5acb725396a204`

Candidate `cand/023-16`, range `4be3e91ae9923800710f4702a3e32c3fe27e8237..337b2fa56`, five commits, row 023-16. **3 proven blockers, 0 should-fix items, 0 nits.** The checkout keyer fixes the earlier regression cases. The fast path still returns current passes for different target keys. The default install can outlive its owner and the next sweep. No product file was changed.

## Blockers

### B1. Proven: a sibling module can shadow a directory import without failing the fast path

**Location:** `src/core/commit/at-keys-fast.ts:93`, same-name check at line 105; acceptance at `src/core/commit/at-keys.ts:122`.

**Contract:** D2 as amended requires the exact fresh-walk key or `not determined`. The research recommendation permits reuse only when unchanged inputs imply unchanged resolution. A wrong key is a wrong pass.

Both commits contain:

```ts
// src/a/index.ts
export const n = 2;
// test/a.test.ts
import { it, expect } from "vitest";
import { n } from "../src/a";
it("n", () => expect(n).toBe(2));
```

At A, `src/a.ts` also exists and exports `n = 1`. B deletes only that file. A resolves the import to the sibling file; B resolves it to the directory index. The current stability paths are:

```text
src/a/index.ts
test/__snapshots__/a.test.ts.snap
test/a.test.ts
vitest.config.mjs
```

All listed blobs agree at A and B. The extra check indexes the current module as folder `src/a`, stem `index`. The removed module has folder `src`, stem `a`. They do not match. No absent candidate supplied by the real adapter catches it either.

**Final external probe, real Vitest adapter:**

```text
fresh A key:          0a3f1c6dd4ac15c7fa80b8eac48d856778085a192f09d370fd2605c4b4bb6596
fresh B key:          51a5f927030891b255082b76342dd76a2e314b37a8e70e60359b9ac91ffd592c
keysAtCommit(A):      51a5f927030891b255082b76342dd76a2e314b37a8e70e60359b9ac91ffd592c
via:                 unchanged
changed:             []
stored outcomes:     [pass]
sideKeys(A, B test):  exact fresh A key, via walk
```

The probe seeded a failure under A's independently walked key and a pass under B's. The lookup for A returned the pass. These seeded records test lookup selection; they are not claimed as separately executed test results. The source values also show why the two test outcomes differ. The shared database hash remained unchanged.

**One-worker fix:** Repair the fast-path resolution proof and its real-adapter tests. Cover file-versus-directory candidates in both directions, including index targets. When the input list cannot prove stable resolution, use the checkout walk or return uncertainty. Keep the extension-twin case and the ordinary unchanged-file fast path. Do not require callers to supply absent candidates that the real adapter does not record.

### B2. Proven: a config input outside runner files changes the target environment but returns the current pass

**Location:** `src/core/commit/at-keys.ts:103` through line 122; `src/core/commit/at-keys-fast.ts:88` and final acceptance at line 112.

**Contract:** D2 requires an exact key. Its environment rule refuses uncertain config-only matches. `research/keys-by-walk.md` section 4, Limit, explicitly says an environment input absent from the listed files breaks the fast-path premise, and calls for the existing refusal when stored descriptors expose that ambiguity. The new path checks neither target resolved configuration nor that stored-descriptor refusal.

Use the unchanged test above with `../src/a`, and:

```js
// vitest.config.mjs, identical at A and B
import { readFileSync } from "node:fs";
export default {
  define: {
    CHOICE: readFileSync(new URL("./choice.txt", import.meta.url), "utf8").trim(),
  },
  test: { include: ["test/*.test.ts"] },
};
// src/a.ts, identical at A and B
export const n = CHOICE;
```

Only `choice.txt` changes, from `1` at A to `2` at B. The resolved `define` changes. Fresh keying at each commit sees it, but `choice.txt` is absent from the current stability paths. Those paths contain only `src/a.ts`, the test, its absent snapshot, and `vitest.config.mjs`. All ten checks accept.

```text
fresh A key:          b498fa4c605b451b71ef32be534e4918d10c7a9c1e85b0e6eed8493e136f60e5
fresh B key:          9996199fe630861733cb5758b928aaafc4b8ea046de044f5e94cb5b9ea340a35
keysAtCommit(A):      9996199fe630861733cb5758b928aaafc4b8ea046de044f5e94cb5b9ea340a35
via:                 unchanged
changed:             []
stored outcomes:     [pass]
sideKeys(A, B test):  exact fresh A key, via walk
```

As in B1, the probe seeded a failure at A's exact key and a pass at B's. The API returned B's pass for A. It did not alter the database. This probe needs no daemon bootstrap behavior or invented closure. Its reference and API both use the real adapter and the gate keyer. The different keys were stable across the initial and final probes.

**One-worker fix:** Make target environment equality part of fast-path eligibility. A list of runner-file blobs alone does not prove equal resolved configuration. Apply the documented ambiguity refusal, and use a checkout walk or uncertainty when target environment equality cannot be proved. Include this real config-read case with a stored failure and pass. Testing only a changed `squeal.config.json` does not cover it. Keep equality of the file key and its environment as one acceptance rule.

### B3. Proven: the default install survives owner SIGKILL and the next sweep

**Location:** new default-install call at `src/core/commit/at-keys-walk.ts:155`, cleanup at line 161, and sweep at line 141. The existing install helper creates a detached group, but this new caller supplies no owner-death supervision or group registration for cleanup.

**Contract:** Goal 5: “A killed run leaves no process running and no checkout behind after the next start.” D4.8 stops the run's process group before removal. D6 covers parent death. The new flow must satisfy this when it calls the existing install helper, as well as when it keys.

**External probe:** Make a temporary npm fixture with a valid dependency-free `package-lock.json`. Its `preinstall` is `node hold.mjs`. The script writes its pid and cwd to a file outside the checkout and then waits on an interval. Start a child that calls `keysAtCommit` with the real adapters and the **default** install. Change a source blob so the checkout is required. After `npm ci` reaches the script, SIGKILL the lookup owner and wait for its exit. Call `keysAtCommit` again with the fixture's link install, which performs the normal dead-owner sweep.

```text
installAliveAfterOwnerKill: true
installAliveAfterSweep:     true
checkoutExistsAfterSweep:  false
remainingCheckouts:        0
```

The surviving script was a live interval process, not a zombie. The probe then killed its owned install process group in `finally`. No probe install or lookup child remained afterwards. The candidate's kill test stops inside an injected unresolved promise, so it creates no install child and cannot test this boundary.

This finding concerns the new lookup flow's use of the helper. It does not ask this wave to repair unrelated older callers. Removing the checkout alone is insufficient: the orphan can keep using resources or writing outside the removed tree.

**One-worker fix:** Give the checkout lookup one owner for its install/keying process lifetime. Supervise the install group across owner death, record enough identity for a safe sweep, and stop it before removal. A `finally` in the killed owner cannot provide SIGKILL cleanup. Add a real default-install child test; assert both process death and checkout removal, including the next-start sweep. This may require a bounded extension to the checkout/install helper interface; dispatch it with that ownership stated explicitly.

## Verification

All product checks and probes used the exact candidate on a clean tracked tree. Probe source and fixtures lived outside this worktree under the task's temporary folder. They were removed before this review was committed. Only this findings file is committed. No bundle or version was changed.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `337b2fa565cb900dae98e8e6fa5acb725396a204`, as requested |
| `git status --short`, before and after build and probes | Empty |
| Dependency setup | Squawk reports `pnpm install --frozen-lockfile` completed in 1 s before launch. Not repeated, as explicitly instructed. No install stdout was supplied. |
| `pnpm run lint` | Exit 0: `Checked 3610 files in 2s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: `tsrs --fast -p tsconfig.build.json && pnpm run build:plugin`; Claude Code, Codex, Pi and OpenCode builds completed without tracked drift |
| `git diff --check 4be3e91ae..HEAD` | Exit 0, no output |
| `pnpm run check:private`, before commit | Exit 0: `private: 1532 added lines in 12 files over 4be3e91ae9923800710f4702a3e32c3fe27e8237, ok`. Warning: the private denylist is empty locally, so that rule was skipped. The script scans committed HEAD; a separate search of this staged review found no absolute home paths. |
| Squeal affected-source command below | Exit 3 after 61.2 s: 360 selected files, **288 current passes, 5 queued, 67 unknown**, no known failures. Broader affected coverage is **unverified**. |
| Squeal six named tests below | Exit 0 after 2.0 s: `Named test files at revision 0: no known failures; 6 test files, each with a current result.` Worktree: 323 of 1911 not current, 9 queued and 314 unknown. Current keys can inherit results; this is not a fresh full-suite claim. |
| Initial external probe, `timeout 600 pnpm exec vitest run --config <probe>/vitest.config.mjs` | Exit 1: 2 failed, 5.20 s. One proved B1; the workspace probe had a duplicate fixture commit error, corrected before the next run. That fixture error is not a candidate finding. |
| Focused follow-up, same command | Exit 1: **2 failed, 1 passed**, 9.96 s. B1 and B2 failed exact-or-refuse assertions; workspace exports case passed. |
| Final focused proof, same command | Exit 1: **3 failed, 4 passed**, 17.11 s. B1 and B2 now include stored-result lookup and read-only database checks; B3 uses the default install. Workspace exports, nested manifest imports, tsconfig paths, and sibling extension cases passed their reference-key checks. Both failing key cases returned exact A keys through `sideKeys`. |
| `gh run view 44048153326 --json headSha,status,conclusion,jobs` | At 2026-11-17 08:46 UTC: exact candidate; CI **in progress**. Node 24 lint/typecheck/version-sensitive/build job passed. Six Node 22/26 shards were in progress; nightly and version-bump jobs skipped. Full-suite result remains **unverified**, not a finding. [CI run](https://github.com/hearsay-tools/squeal/actions/runs/44048153326) |
| `gh run view 44048153407 --json name,headSha,status,conclusion` | Exact candidate; `Private material`, completed, **success** |

The probe folder was `~/projects/squeal/.ai/squawk/t/51f5d4df/sq-review-wave5-xxpt4t1n`. Commands used its actual expanded path. Each probe repository used the candidate's existing fixture helpers and real `daemonAdapters`. Reference keys came from `freshKey`: an independent plain detached worktree at the requested commit, the gate's fresh keyer, and the fixture's Vitest link. No fast-path code produced the reference. The final key probes seeded the main store only before taking the database hash, then verified unchanged bytes after the lookup. The npm lifecycle fixture used the default frozen install; the key-reference fixtures used the documented link install, not a real pnpm dependency installation.

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  src/core/commit/at-keys.ts src/core/commit/at-keys-fast.ts \
  src/core/commit/at-keys-diff.ts src/core/commit/at-keys-untracked.ts \
  src/core/commit/at-keys-walk.ts src/core/code/gate/stored.ts \
  test/commit/at-keys.test.ts test/commit/at-keys-fast.test.ts \
  test/commit/at-keys-killed.test.ts test/keys/key-format.test.ts \
  test/version-sensitive.test.ts test/runners/boundaries.test.ts

"$SQUEAL" status --wait 60000 \
  test/commit/at-keys.test.ts test/commit/at-keys-fast.test.ts \
  test/commit/at-keys-killed.test.ts test/keys/key-format.test.ts \
  test/version-sensitive.test.ts test/runners/boundaries.test.ts
```

No full suite or full-suite checkpoint was requested. No changed test lies outside Squeal's coverage. The direct runs discriminate concrete boundary failures; they do not repeat the covered candidate tests.

## Should-fix

None beyond the blockers.

## Nits

None.

## What fits

- The four earlier blocking cases now have real-adapter regression tests through both APIs: shrinking closure, removed glob match, larger current closure, and root manifest `imports` retarget. Their current Squeal result passes. Changed files go to a fresh keyer in a checkout instead of projecting the current closure over older blobs.
- The ordinary unchanged-file case avoids a checkout. Dirty-tree comparison reads current hashes, not just HEAD. A test absent from the target is reported absent without a checkout.
- The ten conditions have explicit unit cases: blobs, absent candidates, listings, patterns and declared inputs, lockfile mapping, sibling extensions, manifest resolution fields, tsconfig, untracked inputs, and policy changes. These unit cases validate the supplied data; B1 and B2 show where that data or the resolution proof is insufficient.
- External reference-key checks passed for a workspace package's `exports` change, a nested manifest's `imports` change, tsconfig paths, and an extension twin. The workspace fixture tracks its package link at both commits, so the target reference can resolve it.
- `sideKeys` walks in a checkout and returned the exact target keys in all six final key fixtures, including B1 and B2. It does not use the unsafe fast path.
- Shared-store access is read-only. The existing test and the final external probes verified the database hash. The exported gate helpers change visibility only. Scratch keying starts no daemon or result run.
- The existing killed-promise case proves dead checkout removal on the next checkout run. B3 concerns the real child process absent from that fixture.

## Inputs for the repair and next wave

Repair B1 and B2 in the fast-path acceptance boundary, with one owner of the equality rule. The checkout walk already gives exact keys in these cases. Reuse it when the proof cannot establish both resolution and environment equality. Do not solve either blocker by hashing more of the current closure over older blobs. That is the mechanism the earlier reviews rejected.

Give B3 a separate lifecycle row with explicit ownership of the helper interfaces it needs. Its done-when must kill the lookup during an actual default install, then prove the install tree is dead and the next sweep removes the checkout. The injected-promise kill case remains useful but is insufficient alone.

The current consumer interface is `keysAtCommit({ root, commit, files?, adapters, squealVersion, env, cacheRoot?, install?, installTimeoutMs?, note? })`. It returns `files`, `current`, `changed`, `checkout`, and `store`. Each `KeyAt` holds `{ key, via, stored }` or `{ notDetermined: { reason, detail } }`. `sideKeys` takes the same keying/checkout options plus `code`, `tests` (commit or null for current files), and named `files`. Adapters must be opened for the supplied tree and policy, using the supplied temporary folder. No core module imports a runner.

For 023-06 and 023-08, honor every uncertainty and missing result. Do not expose fast-path results as exact until B1 and B2 pass review. The default install budget is 300 s; 023-07 still owns D4's single 600 s total budget. Helper/fixture copy-in and missing-source refusal remain 023-08's explicit scope; this row copies named test files only. D4's per-run TMPDIR and the documented small links-folder residue still need orchestration work. This review does not claim those future CLI/proof features are complete, and does not reopen the settled wave-1 gate-environment or copy-destination repairs.
