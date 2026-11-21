# Wave 23 re-review

FAIL `ac207194e4dfbc49166529d2eb06d6046f41dd69`: **1 blocker, no new should-fix findings or notes**.

Range: `66fd7b470..ac207194e4dfbc49166529d2eb06d6046f41dd69`, candidate `cand/0.1.592`. HEAD matched the exact candidate. This re-review covers the prior findings and the repair boundaries. Only this report is committed.

## Verification

Heavy checks ran in an isolated boat.dev sandbox. The candidate archive and original commit object reconstructed the exact HEAD and tree `f6ca2d3f1b4196edb5740a4ea71f0c2eafce0e3b`. Node was 24.22.1; pnpm was the pinned 12.15.0, invoked through Corepack. No full suite ran.

| Command or evidence | Actual result |
| --- | --- |
| Dependency setup | Kept the prepared review-worktree dependencies. Sandbox `pnpm install --frozen-lockfile`: exit 0, 3.9 s. |
| `pnpm run lint` | Exit 0; 3,981 files checked, no fixes. One warning and two infos. |
| `pnpm run typecheck`; `pnpm run build` | Both exited 0. No tracked build drift. |
| `git diff --check 66fd7b470..ac207194e`; `pnpm run check:private` | Passed. The private denylist was empty, so its configured denylist rule was skipped. |
| Installed `squeal status --wait 60000` on the eleven changed paths below | Exit 3 after 60.8 s, revision 5 at `ac207194`: 1,009 selected files current/pass, 161 pending. Whole worktree: zero known failures; 168 of 2,111 files not current. This is incomplete affected-test evidence. |
| Targeted command below | Exit 1, 79.39 s: 14 files passed; two files failed; 77 tests passed, one failed, 13 skipped. Every repair behavior test passed. The two exceptions are described below. |
| `test/ps/checkouts.test.ts`, repeated with the sandbox's DAC-read capability dropped | Exit 0: all eight tests passed, 1.05 s. The initial failure was the old chmod-000 case at line 125: this non-root sandbox had `CAP_DAC_READ_SEARCH` and could still read that directory. All three new N1 cases also passed in the initial run. |
| `test/keys/key-format.test.ts` | Unverified in this reconstructed repository: setup requires an ancestor release tag and history. The archive contains neither. Its 12 tests did not run. This is not a candidate failure. |
| Focused red controls | Eight controls each exited 1 at the intended assertion: B3, B2, S1, S2, N1 sweep, N1 reuse, N1 ps, and B1's shared group bound. Each source edit was restored; the sandbox tree was clean afterward. |
| B1 production-install probe | One passing defect-witness assertion: the default 100 s call returned after **126,137 ms**, with the keying checkout taking **126,083 ms**. Details below. The first remote connection returned HTTP 502; the process continued, and its completed test log was read afterward. |
| Exact-candidate CI | [CI 44950192740](https://github.com/hearsay-tools/squeal/actions/runs/44950192740) remained in progress at the last read. [Private material 44950192774](https://github.com/hearsay-tools/squeal/actions/runs/44950192774) passed. Full-suite evidence remains pending. |
| Performance | No per-release benchmark comparison was supplied for this repair SHA. Performance remains unverified; it does not gate this review. B1 is a functional deadline failure with a controlled install, not a performance-score finding. |

Affected paths:

```text
src/cli/status-at-call.ts src/cli/status-at-daemons.ts
src/cli/status-at-join.ts src/cli/status-at-queue.ts
src/cli/status-at-rekey.ts src/cli/status-at-start.ts
src/core/checkout/commit-worktree.ts src/core/checkout/sweep.ts
src/core/daemon/run-group.ts src/core/daemon/handlers.ts
src/core/ps/checkouts.ts
```

Targeted command, with the pinned pnpm selected through Corepack:

```sh
timeout 600 pnpm exec vitest run --maxWorkers=2 \
  test/cli/status-at-call.test.ts \
  test/cli/status-at-commit-daemon.test.ts \
  test/cli/status-at-call-after.test.ts \
  test/cli/status-at-deadline.test.ts \
  test/cli/status-at-join-bound.test.ts \
  test/cli/status-at-join-recorded.test.ts \
  test/cli/status-at-stopped.test.ts \
  test/cli/status-at-review13-b2.test.ts \
  test/cli/status-at.test.ts \
  test/checkout/commit-identity-failed.test.ts \
  test/checkout/commit-kept.test.ts \
  test/ps/checkouts.test.ts \
  test/daemon/run-group-paths.test.ts \
  test/keys/key-format.test.ts \
  test/version-sensitive.test.ts \
  test/runners/boundaries.test.ts
```

The red controls and timing witness were supplemental checks, not clean-candidate acceptance runs. No probe is committed. The join test observes a socket-request barrier. The timing witness uses a deliberately slow install as its workload; it does not infer background completion from an arbitrary sleep.

## Blocker

### B1 remains open: the finite wait still does not bound the whole call — proven

**Locations:** `src/cli/status-at-call.ts:76`, `:94`, `:132`; `src/cli/status-at-rekey.ts:51`; `src/cli/status-at-daemons.ts:150`; `src/core/checkout/commit-worktree.ts:259`.

D7.3 says the default call waits up to 100 s, then reports. Research Q7 and round 5 T6 require the answer before Claude Code's 120 s tool limit. The repair brief chose to keep every step inside the bound, without a detached owner.

The ceiling wait and the commit install now receive the shared request bound. Requests also share one allowance instead of gaining ten seconds per group. Those repairs work. The following work still runs outside the call's deadline:

1. Initial D2 keying is awaited before the deadline is constructed. Its temporary checkout still has an independent **300 s install timeout** (`at-keys-walk.ts:208`). Neither current-side keying nor adapter work has the call deadline.
2. B3's new final re-key makes another temporary checkout and install after the daemon waits. It receives no deadline. A file completing near 100 s can therefore start another long install before the report.
3. `worktree(root)` receives no bound. `quietStart` calls `startCommand`, including its independent 30 s spawn wait and store/handoff work. If keying takes 95 s, `askBound` allows work to start until 105 s; a worktree daemon start can then take the call past 125 s, before reporting.
4. A second caller's commit install-lock wait remains **360 s**, regardless of its own deadline. The first caller may have a longer explicit wait or a bare `--wait`. Bounding that caller's install does not bound the second caller's wait. Checkout-lock waits likewise retain their independent bounds.

**Measured failure scenario:** a fixture tracks `install.cjs` and a package `postinstall` script. The script links the fixture's Vitest and takes 125 s to finish. The test imports tracked `src/a.ts`; HEAD changes that source. The current-side state and daemon ports are stand-ins, but the commit keyer, temporary checkout and **production package-manager install** are real. There is no install override. Call `status --at <older-commit> test/a.test.ts --run --json` with no `--wait` argument.

The same call returned:

```text
elapsed:       126137 ms
checkoutMs:    126083
run.waitMs:    100000
run.usedMs:    126120
exit:         3
```

It had already exceeded the tool limit before asking either daemon. The result was honest, but it arrived too late for the approved interaction. Thus the stated worst case is **not under 120 s**, and these unbounded parts are **not acceptable** under the current D7/Q7 contract. The ten-second claim grace does not repair them.

The startup ownership limit also remains: `claimWait` returns while `started.lives()` is true when its grace or 60 s claim cap ends (`status-at-start.ts:78`, `:85`). `realDaemons().commit` then returns a problem without stopping the unclaimed process or transferring marker ownership. The creator can exit while the marker still names it. A later sweep can remove the tree before the live process claims it. The new never-claims test proves the early return, but does not prove a safe owner handoff. Ten extra seconds narrow this gap; they do not close it.

**Fix boundary:** one owner must cover the whole finite call, including both keying passes, lock acquisition, install, startup, claim, requests, waits and final reads. Pass the remaining bound to cancellable work and reserve time for cleanup/reporting. At expiry, stop and settle caller-owned work before releasing ownership. If that cannot fit, use a separate live owner and report its request honestly. Do not leave an unowned asynchronous operation behind a timeout race.

**Required regression:** assert return before the call bound plus a small reporting allowance when the initial keying install blocks, when the final re-key install blocks, when another caller holds the install lock with a longer wait, and when a worktree daemon start is late. Prove that an unclaimed startup left at expiry is either stopped or owned. Keep the passing ceiling, early daemon-death, claim-cap and shared-group-bound tests. Their current generous timing limits and fast keying do not cover these remaining paths.

## Closed findings and what fits

| Prior finding | Result and discriminating evidence |
| --- | --- |
| **B2: recorded requests cannot be joined** | Closed. Ping exposes narrow recorded requests. `joinBoth` follows each relevant request on both daemons, then waits for its files. Q7's exact follow-up crosses the held-request barrier, queues no new run and exits 0 once both passes are stored. At expiry the requests remain queued with Q7's line. Disabling only recorded-request discovery makes the barrier assertion fail because the call returns early with the old queue statement. The added socket-bound tests pass. |
| **B3: completed first-run result remains at an obsolete key** | Closed for correctness. Repeated the fresh-store fixture with a tracked runtime read through `readFileSync(new URL('../payload.json', import.meta.url))`, a changed payload at HEAD, and a real commit daemon. The same call reports the commit pass with origin `commit`; the committed regression passed in 4.74 s. Disabling only re-keying restores `not determined` and fails that assertion. The genuine wrong-key negative control also passes. The extra keying cost is part of B1 above. |
| **S1: start overrides explicit stop and holds** | Closed under the coordinator's stated policy. With no daemon, a plain unchanged-tree stop, `--until-start`, or a live command hold prevents worktree startup and survives the call. The commit side still queues. A later tree edit permits a plain stop to expire as at a hook boundary. Removing the stop check makes the regression observe an unwanted start. Preserving these controls is acceptable; the earlier silent override was not. |
| **S2: stale pre-wait run advice** | Closed. Completed and partial joins use the final states, have `next: null` in JSON, and print no stale `--run` advice. The partial report ends with Q7's correct `--wait` command. Restoring the pre-wait probe makes the completed-join regression fail. |
| **N1: identity failure deletes the whole folder** | Closed. In both checkout locations, real unlocked worktrees and trees missing `.git` keep their tree contents and unknown sibling file through sweep and reuse attempts. Each sweep reports the kept folder. `ps` supplies `stop --at` for a valid commit worktree and no deletion command for a kept or identity-failed folder. Disabling each protection separately makes the corresponding preservation or command assertion fail. |

The prior treeless kept-file repair remains covered. The permission case skips under this sandbox's capability check, rather than claiming unreadability was tested there. The earlier independent non-root evidence remains in `wave-23.md`.

`status-at-review13-b2.test.ts` passed both tests in 50.67 s. Its new retry is limited to SQLITE_BUSY-like errors; other failures still throw. This helper-only repair has no deterministic contention red control. It does not alter the product store.

The repair tests cover claim/reuse, Q7 follow-up, final text/JSON, wrong-key refusal, exit 0 for completed comparisons, exit 3 while unknown, and exit 2 for usage. No new wrong comparison was demonstrated. The public call still uses the daemon route; removal of the old private in-call helpers remains row 023-41's work.

## Inputs for the next step

1. Keep B2, B3, S1, S2 and N1 closed. Preserve their behavior tests and the wrong-key refusal.
2. Resolve B1 as a whole-call ownership and deadline rule. Passing a deadline to more individual waits is insufficient while a pre- or post-wait checkout can still install for 300 s.
3. Re-review that ownership boundary and the four missing deadline scenarios. Exact-release full-suite CI must still pass before release; this review does not replace it.
