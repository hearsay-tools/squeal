# Wave 5: publish and shared reader, 0.1.422

## Verification

Candidate: `c15abc2d538a271e413533d8a8d7e04a6e9b5f0c`, range `8a64114a6..c15abc2d538a271e413533d8a8d7e04a6e9b5f0c`. Ran `git fetch origin cand/0.1.422`, checked out that exact SHA, and confirmed it with `git rev-parse HEAD`. The tree was clean before and after verification, before this file was written. No product source or test changed. This reviews 018-20, its help entry, the added `shared.ref` validity cases and the candidate bundles. The human's accepted 018-17 input-stability condition is outside this range and is not reopened.

Read D13–D16, the 018-20 brief, worker notes and transport research. No separate dependency-install command, build or local full suite was run. After the expressly requested candidate fetch, all Git transport in tests and probes used local scratch repositories. The additional probes lived under this task's `$TMPDIR`, outside the worktree, and were removed before committing this report.

| Command | Actual output/result at the candidate |
| --- | --- |
| `pnpm run lint` | Exit 0: `Checked 2938 files in 1428ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm exec vitest run test/ci/publish.test.ts test/cli/ci-publish.test.ts test/cli/ci-usage.test.ts test/shared/reader.test.ts test/shared/policy.test.ts test/daemon/shared-reader-daemon.test.ts test/daemon/policy.test.ts test/types.test.ts test/keys/key-format.test.ts --maxWorkers=2` | Exit 0: **9 files, 71 tests passed**, 11.66 s. The brief requires this explicit targeted run. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/ci/publish.test.ts test/cli/ci-publish.test.ts test/cli/ci-usage.test.ts test/shared/reader.test.ts test/shared/policy.test.ts test/daemon/shared-reader-daemon.test.ts test/daemon/policy.test.ts test/types.test.ts test/keys/key-format.test.ts` | Exit 0 at revision 3, `c15abc2d + 0`: **9 named files, each current**, after 2.9 s. Worktree known failures 0; **252 of 1548 files not current** (42 running, 210 queued), 1872 tests (649 running, 1223 queued). Those remaining checks are pending, not a claimed full-suite pass. |
| `pnpm exec tsx "$TMPDIR/squeal-review-422-nbxayh1_/probe.mts"` | Exit 0. Local bare-repository assertions prove B1 and B2 below. The shutdown probe logs an actual `fetch` and subsequent `cat-file` **after** `close()`. The unchanged-HEAD probe confirms a new merge base but only the older import. |
| `pnpm exec tsx "$TMPDIR/squeal-review-422-nbxayh1_/transport.mts"` | Exit 0. A normal import completes in 249 ms with no note and unchanged config/refs/`FETCH_HEAD`. A deliberately stalled fetch with a 150 ms timer settles in 314 ms, records one timeout note across two nudges and imports nothing. Fetch flags and noninteractive settings are present. A bare receive hook records the new ref and two deletions in **one push batch**. |
| `git diff --name-only 8a64114a6..HEAD -- src/core/store src/core/keys src/runners/observe` | Exit 0, empty output. Import/re-keying code, key builders and the daemon recorder are unchanged. The unchanged key-format test passes with the added shared-ref cases. |

CI and build/bundle drift are **unverified**. The brief limits network to local scratch repositories apart from fetching the candidate, so this review did not query GitHub or run a build. No exact-candidate CI result was supplied. This is not a finding. The coordinator still owns exact-release passing full-suite CI and bundle verification.

## Verdict

**FAIL: two proven blockers, no additional should-fix findings or nits.** The writer's ref, tree and pruning behavior pass. The reader's ordinary selection, transport and import paths pass. Its cancellation boundary and its cache of the start point each miss a concrete D14 case.

## Blockers

### B1 — Proven: shutdown can start a fetch after the reader is closed

Locations: `src/core/shared/reader.ts:153` (awaited membership check), `:159` (unconditional call to take), `:164` (tracking a child after closure without stopping it), and `:90` (close kills only the child already tracked).

The reader's contract says **“Kills the git in flight; no pass starts after.”** The review brief requires **“a stop during start leaves no fetch.”** The daemon calls this reader's `close()` during shutdown at `src/core/daemon/daemon.ts:1110`.

The check at line 142 protects shutdown during listing. There is another await before fetch: `onFirstParentLine()`. During that local Git call, `#child` still names the completed listing process. Closing kills that old process, not the membership call. After the membership call returns, `#take()` starts a fresh fetch without checking `#closed`. Its `#track` callback also accepts that new child. The post-fetch closed check prevents import, but it does not prevent the transport.

