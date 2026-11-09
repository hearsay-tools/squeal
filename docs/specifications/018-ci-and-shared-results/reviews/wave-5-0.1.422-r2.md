# Wave 5: shared reader repair, 0.1.422 R2

## Verification

Candidate: `f44f6676006e0249946780ed5e76e91af473b3d9`. Ran `git fetch origin cand/0.1.422`, checked out that exact SHA, and confirmed it with `git rev-parse HEAD`. Verification ran on a clean tree. This is the bounded re-review of B1 and B2 in `wave-5-0.1.422.md`, against the `018-20 R1` brief, D14 and the repair delta since `c15abc2d538a271e413533d8a8d7e04a6e9b5f0c`. The candidate is rebased onto released main `cc174547e`; unrelated main changes are outside this review.

Dependencies were already installed. No install, build or full suite was run. After the requested candidate fetch, all test and probe transport used local scratch repositories. Independent probes lived under this task's `$TMPDIR`, outside the worktree, and were removed before committing this file. No product source or test changed.

| Command | Actual output/result at the candidate |
| --- | --- |
| `git rev-parse HEAD` | `f44f6676006e0249946780ed5e76e91af473b3d9` |
| `pnpm run lint` | Exit 0: `Checked 2946 files in 1642ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm exec vitest run test/shared/reader-lifecycle.test.ts test/shared/reader.test.ts test/shared/policy.test.ts test/daemon/shared-reader-daemon.test.ts test/ci/publish.test.ts test/cli/ci-publish.test.ts test/keys/key-format.test.ts --maxWorkers=2` | Exit 0: **7 files, 49 tests passed**, 17.60 s. Explicit targeted run requested by the brief. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/shared/reader-lifecycle.test.ts test/shared/reader.test.ts test/shared/policy.test.ts test/daemon/shared-reader-daemon.test.ts test/ci/publish.test.ts test/cli/ci-publish.test.ts test/keys/key-format.test.ts` | Exit 0 at revision 5, `f44f6676 + 0`: **7 named files, each current**, after 5.3 s. Known failures 0. **155 of 1549 files not current** (15 running, 140 queued), 967 tests (122 running, 845 queued). Remaining checks are pending. |
| `pnpm exec tsx "$TMPDIR/squeal-review-422-r2-us1c4knb/probe.mts" "$TMPDIR/squeal-review-422-r2-us1c4knb"` | Exit 0. Eleven shutdown stages: no later Git invocation, import or status note at any stage. Nine signal-aware children die and `idle()` resolves before the gate is released. The two local helper children survive, as N1 records. An unchanged-HEAD/new-main fixture imports both commits through an idle change-feed batch with zero paths and no watcher hints. |

Exact-candidate CI and bundle drift are **unverified**. The brief permits no external network beyond the candidate fetch and forbids a build. No CI result was supplied. These are verification limits, not findings. The coordinator still owns exact-release full-suite CI and bundle verification.

## Verdict

**PASS: zero blockers; one proven nonblocking should-fix note; no nits.** Both previously blocking reproductions pass. The stronger claim that stop kills every local child is not established: N1 proves two exceptions. Under the bounded re-review rule, this additional local-process issue is a note; it does not reproduce the prior fetch-after-stop or stale-start-point failure.

## Blockers

None. Previous B1 and B2 are resolved as follows.

### B1 resolved: no later fetch after stop during preparation

`src/core/shared/reader.ts:111` checks one abort state around each awaited stage. The signal also reaches the Git calls inside selection, environment lookup, listing and fetch, including `cat-file`. An aborted signal refuses another spawn. An abort kills the current signal-aware child and releases its pipes.

The independent fixture publishes a valid export to a local bare remote. A Python `git` executable first on the probe's `PATH` logs argv and its PID, holds the selected call on a file gate, and then replaces itself with `/usr/bin/git`. Each stage uses a fresh reader and store. After the gate is reached, the probe calls `close()`, waits 300 ms, checks child existence and reader idleness, releases the gate and awaits completion.

| Held stage | Child exists 300 ms after close | Idle before release | Later Git calls / imports / notes |
| --- | --- | --- | --- |
| `remote` | No | Yes | 0 / 0 / 0 |
| `symbolic-ref` | No | Yes | 0 / 0 / 0 |
| `merge-base` | No | Yes | 0 / 0 / 0 |
| First-parent candidate walk | No | Yes | 0 / 0 / 0 |
| `config --get core.sshCommand` | No | Yes | 0 / 0 / 0 |
| `ls-remote` | No | Yes | 0 / 0 / 0 |
| First-parent membership check (original B1) | No | Yes | 0 / 0 / 0 |
| `fetch` | No | Yes | 0 / 0 / 0 |
| `cat-file` | No | Yes | 0 / 0 / 0 |
| `ls-tree` | Yes | No | 0 / 0 / 0 |
| `gitHead` fallback | Yes | No | 0 / 0 / 0 |

The original B1 gate now ends without any fetch. The committed tests also cover immediate close after nudge and stopping an in-flight fetch without waiting for its 20-second test budget. Later completion of either uncancelled helper still cannot reach another Git call or import in this probe.

### B2 resolved: a fetched main change is observed with HEAD fixed

`src/core/shared/reader.ts:136` recomputes the merge base before consulting the prefix/start-point cache. The old HEAD-only early return is gone.

The independent fixture keeps the developer's HEAD at feature commit `330a6c99181ca1ade2f5cb8f193600acbb9a2e50`. Main initially names `2bd3258925dd29fe2e222534e5d511cd1aec6e36`, whose export is imported first. CI then fast-forwards main to the feature commit and the developer fetches. HEAD stays fixed and the merge base moves. An idle batch imports the new export; both commit headers are in the store, with no status note.

The lack of a `.git` hint does not leave this state undetected. The real `ChangeFeed` emits reconciliation batches even with no paths (`src/core/watcher/change-feed.ts:275`, `:340`); its idle timer requests reconciliation (`:368`). `src/core/daemon-loop/index.ts:101` calls `afterBatch` even for an empty batch, and the daemon nudges the reader there. The probe used this real feed with a no-hint backend and only its idle interval shortened to 100 ms. It recorded two `interval` batches with `paths: 0`, including the batch that supplied the post-fetch nudge. The production idle interval is **30 seconds** (`src/core/types/watcher.ts:14`). No immediate `.git` notification is promised by D14 or the R1 rule to recompute after each batch. An extra `.git` watch is not required to fix B2.

## Should-fix notes

### N1 — Proven, nonblocking: two local children survive close; the HEAD fallback has no timer

Locations: `src/core/shared/reader.ts:123` and `:205`. The unchanged helpers are `src/core/status/git-head.ts:50` and `src/core/commit/tree.ts:22`.

R1 says **“a stop kills any child it started.”** These two calls do not receive its signal. The gated local probes show each PID still alive and `idle()` still pending after close. Releasing each gate completes the pass without a later Git invocation or import. `ls-tree` has a 30-second timer. The reader calls `gitHead(root)` without timeout options, so its `rev-parse --verify -q HEAD` fallback has **no timer**. That fallback also runs for an unborn HEAD; it is not limited to reftable repositories. Worker notes claiming that both calls have timers and the fallback is reftable-only are incorrect.

This is a remaining gap in the broad child-cancellation rule and the `close()` API comment. It does not reopen the original B1: both helpers already existed at the prior candidate, start before close, and the stop check prevents subsequent fetch/import. Daemon shutdown calls `close()` without awaiting reader `idle()`. This report does not claim that the whole daemon exits while such a child is deliberately held.

Worker-sized follow-up: use the same cancellation-aware Git path for the reader's HEAD fallback and commit-tree listing, or extend the existing helpers to accept cancellation without changing their other callers' defaults. Give the fallback an explicit bound. Preserve blob parsing and the no-spawn fast HEAD path. Add close-during-helper tests that assert child death and prompt idle, then correct the notes and API claim. Do not weaken the checks that stop later fetches and imports.

## Nits

None.

## What fits

- Both original reproductions are now committed regressions and pass independently with local Git.
- Cancellation reaches nested Git calls, including `cat-file` after fetch and the multiple calls that resolve an upstream. The nine gated signal-aware stages stop promptly and emit no false failure note.
- Prefix plus computed start point retains the one-export-per-start-point behavior. Idle reconciliation supplies a nudge without a worktree edit.
- Existing reader refusal, timeout, metadata-preservation and opt-in tests pass. The publisher, policy and key-format tests pass. The repair changes neither publisher nor key construction; the prior review's settled writer/import behavior is not reopened.
- Startup's real-daemon import test passes. Network remains background work; no new hook wait or network call site was added.

## Inputs for the next wave

- Original B1/B2 need no further repair. Keep the lifecycle regressions and the start-point computation before the cache check.
- Carry N1 as an explicit local-process limitation if it is deferred. Do not describe `close()` as killing every child, or the fallback as bounded, until the follow-up verifies it.
- Preserve `nudge()` after every delivered batch, including empty idle reconciliation. A fetch-only upstream move can otherwise lose its automatic detection path.
- Keep the existing 5-second listing and 10-second fetch budgets, one failure note, first-parent/header refusal and existing import/re-keying path.
- Exact-release CI, bundle drift and D17's GitHub custom-ref experiment remain coordinator evidence outside this local re-review.
