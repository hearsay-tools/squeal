# Wave 23 fourth review

FAIL `9786300df3a2c9368891437f446cc325d50c7e74`: **2 blockers, no should-fix findings, no additional notes**.

Range: `9c9798c6a..9786300df3a2c9368891437f446cc325d50c7e74`, candidate `cand/0.1.592`. HEAD matched. This is a narrow re-review of `wave-23-third.md`, the round 4 repairs and the ceiling fix. Requirements include D7.3 as amended on `origin/main` on 2026-11-22: both sides come from their daemons. Only this report is committed.

## Verification

Heavy checks and fault probes ran in an isolated sandbox. The archive and commit object reconstructed the exact candidate, tree `c20ff97efb82e4ff6c2a0f47f9b45efbcd9aa8a1`. Node was 24.22.1; Corepack selected pnpm 12.15.0. No full suite ran.

| Check | Actual result |
| --- | --- |
| Dependencies | Kept the prepared worktree dependencies. Sandbox `pnpm install --frozen-lockfile`: exit 0, 3.3 s. |
| `pnpm run lint` | Exit 0; 3,999 files checked, no fixes. One warning and two infos. |
| `pnpm run typecheck`; `pnpm run build` | Both exited 0. No tracked build drift. |
| `git diff --check 9c9798c6a..HEAD`; `pnpm run check:private -- 9c9798c6a` | Passed. The private denylist was empty, so that rule was skipped. |
| Installed `squeal checks`; affected `squeal status --wait 60000` | The second affected-path wait exited 3 after 60.6 s: **616 selected files pass, 119 pending**. Whole worktree: zero known failures, 127 of 2,121 files not current. Affected verification remains incomplete. |
| Targeted command below | Exit 0: **19 files, 61 tests passed**, 124.88 s. Includes the default-wait slow-configuration test and the real-daemon three-worktree test. |
| Key checks | `test/keys/check-key.test.ts` and `test/keys/closure.test.ts`: **25 tests passed**. The same invocation could not collect `test/keys/key-format.test.ts`: the reconstructed repository has no release-tag history. That isolated check is unverified, not a candidate failure. An installed Squeal path wait subsequently reported this file current with no known failures, after 20.8 s. |
| Current-keying negative control | Restoring only the old caller-side `nowSide` read, with a real 125 s `configResolved` hook, fails the deadline assertion: **125,648 ms**, expected less than 106,000 ms. |
| Stored-walk negative controls | Restoring the old unconditional shortcut fails both the real-resolution and public real-daemon tests. Removing the writer-key guard, module-walk guard, or writer proof fails its own committed test. |
| Ceiling negative control | Removing the live-count addition fails the regression: expected ceiling 4, got 2. |
| Additional fault probes | Restored product sources reproduce B1 at **130,092 ms**. Real SQLite contention plus a writer stopped after its closure transaction reproduces B2. Narrow controls described below discriminate both defects. |
| Exact-candidate CI | [CI 44970928476](https://github.com/hearsay-tools/squeal/actions/runs/44970928476) was still running. Its Node 24 lint/typecheck/version-sensitive job passed. [Private material 44970928459](https://github.com/hearsay-tools/squeal/actions/runs/44970928459) passed. Full-suite CI remains pending. |
| Performance | Read `tasks/023-40c-measure.md`: built-bundle measurements at `d0925e820`, 10.6 s quiet call, 31.5 s with both daemons starting, 1.66 GiB peak PSS while running 40 files. These are useful prior-candidate measurements. Exact-round-4 performance and a per-release benchmark comparison remain unverified; neither is a blocker. |

Affected paths:

```text
src/cli/status-at-now-ask.ts
src/core/scheduler/proven-walks.ts
src/core/checkout/commit-worktree.ts
```

Targeted command, with pnpm selected through Corepack:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/checkout/deadline.test.ts \
  test/checkout/commit-worktree.test.ts \
  test/cli/status-at-now-daemon.test.ts \
  test/cli/status-at-setup-bound.test.ts \
  test/cli/status-at-deadline.test.ts \
  test/cli/status-at-commit-daemon.test.ts \
  test/cli/status-at-commit-refused.test.ts \
  test/cli/status-at-run-gitattributes.test.ts \
  test/cli/status-at-not-selected.test.ts \
  test/cli/status-at-call.test.ts \
  test/cli/status-at-call-after.test.ts \
  test/cli/status-at-join-recorded.test.ts \
  test/cli/status-at-stopped.test.ts \
  test/daemon/at-asks.test.ts \
  test/scheduler/proven-walks.test.ts \
  test/scheduler/proven-walks-unresolved.test.ts \
  test/scheduler/proven-walks-writer.test.ts \
  test/scheduler/proven-walks-status-at.test.ts \
  test/scheduler/changed-selects.test.ts
```

The controls and supplemental probes were separate from the clean acceptance run. Product edits used for controls were restored. Tests await daemon readiness and scheduler quiet points. The configuration test uses a barrier. B1's lock probe deliberately holds a lock for 70 s to exercise serial waits; it does not sleep to guess when a daemon is ready.

## Blockers

### B1 remains open: serial checkout locks can exceed the default tool limit (proven)

**Locations:** `src/core/checkout/commit-worktree.ts:194`, `:205`, `:207`; `src/core/checkout/checkout.ts:75`; `src/cli/status-at-daemons.ts:257`.

D7.3 requires every caller-owned step, including locks, to count against one wait. The 100 s default must return within the 120 s tool limit.

The new daemon read fixes the slow current-side configuration case. The added checkout deadline cuts `pnpm store path`, `git worktree prune` and `git worktree add`. But `placeFor` takes two locks in sequence. The outer repository checkout lock receives `options.lockWaitMs`. The inner machine-wide commit-places lock receives no allowance, so `withFileLock` gives it another **60 s**. The time already spent on the outer lock is not deducted. A place wait cannot cut an awaited lock after the fact.

**Reproduction:** a two-commit fixture changes `src/a.ts`. Acquire its real checkout lock and the real global lock at `placesLockPath(cacheRoot)`. Release the checkout lock 70 s after starting the call; keep the global lock held until the call returns. Call:

```sh
squeal status --at A test/a.test.ts --run --json
```

No explicit wait is given. Use production `realDaemons().commit`, `ensureCommitWorktree` and lock acquisition. Stand-ins answer only the working-tree side; no install or commit daemon is reached. On restored candidate product sources:

```text
elapsed:                 130092 ms
run.waitMs:              100000
run.usedMs:              130083
exit:                    3
run.commit.tree:         null
run.commit.problem:      the call's wait ended while its commit worktree was made:
                         the commit worktrees' lock stayed held for 60000 ms (starting)
```

The two locks have real owners before the call starts. This models another operation in this repository followed by an operation in another repository under the shared creation lock. The default call still exceeds the tool limit. An earlier exploratory run gave 130,066 ms; the figure above is from restored product sources.

**Discriminating control:** pass the remaining absolute deadline to the inner lock. The same default-wait probe passes at **98,041 ms**, with the inner lock limited to 27,983 ms and no worktree made. The source change was restored.

**Fix boundary:** calculate the remaining absolute deadline at each lock acquisition, including the inner global lock and every retry of the outer lock. Keep the existing checkout deadline and daemon ownership. Do not pass an allowance computed before earlier steps as a new full allowance after them.

**Required regression:** hold both locks as above. The call must report by its wait plus the small reporting allowance, with no worktree made. Also cover a short explicit wait against the global lock alone. Keep the existing config, install, install-lock, late-start and unclaimed-owner tests.

### B2 remains open: option B can prove a newer list with a stale writer key (proven)

**Locations:** `src/core/scheduler/proven-walks.ts:130`, `:134`, `:136`, `:170`. Relevant existing seams: `src/core/scheduler/bootstrap.ts:299`, `:302`; `src/core/scheduler/revision.ts:387`.

The ordinary three-worktree repair works, including D4.9 and the real-daemon call. With a committed writer key, option B's argument is sound for this defect: equal keys prove the listed present paths; an absent listed path could not have contributed a segment at the writer. The module guard also rejects the original `foo.js` commit window.

The argument does not hold when the writer's key transaction failed but its later closure transaction succeeded. The notes acknowledge the non-module commit window. This review reproduced it with a manifest, real Vitest resolution, real schedulers, real store transactions and a real `SQLITE_BUSY`. It is a blocker, not only a possible race.

**Fixture:** all worktrees share these tracked files at A:

```text
package.json:
  {"name":"fixture","private":true,"type":"module",
   "imports":{"#foo":"./src/shared.js","#keep":"./src/shared.js"}}
src/shared.js:
  export const shared = 1;
src/deep/x.js:
  import "#foo";
  export const x = 1;
test/foo.test.ts:
  import { it } from "vitest";
  import "#keep";
  import "../src/deep/x.js";
  it("x", () => {});
```

There is no `src/package.json` or `src/deep/package.json` at A. Start A lookup-only. Its closure holds both absent manifests, the present modules, the root manifest and the test. Its key is K. Register and retain A so its walk at K survives pruning.

1. Start a second worktree B at A, lookup-only, then close its scheduler. Its row also holds K.
2. In B add and commit `src/deep/package.json` with `{"type":"module","imports":{"#foo":"./x.js"}}`. Restart B. The import now resolves within that package. The new list omits `src/package.json`, because nearest-manifest discovery stops at the deeper manifest. Every module in the new list already exists at A.
3. During B's `commitFirst`, another SQLite connection holds `BEGIN IMMEDIATE`. With the scheduler connection's busy timeout set to zero, the real transaction fails with error code **5**. Release that other connection. `commitFirst` catches the busy error and continues; B's stored key remains K.
4. B's subsequent `storeClosures` transaction commits its new list and import graph. Stop the writer immediately after that transaction, before its final ledger commit. The probe injects a stop exception at this transaction boundary, then closes the scheduler. It does not rewrite a key row or forge a closure.
5. Start a third worktree C at A. B's new list keys at K here: the deep manifest is absent and contributes no segment. B's writer row still holds K. The only newly present input at B was a manifest, so the module-path guard sees no absent module and accepts the list.

Observed:

```text
A key:                    6555d3702371...
B stored key after busy:  6555d3702371...
C key:                    6555d3702371...
C walked files:           []
C closure:                lacks src/package.json
changedSelects(["src/package.json"]): []
closureReads(p => p === "src/package.json"): empty
```

The probe uses the real busy transaction to reach the stale key, and an explicit stop at the persistent window to make it repeatable. Without the induced contention and stop, B commits its new key and C rewalks correctly. An initial experiment that simply rewrote B's key was not used as the reachability proof.

**Discriminating control:** remove only the writer-proof alternative, retaining clause 1 for lists with no unresolved paths. The same contention-and-stop fixture passes: C walks `test/foo.test.ts`, retains `src/package.json`, and both selection and closure refusal queries find it. K remains unchanged.

This proves an incomplete closure and missed selection/refusal input. It does not demonstrate a wrong known comparison. It nevertheless breaks row 023-46's safe-closure requirement and the D4.5/D4.9 consumers, as the prior blocker did. Rarity does not make a proven incorrect closure acceptable. The separate two-writer graph-pruning residual remains plausible; no independent reproduction of it is claimed.

**Fix boundary:** tie a stored list to the key of that exact list write, atomically. A worktree's independently committed current key is insufficient evidence. Alternatively, rewalk lists with unresolved inputs until that provenance exists. Keep the unchanged-file shortcut where its proof holds. The guard must cover manifests and other resolution inputs, not only module edges.

**Required regression:** the nested-manifest fixture above, a real failed first key commit, and a writer stopped after its closure transaction. Assert that C retains `src/package.json`, `changedSelects` selects the file, and `closureReads` names the manifest. Keep the existing three-worktree and public real-daemon cases.

## Closed parts and what fits

| Boundary | Evidence and judgment |
| --- | --- |
| Current-side initial and final keying | `statusAtCommand` enters the daemon path before `nowSide`. `worktreeNow` asks `sync`; `nowAgain` reads stored daemon rows. Neither has a keyer fallback. The slow-hook regression passes at the default bound, then both sides pass in the same follow-up call. This part of B1 is closed. |
| Commit setup and prior B3 | Held install and held install-lock tests pass. The daemon owns setup and the worktree from spawn. The tracked runtime read, fresh store and real commit-daemon regression passes in the same call; the new working-tree regression covers the completed observed-input key too. |
| Earlier deadline protections | Ceiling wait, early death, unclaimed ownership, shared group bound and late worktree spawn tests pass. The package-store query and git-add hook are cut in the new checkout tests. B1 above is the remaining serial-lock boundary. |
| Original absent-candidate case | Both real-resolution and public real-daemon tests pass. They fail with the old shortcut. The public case first refuses an untracked `foo.ts`, then selects and runs the file when the change commits it. B2 above is the remaining writer-provenance boundary. |
| Stop marks, command holds and joins | Existing stop/hold and recorded-request join tests pass. The daemon read starts none for `--wait` alone. Prior policy and Q7 protections remain. |
| Whole checkout and incomplete closures | Git-rule changes, post-install tracked changes, generated-input refusal and node:test closure marks pass. |
| N1 progress text | Closed. The daemon path prints that it asks both daemons. The temporary-keying line is confined to plain lookup. |
| Memory ceiling | The default adds live daemons to room still free at 2 GiB each. The configured limit still overrides it, low free memory admits no extra daemon, and existing reuse/place-wait tests pass. Its regression fails without the addition. |

## Inputs for the next step

1. Finish the single deadline at both creation locks, calculating time left when each is acquired.
2. Replace the independent writer-key inference with provenance for the exact closure write, or rewalk unresolved lists. Cover the contention-and-stop state explicitly.
3. Preserve the passing daemon ownership, same-call observed-key, stop/hold, recorded-join, whole-checkout and ceiling tests. Exact-release full-suite CI must pass before release. Performance evidence stays separate from the two correctness blockers.