Reproduction with the real reader and a local bare remote:

1. Publish a valid export for a commit on the remote's main line. Clone it and open an empty store.
2. Put a small executable `git` wrapper first on this probe process's `PATH`. It records argv and delegates every call to `/usr/bin/git`. Gate only the membership call, `rev-list --first-parent refs/remotes/origin/main --not <commit>^@`, on a release file.
3. Call `reader.nudge()`. Wait for the wrapper to signal that this membership call has started. The remote listing has already succeeded.
4. Call `reader.close()`, write a closure marker to the command log, and release the membership call. Await `reader.idle()`.

Actual calls after the closure marker:

```text
fetch --quiet --no-write-fetch-head --no-auto-maintenance --no-tags
  --no-recurse-submodules --no-prune --refmap= origin
  refs/squeal/5ee31ca3fe2e2ef0ecd548ad03c423fb19f5fb42
cat-file blob 4beb832d220618a2593e851c004739c6855c29de:squeal-results.json.gz
```

The actual fetch succeeds against the scratch remote. No import occurs, which confirms that this is a missed cancellation boundary rather than an ignored close call. The gated operation only selects a valid ordering of existing awaits; no module or result was mocked.

Worker-sized fix: make closure apply to every later transport launch. Recheck it after asynchronous preparation, including membership and network-environment lookup, before starting listing/fetch. Make child tracking cancellation-aware so it cannot retain a newly started child after close. Keep the early daemon-start guard. Add a deterministic regression that closes during the local membership call and asserts **zero later fetches**, plus a close before the first listing. Do not turn shutdown into a wait for the normal fetch timeout.

### B2 — Proven: an unchanged HEAD suppresses a changed nearest-main start point

Location: `src/core/shared/reader.ts:111` (early return keyed only by prefix and HEAD), before the merge-base computation at line 123.

D14 requires a read **“at start and when the worktree's nearest main commit changes”**, selecting the nearest first-parent ancestor of `merge-base(HEAD, <remote>/<default branch>)`. That merge base also depends on the remote-tracking default branch. It can change while the worktree's HEAD remains fixed.

Reproduction against the same local bare remote:

1. Make `c0` on main, then `c1` on a feature branch. Publish exports for both. Initially the remote's main remains at `c0`.
2. Clone a developer worktree and check out the feature branch at `c1`. Start the reader: `merge-base(HEAD, origin/main)` is `c0`, so it imports `c0`.
3. Fast-forward the remote's main to `c1`. In the developer clone run `git fetch origin`; do not check out, rebase or change HEAD.
4. Confirm that HEAD is unchanged and `git merge-base HEAD origin/main` is now `c1`. Call `reader.nudge()` and await idle.

Actual probe output:

```text
HEAD before and after: 5ee31ca3fe2e2ef0ecd548ad03c423fb19f5fb42
old merge base:        e321cc4de9774749179a2f4ca067a6832bdcb729
new merge base:        5ee31ca3fe2e2ef0ecd548ad03c423fb19f5fb42
imports after nudge:  [e321cc4de9774749179a2f4ca067a6832bdcb729]
notes:                []
```

The newer export exists, is on main's first-parent line and has a matching header. The HEAD cache prevents even recomputing the start point. The daemon can keep missing the new export until HEAD or the prefix changes, or the daemon restarts. A normal fetch after a feature commit reaches main can produce this state.

