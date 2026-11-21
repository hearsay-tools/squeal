# Wave 22 re-review

PASS `96506bb52c85cadbe1bcd2299bf725530958f3b9`: **0 remaining blockers**. B1, B2, B3, S1 and N1 from `reviews/wave-22.md` are closed. Two new nonblocking notes follow under the bounded re-review rule.

Reviewed `58397b296..96506bb52`, including the checkout and daemon repairs, row 023-45's test correction and regenerated bundles. The resumed worktree still held the prior review commit. Preserved that branch and switched to the exact candidate on a new review branch before verification. HEAD then matched, and the tree was clean.

## Verification

Read the prior findings first, both updated row notes, `tasks/023-45-notes.md` and the repair delta. Retained the original D2/D4.2/D6/D7 contracts. Heavy verification ran on an isolated boat.dev sandbox. Reconstructed the candidate's original commit and index from its archive: HEAD was `96506bb52c85cadbe1bcd2299bf725530958f3b9`, and the tree matched `c23afe272ba7a1a0b73979891db2aaed955c0299`. Node was 24.22.1.

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Kept this worktree's installed dependencies. Sandbox `pnpm install --frozen-lockfile`: exit 0, pnpm 12.15.0. |
| `pnpm run lint` | Exit 0: 3,968 files checked, no fixes. One existing `noProto` warning and two literal-key infos in unrelated tests. |
| `pnpm run typecheck` | Exit 0, no diagnostics. |
| `pnpm run build` | Exit 0, all plugin builds. No tracked or untracked drift. |
| Installed `squeal checks` | Default tests, 2,105 files. The e2e directory is excluded. |
| Installed `squeal status --wait 60000` on six repaired core test files and three e2e files | At revision 3, the six core files and their selected version-sensitive test were current with no known failures after 15.7 s. Exit 3 correctly said Squeal does not run the three e2e files. The worktree still had 238 of 2,105 files not current: 4 running, 228 queued, 6 unknown. |
| Clean targeted command below | Exit 0: **13 files, 61 tests passed**, 41.39 s. Included all three excluded e2e files. Dropped the sandbox's read-search capability before the run, so the ps permissions test exercised EACCES. |
| Exact-candidate CI | [CI 44928446972](https://github.com/hearsay-tools/squeal/actions/runs/44928446972) remained in progress at the last read; full-suite evidence is unverified. [Private material 44928446832](https://github.com/hearsay-tools/squeal/actions/runs/44928446832) passed. |
| Performance evidence | No new comparison supplied. As agreed in the first review, start/memory measurement belongs to 023-40; the separate boat.dev benchmark is not a finding or gate here. |

The clean targeted command, inside `capsh --noamb --caps= -- -c`, was:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/checkout/commit-identity.test.ts test/checkout/commit-worktree.test.ts \
  test/cli/stop-at.test.ts test/daemon/commit-cap.test.ts \
  test/daemon/commit-removal.test.ts test/daemon/commit-timers.test.ts \
  test/daemon/commit-daemon-wired.test.ts test/daemon/commit-daemon.test.ts \
  test/daemon/commit-mode.test.ts test/ps/checkouts.test.ts \
  test/e2e/slow-node-test.test.ts test/e2e/slow-vitest.test.ts test/e2e/ps.test.ts
```

The wired daemon test passed its claim/removal assertions but logged that its fake install left `vitest/config` unresolved. This proves the default identity/ownership seam, not successful runner startup in that fake-installed tree. The real cap test and shipped-plugin e2e cases cover running daemons separately.

After the clean run, isolated red controls disabled one repair at a time. These are supplemental results on deliberately modified source, not candidate-suite failures. Every control used `pnpm exec vitest run --maxWorkers=2` with the file and test selector shown below. Source was restored after each control; final `git status --short` was empty.

| Control | Selected test | Actual failure with the repair disabled |
| --- | --- | --- |
| B1: bypass the folder/location/Git identity checks | `commit-identity.test.ts`, `is not a normal repository` | Exit 1, 0.57 s: expected `readCommitWorktree` to return null; it returned the adjacent marker. |
| B3: omit registered worktrees from the count | `commit-worktree.test.ts`, `counts the git-folder worktrees` | Exit 1, 0.62 s: the second repository's creation resolved instead of rejecting at limit one. |
| B2: omit the cap's `#cancelTiers` call | `commit-cap.test.ts`, `cancels the tier` | Exit 1, 22.52 s: received `{reason:null, removed:[]}` instead of `lifetime-cap` and removal. Cleanup released the blocked test afterward. |
| S1: discard removal notes instead of forwarding them to the daemon log | `commit-removal.test.ts`, `logs the processes` | Exit 1, 3.02 s: the ended-process and removal-error messages were absent from the log. |

A throwaway public-interface probe checked real `ensureCommitWorktree` trees in both D4.2 locations and the later sweep behavior in N2. It passed its assertions of that behavior in 340 ms. The probe was removed. No full suite ran.

## Prior findings checked

| Finding | Judgment and evidence |
| --- | --- |
| B1: normal repository claimed and parent deleted | **Closed for the reported scenario.** Read, claim and removal use `commitIdentity`. It requires the folder's commit/fingerprint name, a repository checkout location, a linked Git worktree with matching back-reference, and the `squeal` lock reason. Tests reject an ordinary main repository, its own adjacent marker and a user-created linked worktree even at the expected location. The red control catches the original weak identification. Real trees from `ensureCommitWorktree` were accepted, claimed and removed in both cache and Git-folder locations. The default wired test also passes after removal of its unsupported arbitrary `dir` override. N2 is the separate follow-on cleanup note. |
| B2: cap waits forever for a running tier | **Closed.** The timer shutdown callback now cancels tiers before beginning `lifetime-cap` shutdown. It uses the existing scheduler abort and bounded marked-child cleanup. The real-daemon regression runs a blocked Vitest test with `runner.timeoutMs:null`, never supplies its release file, and requires the daemon to exit, invoke removal and end the test process. The red control fails on the original wait. Ordinary daemons receive no commit lifecycle context and cannot trigger this cap; their stop and step-down paths retain the existing cancellation mechanism. |
| B3: fallback trees bypass the shared ceiling | **Closed.** Creation registers its folder under the shared places lock before adding the checkout. Counts validate registrations and include other repositories' fallback locations, deduplicating real folders. The two-repository test rejects the second creation at limit one, then succeeds after removal of the first. Omitting registrations fails that test. Existing-tree reuse still happens before admission, restores its registration and does not wait for a place. |
| S1: removal report discarded | **Closed.** The default wrapper passes `note` to `removeCommitWorktree`; the daemon passes its log after the store closes. The CLI's daemon log sink remains available at that point. Injected removal tests prove log forwarding and both retained/removed exit texts. The red control catches lost forwarding. N3 records the remaining unreadable-path uncertainty. |
| N1: fixed sleeps in queue/timer tests | **Closed.** The place test awaits its actual waiting note. Timer steps await a check counted in `requestProgress`; the same synchronous check reads the clock, progress and exit decision before the next clock advance. The targeted tests pass without the former 300/40/60 ms assumptions. |

## Blockers

None remain from the prior findings.

## Should-fix

None carried forward. The new observations below are notes under the bounded re-review rule.

## New notes

### N2: a later sweep deletes the sibling that removal preserved — proven, nonblocking in this re-review

**Locations:** `src/core/checkout/commit-identity.ts:110`, `:114`; `src/core/checkout/sweep.ts:80`, `:82`.

The new selective removal keeps an unknown sibling such as `user-file.txt`, but first deletes `marker.json`. The next sweep sees an unmarked folder and takes the generic recursive `removeTree` path. Thus the new promise to preserve unknown files lasts only until the next sweep. The candidate's preservation test stops immediately after removal and does not exercise this second step.

**Witness:** in each D4.2 location, create a real commit worktree, claim it and add `user-file.txt` beside `tree`. Remove the commit worktree. Assert that the sibling remains, as the new test does. Then call `sweepCheckouts` on that directory. Output:

```text
AFTER_SWEEP {"location":"cache","siblingExists":false}
AFTER_SWEEP {"location":"git-folder","siblingExists":false}
```

**Follow-up:** leave a recognizable record for intentionally retained folders, or otherwise distinguish them from incomplete creations. Make both ordinary removal and later sweeps preserve the unknown files. Extend the existing preservation test through a subsequent sweep. This does not reopen the original ordinary-repository auto-detection failure, which the new identity guard closes.

### N3: unreadable is still treated as removed in the exit text — plausible, nonblocking

**Location:** `src/core/daemon/daemon.ts:1492`.

`!existsSync(root)` is not proof that removal succeeded: `existsSync` also returns false when an ancestor cannot be searched. If a test removes search permission from the checkout's parent, identity/removal can fail to read it, while the exit text says the worktree is removed. The normal successful and retained-path cases pass. No permissions probe was run for this additional case.

**Follow-up:** distinguish ENOENT from EACCES and other lookup errors when constructing `removalText`. Report unreadable state as unknown or not confirmed removed. Add a permissions regression under a user without read-search capabilities.

## What fits

- The stricter identity check accepts both supported locations, including a cache root different from the daemon's environment. It checks the repository-hash directory name rather than requiring the current environment's cache prefix.
- The shared registrations close the cross-repository fallback gap while keeping reuse, dead-owner exclusion, install-once behavior and the existing lock order.
- Cap cancellation applies only to the commit-mode lifetime reason. No ordinary-daemon policy, watcher, lint, complexity or coverage option changed in this repair.
- Row 023-45 pins the slow e2e fixtures to `trigger: "idle"`, matching their assertion that files stay pending during a consumer's turn. No assertion or scheduler behavior was weakened. The three affected e2e files pass, and the separate continuous-trigger scheduler tests remain unchanged.
- Row 023-45 pins only the slow e2e fixtures to `slow.trigger:"idle"`, matching their assertions that slow files stay pending during a turn. It changes no assertion or product default. Both slow runner shapes and the shared ps fixture pass. Continuous-trigger scheduler tests remain in place. The row notes also record the before/after forced-delay proof; this review did not repeat that experiment.

## Inputs for the next wave

The prior review's 023-40 seam remains: ensure the tree, retain creator ownership until claim, start the default daemon there, then send narrow requests. Coverage options stay intact and permits come from the shared pool. The cap now cancels outstanding work before removal. Use only D4.2 checkout directories; arbitrary `dir` overrides are rejected. Track N2 and N3 as follow-ups. Exact-candidate full-suite CI was still pending when this report was filed.
