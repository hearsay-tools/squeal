# Wave 22 review

FAIL `58397b296f6e225e9a4ea849a4b174bcf6ab0633`: **3 proven blockers**, 1 should-fix and 1 plausible test-quality note.

Reviewed `9cc0d1c9d..58397b296`, candidate `cand/0.1.590`, rows 023-38 and 023-39, including the default wiring, wired integration test and version/bundle commit. HEAD matched the candidate. The review worktree was clean before writing this file.

## Verification

Read the reviewer skill, process, vision, styleguide, board rows, spec D2/D4/D6/D7, status amendments, wave brief and both row notes. Verification that would load the shared host ran on an isolated boat.dev sandbox. Its source came from the exact candidate archive. Reconstructed the original commit and index there: HEAD was `58397b296f6e225e9a4ea849a4b174bcf6ab0633`, and `git write-tree` matched `6e406696e72565f7c68f946d049122fabf43ee3d`. The candidate files stayed unchanged.

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Kept the installed dependencies in this worktree. The isolated sandbox used `pnpm install --frozen-lockfile`: exit 0, pnpm 12.15.0. Sandbox Node: 24.22.1. |
| `pnpm run lint` | Exit 0: 3,967 files checked, no fixes. One existing `noProto` warning and two literal-key infos in unrelated tests. |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Exit 0, all four plugin builds. `git status --short` stayed empty. |
| Installed `squeal checks` | Default tests, 2,102 files. Typecheck, build and excluded e2e tests are outside its coverage. |
| Initial `squeal status --wait 60000` on changed checkout, daemon, stop and ps source paths | Exit 3: 435 selected files, 90 current and passing, 345 unknown. Incomplete affected evidence. |
| Final focused `squeal status --wait 60000` on the seven test paths below | Exit 0 at revision 0: all seven files current, no known failures, after 9.5 s. The worktree still had 192 of 2,102 files not current, all unknown. No whole-worktree pass is claimed. |
| Clean targeted Vitest command below | Exit 1: 6 files passed, 1 failed; 38 tests passed, 1 failed, 6.45 s. The only failure was the unchanged EACCES case in `test/ps/checkouts.test.ts:114`. The sandbox had effective `CAP_DAC_READ_SEARCH`, so mode `000` remained readable despite its non-root UID. |
| Same ps file with capabilities dropped | `capsh --noamb --caps= -- -c 'timeout 600 pnpm exec vitest run --maxWorkers=2 test/ps/checkouts.test.ts'`: exit 0, all 5 tests passed, 535 ms. Effective capabilities were zero. This resolves the environmental failure above. |
| Exact-candidate CI | [CI 44925509519](https://github.com/hearsay-tools/squeal/actions/runs/44925509519) remained in progress at the last read. The Node 24 lint/typecheck/version-sensitive job passed; full-suite evidence is still unverified. [Private material 44925509598](https://github.com/hearsay-tools/squeal/actions/runs/44925509598) passed. |
| Performance evidence | No base/candidate comparison supplied. Not a finding or gate. The coordinator confirms that commit-daemon start/memory measurement belongs to 023-40, with the separate process 6c benchmark on boat.dev. |

The clean targeted command was:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/checkout/commit-worktree.test.ts test/cli/stop-at.test.ts \
  test/daemon/commit-mode.test.ts test/daemon/commit-timers.test.ts \
  test/daemon/commit-daemon.test.ts test/daemon/commit-daemon-wired.test.ts \
  test/ps/checkouts.test.ts
```

The focused Squeal wait named those same seven files. No full suite ran.

Throwaway probes imported unchanged candidate code in the sandbox. They are supplemental evidence on a tree with an untracked probe, not clean candidate-suite results. The ordinary-tree and fallback-ceiling witnesses passed their assertions of the defective behavior. The first cap attempt used the wrong relative signal-file location and timed out; it is not evidence against the candidate. After correcting that probe, the cap witness passed in 2.37 s. All probes and signal files were removed. Final sandbox `git status --short` was empty.

## Blockers

### B1: a normal user repository can be claimed and its parent deleted — proven

**Locations:** `src/core/checkout/commit-worktree.ts:257`, `:269`, `:295`, `:309`; automatic detection in `src/core/daemon/commit-mode.ts:86` and shutdown wiring in `src/core/daemon/daemon.ts:1481`.

The reader accepts any root whose basename is `tree` when its parent has a valid v1 `marker.json` with any string fingerprint. It checks neither Squeal's checkout layout nor Git identity. Claim uses the same weak test. Removal then deletes the whole parent folder through `removeTree`, including siblings, even when `git worktree remove` refuses the root.

**Witness:** create a normal main Git repository at `<workspace>/tree`, a sibling `user-sibling.txt`, and an adjacent marker with the required fields and fingerprint. This models a copied or stale marker beside a user checkout; no Squeal commit worktree was created. `readCommitWorktree` returns a marker. Call the same claim and removal functions the default daemon uses. Output:

```text
NORMAL_TREE {"treeExists":false,"siblingExists":false}
```

The default daemon takes this path on an ordinary start and exit. A repository merely named `tree`, without such a marker, is safe. The current normal-root test uses a directory named `repo` and cannot detect this case. `stop --at` itself enumerates the checkout locations, so it does not discover arbitrary outside roots; the automatic daemon path is the destructive entry point.

**Repair:** give read, claim and removal one structural identity check. Require the expected commit-folder identity and a real checkout of the marker's repository before enabling destructive ownership. Reject an adjacent marker on an ordinary main or user worktree. Recheck the identity under the removal lock. Add a regression with an adjacent marker and a sibling file, and keep the real wired commit-worktree test passing.

### B2: the 3-hour cap can wait forever for a running tier — proven

**Locations:** `src/core/daemon/commit-mode.ts:160`, `src/core/daemon/lifecycle.ts:322`, timer shutdown callback at `src/core/daemon/daemon.ts:550`; wait at `src/core/daemon/daemon.ts:1444`.

D7.2 requires an exit "at most 3 hours after start". The cap calls ordinary shutdown without setting `#stopRequested` or calling `#cancelTiers`. It reaches `loop.close({})`. Scheduler close waits for the pump and every in-flight run (`src/core/scheduler/scheduler.ts:1078`, `:1094`, `:1197`). The policy permits `runner.timeoutMs: null`. A never-ending tier can therefore retain the daemon, lock, worktree and ceiling place indefinitely. Even the default 10-minute run timeout allows a tier started just before the cap to extend the lifetime.

**Real-daemon witness:** start in explicit commit mode with a lookup-only fixture and `runner.timeoutMs: null`. Request one test that signals its start and waits for a release file. After the test starts, advance the injected clock by three hours and wait for the socket to report `stopping`. Output:

```text
CAP {"phase":"stopping","exited":false,"removed":false}
```

Release the test. Only then does `daemon.exited` resolve with `lifetime-cap` and removal run. Thus the timer detects the cap, but does not enforce it. The candidate timer tests replace shutdown with a recorder; they cannot catch this seam.

**Repair:** make `lifetime-cap` cancel in-flight tiers and use the existing bounded marked-child cleanup before waiting for the scheduler to close. Keep queued files from starting. Add an actual-daemon regression with a blocked running tier and a short injected cap, asserting cancellation, exit and worktree removal without releasing the test first.

### B3: Git-folder fallback worktrees bypass the shared ceiling — proven

**Location:** `src/core/checkout/commit-worktree.ts:154`, `:164`.

D7.4 limits the number of commit daemons from machine memory. Creation holds a shared places lock, but its count covers the cache and only the current repository's Git-folder fallback. It cannot see another repository's fallback. This contradicts the machine-wide count claimed by 023-38's notes and defeats the ceiling on D4.2's supported fallback path.

**Witness:** two fixture repositories share one cache root and `limit: 1`. Create each worktree in its own `gitCheckoutsDir(commonDir)`, the fallback location, with `placeWaitMs: 0`. Keep the creator alive. Both calls succeed:

```text
FALLBACK_CEILING {"limit":1,"live":2}
```

With package stores on a filesystem different from the cache, each repository can repeat this and start its own set of daemons despite the shared memory limit. No race is needed.

**Repair:** make the shared places mechanism account for fallback worktrees from every repository, for example with validated registrations under its shared root. Keep count-and-create under the same shared lock and preserve immediate reuse. Add a two-repository fallback test: the second new commit must wait or time out until the first place is freed.

## Should-fix

### S1: default daemon removal discards cleanup reports and failures — proven

**Location:** `src/core/daemon/commit-mode.ts:58`; call at `src/core/daemon/daemon.ts:1481`.

The default seam calls `removeCommitWorktree(root)` without `note`. D6 requires the report to name processes ended by the working-folder scan. `removeTree` emits that information only through `note`. Removal errors are also caught and sent only through `note`. An idle or cap exit can kill leftover processes without naming them, or leave the tree after an error while its exit text says the worktree is removed.

Pass a reporting callback through the seam and retain the report after the main store closes. Use daemon logging or a suitable durable exit record. Test the default wired path with a cwd-bound leftover and a removal failure; assert their names or errors are observable. The explicit CLI and sweep paths already pass a callback.

## Nits

### N1: fixed sleeps make queue and timer assertions load-sensitive — plausible

**Locations:** `test/checkout/commit-worktree.test.ts:132`, `test/daemon/commit-timers.test.ts:90` and subsequent `delay(60)` calls.

The place-wait test assumes creation reached its note within 300 ms. The timer tests assume a timer ran during fixed 40/60 ms sleeps before moving the clock again. A delayed worker can reach the next assertion or clock change before that callback. No such failure occurred in the focused verification. Wait for an observed note or timer-check acknowledgement instead of elapsed wall time. Keep the injected clock for the lifetime boundary assertions.

## What fits

- Reuse happens under the repository checkout lock, before ceiling admission. The install lock and `installed` marker avoid a second frozen install. Commit and environment changes produce separate trees. The default estimate is 1 GiB per daemon, minimum one, with a 10-minute place wait.
- The daemon reads the marker after acquiring its daemon lock and claims after registration. Shutdown invokes removal from the live owning process, after runners and socket close and before lock release. `superseded` leaves the tree for its successor. The wired test proves default detection, claim and removal together.
- The sweep uses `daemon ?? owner`; it keeps a live daemon even after the creator dies, and removes a dead daemon's tree. Before claim, creator ownership protects the setup window. Removal rechecks ownership under the checkout lock and keeps another live owner's tree.
- Commit policy forces lookup-only. Lint providers are omitted, the code pass is inert and the watcher reports no edits. Coverage configuration stays intact, preserving the environment options that D2's keyer uses. The ordinary daemon path keeps its original policy and services.
- Pool refusal leaves files queued. Each lifetime check treats that queue as activity. It can suppress idle exit for the whole period before the cap. This is acceptable under the brief's explicit queue-as-activity rule; it avoids removing work merely because the pool is busy. B2 is the separate failure to enforce the upper bound.
- `stop --at` filters checkout locations by repository, commit and fingerprint. Plain stop retains its existing branch and does not enumerate commit trees. Ps fields and labels are additive; ordinary checkout rendering is preserved.
- D6 cleanup still uses kernel working folders, including deleted folders, and rechecks UID, process start and cwd before signals. It spares the caller and ancestors. This wave adds no command-line-path kill rule.
- Candidate tests exercise reuse, changed identities, failed install, waiting, takeover, sweep, stop isolation, lookup-only behavior, disabled lint/complexity/watchers and timer decisions. The missing regressions are identified in B1-B3 and N1.

## Inputs for the next wave

Resolve B1-B3 before landing this candidate. Keep each repair within the owning checkout or daemon files and retain the default wired test. Feed cleanup reports through the daemon seam as S1 describes.

For 023-40: call `ensureCommitWorktree` before starting a daemon in its returned `tree`; hold the creator alive until the daemon claims it. Pass the allow-listed environment inputs and configured ceiling. Existing trees bypass admission waiting; new ones get the 10-minute place wait and its note. Send narrow requests only after lookup-only startup. Preserve coverage policy and shared-pool admission. A normal exit removes the tree, while step-down transfers it. Do not rely on the current cap as a bound until B2 is fixed. Start/memory measurement remains in 023-40. Exact-candidate full-suite CI was still pending when this review was filed.
