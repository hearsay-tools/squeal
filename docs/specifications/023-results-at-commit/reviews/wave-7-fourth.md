# Wave 7 fourth review: whole-checkout check

PASS c6c93d4584c11a10529f7a5ecb6f8af257a178ef

Zero blocking findings remain in this bounded review. B5 is closed for the ordinary and hidden source rewrite, executable-mode change, internal and external link retarget, and hidden link deletion. A changed checkout may run, but none of its results is stored or presented as the named commit's result. This is the human-approved whole-checkout rule in the fourth-review brief.

Scope: the B5 findings in `wave-7-rereview.md` and `wave-7-third.md`, repair `3a989cbcf` (pick of `54c99414c`), its callers and rebuilt bundles. The earlier B1–B4, B6 and B7 scenarios remain settled except where these callers changed. The candidate is `cand/0.1.555`, rebuilt on main 0.1.553. No product code was edited.

## Verification

The checks and independent probes ran at the exact requested candidate with a clean tree, before this report was added. Dependencies were already installed; setup was not repeated.

| Check | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach c6c93d4584c11a10529f7a5ecb6f8af257a178ef`; `git rev-parse HEAD`; `git log origin/main..HEAD` | Exact requested SHA. Seven candidate commits: the original row, tests, repairs and bundles. Fetched main: `bdc4ffdde7718acd6d1b678de3b1c3b481889e22`. |
| `pnpm run lint` | Exit 0: `Checked 3682 files in 2s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`. |
| `pnpm run build`; `git status --short` | Exit 0. All four plugin builds completed; no bundle drift or other working-tree changes. |
| `pnpm run check:version origin/main HEAD` | Exit 0: `0.1.553 -> 0.1.555, ok`; adapter `1.0.3 -> 1.0.3, ok`. |
| Initial affected Squeal wait | Exit 3 after 60.8 s: revision 11 not listed; 303 selected test files pending and one current pass, with 1,232 worktree test files queued. No known failures. This did not verify the new candidate. |
| Repeated affected Squeal wait | Exit 3 after 61.3 s at revision 11: 302 selected files pending and two current passes; whole worktree 4 running, 1,228 queued, no known failures. This remains supplemental pending evidence. |
| Final `squeal status --wait 60000` | Returned on timeout after 61.0 s at revision 13 (report edits): 1,024 affected files pending, all queued; no known failures. This is not a passing broad affected gate; the eight-file direct run above supplies the focused evidence. |
| `pnpm run check:private` | Exit 0: `7415 added lines in 63 files ... ok`; warning: private denylist empty, so that rule was skipped. Repeated with this report staged before committing. |
| Focused direct run below | Exit 0: **8 files, 41 tests passed**, 59.09 s. Direct execution supplied current evidence because the affected wait could not do so. |
| Eight standalone real-adapter probes | Exit 0. All seven changed-checkout cases stored zero results; honest control stored and reused its pass. Details below. |
| Three representation probes | Exit 0. A CRLF checkout, a custom smudge filter and an actual sparse checkout each returned the differing tracked path from `checkoutChange`. |
| [Candidate CI](https://github.com/hearsay-tools/squeal/actions/runs/44198277652) | In progress at the last read. No local full suite ran. |
| [Private material CI](https://github.com/hearsay-tools/squeal/actions/runs/44198277586) | Completed successfully for this exact candidate. |

The affected wait used:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 \
  src/core/commit/at-keys-verify.ts src/core/commit/at-keys-walk.ts \
  src/cli/status-at-run.ts test/cli/status-at-run-inputs.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

The focused direct run used the task's background job runner, with this command:

```sh
timeout 600 pnpm exec vitest run \
  test/cli/status-at-run-inputs.test.ts test/cli/status-at-run-review.test.ts \
  test/cli/status-at-run.test.ts test/cli/status-at-run-env.test.ts \
  test/cli/status-at-run-killed.test.ts test/commit/at-keys.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts
```

## B5 disposition and independent evidence

The standalone probes used `NODE_ENV=test timeout 600 pnpm exec tsx <temporary-script>.mts`. Each created a repository outside this worktree, used `statusAtCommand`, this candidate's real source CLI relaunch and the real Vitest adapter, and linked this worktree's Vitest during checkout install. HEAD added a comment to the test, so the base test was selected. Each call used a 600-second run budget. Fixture repositories were removed; each probe asserted only its main worktree remained. Probe scripts were removed before committing.

For the link cases the base had `src/value.ts -> one.ts`, where `one.ts` exports 2. A tracked `two.ts` and tracked `value/index.ts` export 1. The test imports `../src/value` and expects 1. The external module also exports 1. This preserves the third review's failure scenarios.

| Probe | Actual run result | Later lookup with the same install | Later lookup with an honest install |
| --- | --- | --- | --- |
| Ordinary install source rewrite, 2 to 1 | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Same rewrite hidden by `assume-unchanged` | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Executable-mode change hidden by `assume-unchanged` | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Link retarget to tracked `two.ts`, hidden | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Link retarget to an absolute path outside the repository, hidden | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Link deleted, hidden; resolution uses `value/index.ts` | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Unrelated tracked `readme.txt` rewritten | selected 1, ran 1, stored 0, notComparable 1 | not comparable | no result |
| Honest install | selected 1, ran 1, stored 1, notComparable 0 | pass from the store | pass from the store |

Each changed-checkout JSON file state was `not comparable`, with `ran: "pass"` and reason `install changed the checkout: <path>`. Top-level `changed`, `run.changed` and numeric `inputCheckMs` agreed. The external-link text probe asserted `pass when run, not stored (install changed the checkout: src/value.ts)`; its output also showed the unstored-count line. Calls returned 3: changed sides are unknown for comparison; the honest control's current side had no result. Neither outcome is reported as a known commit comparison.

The code now has one input owner: `checkoutChange` compares every tracked blob path with the requested commit, using file kind, Git executable mode, raw bytes and link target. It does not consult index flags, current HEAD, a post-install closure or a link's resolved target. Thus the two missing-link associations from the third review no longer matter. The unrelated-file probe confirms the check governs the whole checkout.

A mismatch travels through `withCheckout`, `inCheckout`, `keysAtCommit` and the CLI's hooks. The child receives `store: false`; `runGateFiles` uses collection without the shared-store reader/writer. Changed-checkout outcomes do not read the store to infer a pass. Plain lookups show not comparable, while `sideKeys` gives no comparable key. The copied-test exception remains limited to D5's explicit copied paths. The focused `at-keys` tests passed that existing mixed-tree use.

## Representation limit: accepted, nonblocking

**Proven by probes and source:** `src/core/commit/at-keys-verify.ts:55` checks raw checkout data against Git blobs. An `eol=crlf` attribute produced CRLF bytes from an LF blob; a custom smudge filter produced expanded content from a pointer-like blob; an actual sparse checkout omitted a tracked file. Each check returned `data.txt` as changed. The same changed-path propagation above disables storage for the whole run.

This is a conservative limit of the human's chosen rule, not a false commit pass. Tests may still run and show their outcome, explicitly not stored and not the named commit's result. The reason names a path; it does not silently claim successful storage. Actual Git LFS tooling was not exercised. A hydrated LFS file with bytes different from its pointer blob follows the same raw-byte mismatch rule by inspection.

The limit applies when a representation actually differs. Merely having `.gitattributes`, LFS configuration or sparse-checkout configuration does not itself disable storage if every tracked blob path still matches. The worker's “never store” description should be read with that qualification. No extra blocker or support guarantee is inferred here.

## What fits and what remains outside this review

The earlier `run.notComparable` count omission is fixed for changed-checkout runs. JSON and text distinguish a run's outcome from a stored commit result. The focused tests also passed environment preservation, project identity, coverage-off storage, diff/all-missing selection, checkout/install budget and rerun reporting, killed-process cleanup and sweep, key format and runner boundaries. The one-checkout lifecycle remains intact; the input check is inside checkout time and the overall budget.

No further repair is required by this bounded review. Keep the whole-checkout verifier as the single owner of this install invariant. Full candidate CI and any pending affected results remain separate verification limits; this PASS does not claim a full-suite result or authorize a release.