Worker-sized fix: invalidate the local choice cache when the selected upstream/default-branch tip changes, or recompute the start point before deciding it is unchanged. Retain the one-export-per-start-point rule and the skip when that start point's import is already held. Add a regression for the exact unchanged-HEAD/fetched-main transition; the existing test covers a pull that also moves HEAD and cannot detect this case. Ensure the daemon supplies a nudge for the relevant upstream change as well as worktree batches.

## Should-fix

None beyond the two blocking fixes.

## Nits

None.

## What fits

- **Publish shape:** the passing local tests inspect the pushed object as a parentless commit, whose tree contains only `squeal-results.json.gz`, with the exact supplied bytes. Re-publishing replaces the commit's ref. No local results ref is created.
- **Pruning:** the additional bare receive-hook probe uses `keep: 1` after two earlier publications. It receives one batch containing two ref deletions and one ref creation. The outcome reports two deletions, no failed deletions and no unplaced refs. Existing tests cover retained unplaced refs; the worker documents that shallow/unplaced history cannot be pruned. This report makes no claim that such refs were deleted.
- **Policy and keys:** no `shared.ref` means no reader pass or network call. Valid and invalid prefixes and the null default pass. The coordinator-added four validity cases exercise accepted, reserved, non-`refs/`, and invalid-component values. `test/keys/key-format.test.ts` passes; no key builder, recorder or adapter version changes in this range.
- **Selection and refusal:** the reader takes the nearest eligible first-parent export and one export per start point. Tests refuse a reachable side-branch commit that is off main's first-parent line, then select the next on-line candidate. A mismatched header is refused without import. These checks use a scratch bare repository and need no GitHub service.
- **Transport:** normal and slow probes each record exactly one fetch despite two nudges. Both use `--no-write-fetch-head --no-auto-maintenance --no-tags --no-recurse-submodules --no-prune --refmap=` and one explicit ref, with `GIT_TERMINAL_PROMPT=0`, ssh `BatchMode=yes` and `ConnectTimeout=3`. Source budgets are 5 s for listing and 10 s for fetch. The shorter injected timer proves the reader's timeout-note branch; it is not a claim about GitHub throughput.
- **Git state:** the successful and timed-out reader probes leave config, all refs and `FETCH_HEAD` unchanged. Local fetched objects are the intended side effect. No persistent refspec is written.
- **Failure notes:** a missing local remote yields one listing-failure note. A stalled fetch yields exactly one `took too long and was stopped; tests run here as before` note, no import and a prompt return; a second nudge adds no note.
- **Daemon seam:** startup calls `nudge()` without awaiting network, and worktree batches nudge it again. The real daemon test imports at startup without a success status note or changes to Git metadata. The explicit early-stop guard closes a reader created after shutdown began. B1 covers the later asynchronous window that guard does not close.
- **Import seam:** fetched bytes go through `decodeBundle`, header equality and `importRefusal`, then the existing `importResults` with commit blobs, worktree re-keying and an import hash. The daemon then requests result lookups through its existing retry path. No import tolerance or result identity was changed.
- **Help and provenance:** publish appears in CLI/CI help, honors the configured prefix and names pruning counts. Existing import provenance/status code is reused. The test-step input-stability condition accepted for 0.1.421 is preserved.

## Inputs for the repair and next wave

- Repair the two reader lifecycle boundaries in `src/core/shared/reader.ts` and their tests. They can be one worker's row. Preserve the writer and Git transport behavior already verified here.
- Use an explicit closed/cancelled state before every transport launch, including after local awaits. Stop must not launch another fetch or wait out its 10 s budget. Keep shutdown's existing ordering and the startup guard.
- Cache the complete local choice state, including upstream movement. Retain one import per start point, no gap filling, first-parent/header refusal, opt-in policy and the no-ref/no-config/no-`FETCH_HEAD` contract.
- Re-review with the two deterministic local regressions and the current targeted files. No local build or full suite is required for that review. CI and the bundle drift check remain the coordinator's exact-release evidence.
- GitHub acceptance of custom-ref writes with the Actions token remains D17's unverified deployment experiment. Nothing in this local review claims that experiment ran.
