# Wave 5 fourth review

PASS `b5cfd1c59038d6e36c0f0127c91e6ef4aaf7fc49`

Candidate `cand/0.1.544`, row 023-16, based on `fe131101aeb9ee7943241ef26759e82a24979718` (`cand/0.1.543`, row 023-14). Review range: `fe131101a..b5cfd1c59`, 16 commits. **0 blocking findings. B1 is closed, including both third-review cases. B2 and the concrete B3 scenario remain closed. One proven documentation note and one carried plausible lifecycle note; neither blocks.** No product code changed in this review.

## Blockers

None.

## Verification

All code verification and probes below ran at the exact candidate with a clean tracked tree, before this review was added. The build caused no tracked drift. Only this findings file is committed. Dependencies were installed by Squawk before launch; the explicit instruction not to repeat setup takes precedence over the review skill's install step.

| Command or evidence | Actual result |
| --- | --- |
| `git rev-parse HEAD` | `b5cfd1c59038d6e36c0f0127c91e6ef4aaf7fc49`, the requested candidate |
| `git log --format='%h %s' fe131101a..HEAD` | 16 commits, from `46d78c605` through `b5cfd1c59` |
| `git status --short`, before checks and after build/probes | Empty |
| Dependency setup | Squawk reports `pnpm install --frozen-lockfile` completed in 1 s before launch. No install stdout was supplied; setup was not repeated. |
| `timeout 600 pnpm run lint` | Exit 0: `Checked 3632 files in 1392ms. No fixes applied.` |
| `timeout 600 pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `timeout 600 pnpm run build` | Exit 0: TypeScript and Claude Code, Codex, Pi and OpenCode builds completed; tracked tree stayed clean |
| `git diff --check fe131101a..HEAD` | Exit 0, no output |
| Squeal seven named test files, command below | Exit 0 after 1.4 s: `Named test files at revision 0: no known failures; 7 test files, each with a current result.` Worktree: 928 of 1927 files not current, 88 queued and 840 unknown. Current results can be inherited by content key; this is not a fresh full-suite claim. |
| Squeal affected-source waits, command below | First wait exited 3 after 60.7 s: 369 selected, **16 current passes, 71 pending, 282 unknown**, no known failures. Second wait exited 3 at revision 0: **87 current passes, 0 pending, 282 unknown**, no known failures. The baseline is lookup-only. Worktree: 839 of 1927 files unknown. Broader affected coverage is **unverified**. |
| `squeal status --wait 60000 docs/specifications/023-results-at-commit/reviews/wave-5-fourth.md`, using the absolute launcher below | Exit 3 at revision 2: `No verdict: no test file's closure holds` the review path. This documentation-only edit has no affected-test verdict; no new product test is needed for it. |
| `timeout 600 pnpm exec vitest run --config <probe>/vitest.config.mjs --root <probe> --reporter=verbose` | Exit 0: **2 tests passed**, 2.51 s. Target-only enumeration, no current adapter/config load, both APIs' key/result lookup, unchanged database, explicit all-files install failure, and unlisted-file refusal passed. |
| `timeout 600 pnpm exec tsx <probe>/cost.ts` | Exit 0: real adapters and default frozen install; one named file at `fe131101aeb9ee7943241ef26759e82a24979718` took **6402 ms**, checkout step **6365 ms**; `failure: null`, one key returned with 6 stored records |
| `pnpm run check:private`, before the findings commit | Exit 0: `private: 7814 added lines in 70 files over 03bfaa548d20e69b0a4fc7679c22c6db9e881179, ok`. Local private denylist was empty, so that rule was skipped with a warning. This scanner reads committed HEAD; only this review was untracked, and its text was checked separately for absolute home paths. |
| `gh run list --commit b5cfd1c59038d6e36c0f0127c91e6ef4aaf7fc49 --json databaseId,name,status,conclusion,headSha` and `gh run view 44106892191 --json headSha,status,conclusion,jobs` | Exact-candidate [CI 44106892191](https://github.com/hearsay-tools/squeal/actions/runs/44106892191) **in progress**. Latest observation: six Node 22/26 shards in progress; Node 24 lint/typecheck/version-sensitive/build job completed **success**. CI full-suite evidence is **unverified**, not a finding. Exact-candidate [Private material 44106892157](https://github.com/hearsay-tools/squeal/actions/runs/44106892157) completed **success**. |

The external probe folder was `~/projects/squeal/.ai/squawk/t/27a2699b/sq-fourth-review-8gop5fa0`; commands used its expanded path. Its source and link to the installed tools were removed before committing. Fixture cleanup removed the fixture repositories and checkouts. No full suite or full-suite checkpoint was requested. No changed test is outside Squeal's coverage. The direct tests check the new target-only boundary rather than rerunning the covered candidate test files.

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  test/commit/at-keys.test.ts test/commit/at-keys-resolution.test.ts \
  test/commit/at-keys-killed.test.ts test/checkout/group.test.ts \
  test/keys/key-format.test.ts test/version-sensitive.test.ts \
  test/runners/boundaries.test.ts

"$SQUEAL" status --wait 60000 \
  src/core/commit/at-keys.ts src/core/commit/at-keys-checkout.ts \
  src/core/commit/at-keys-side.ts src/core/commit/at-keys-walk.ts \
  src/core/checkout/checkout.ts src/core/checkout/install.ts \
  src/core/checkout/marker.ts src/core/code/gate/stored.ts \
  test/commit/at-keys.test.ts test/commit/at-keys-resolution.test.ts \
  test/commit/at-keys-killed.test.ts test/checkout/group.test.ts \
  test/keys/key-format.test.ts test/version-sensitive.test.ts \
  test/runners/boundaries.test.ts
```

## Previously blocking findings

### B1: closed by removing current-key reuse

`at-keys-fast.ts`, `at-keys-diff.ts` and `at-keys-untracked.ts` are gone. Neither public entry imports a git-only key builder or accepts a current key. `keysAtCommit` uses git only to resolve the commit and reject explicitly named files absent from its tree (`at-keys.ts:60`). Every remaining file goes to `inCheckout`, which asks `open.keyer.keyed(refs)` in the target checkout (`at-keys-checkout.ts:77`). Default selection now comes from the target adapters, not the current worktree. `sideKeys` prepares the mixed tree, then uses that same path.

The current real-adapter regression results cover shrinking closure, removed glob match, larger current closure and root `package.json` imports retarget through both APIs. They compare against independent plain detached worktrees. The resolution regressions cover the original `.ts` directory shadow, configured `.custom`, the deeper `package.json` main redirect and tracked folder symlink retarget. Each differing-key fixture checks the older exact key; the seeded-result fixtures reject the current pass and select the older failure. The `.custom`, deeper-main and symlink fixtures also run real A/B tests and check A fails while B passes. These close the two third-review B1 cases, rather than adding another resolution heuristic.

The independent probe adds a test present only at A. B deletes it and replaces its Vitest config with a top-level throw. An adapter wrapper refuses any attempt to open at the user's root. Default selection, named selection and `sideKeys(code: A, tests: A)` each return A's independently walked key. All three adapter opens occur in checkouts. The store contains a seeded failure at that key, and both the default lookup and side lookup return it:

```text
reference A key: d896782aeadf9a51a3a18fc1ee3140d2c0db7114db2a60b7156080e497aa9930
adapter opens: 3, none at the user's root
database SHA-256 before/after: equal
remaining fixture checkouts: []
```

### B2: remains closed

Target environment and closure now have one owner, the target keyer. The unchanged config reading changed `choice.txt` into `define.CHOICE` remains a real-adapter regression through both APIs, with A's key/failure selected. No current environment can authorize reuse. The external broken-current-config probe also establishes that current config loading is unnecessary.

### B3: remains closed for the recorded-install scenario

The real default `npm ci` preinstall kill regression is current and passing. It waits until the lifecycle script is alive, kills the lookup owner, then invokes another lookup. That lookup's sweep stops the recorded install group and removes its checkout and git worktree. The injected-install kill regression and marker/group identity tests also pass. The default install derives its frozen command from the target tree. Removal and sweep stop the marker's group before removing the tree. This proves cleanup after the next sweep, not immediate cleanup at the instant of owner death.

## Nonblocking notes

### N1. Proven documentation drift, carried forward

**Locations:** `spec.md:47` and its environment/git-only reference steps; `docs/board.md:2549`; `status.md` amendment log; `src/core/commit/at-keys-walk.ts:25`.

The human's 2026-11-17 instruction drops the fast path. The candidate implements that instruction. D2 still promises unchanged files retain a current key without a checkout, the board still names the fast path, and the amendment log has no entry for its removal. The walk module's preamble still says it handles files the fast path cannot settle. The worker notes correctly describe the new behavior. This mismatch is a note, not a reason to restore the rejected mechanism.

**Bounded follow-up:** The coordinator should fold the approved decision into D1/D2, the goals, board and status when recording this review. Update the walk preamble on the next owned code edit. Make the gate keyer the authority for every present file; retain git only for commit resolution, absence and test-blob copy. Do not alter the historical research or review findings.

### N2. Plausible lifecycle window, unchanged from the re-review

**Locations:** `src/core/checkout/install.ts:60` through the `started` callback; `src/core/commit/at-keys-walk.ts:159` through marker recording.

The earlier spawn-before-marker interval still exists. SIGKILL in that interval could leave an unrecorded install group that the next sweep cannot identify. It was not forced in this review and remains **plausible, nonblocking**, as in `wave-5-rereview.md` N1. The ordinary held-preinstall regression does not prove this interval safe. A follow-up needs a deterministic barrier and a supervised create/register lifetime, not another ordinary post-marker kill test. No new lifecycle blocker is established by this delta.

## Should-fix and nits

Fold N1 into the coordinator's documentation update. No new product should-fix or nit. The previously documented `squeal-links-*` temporary-folder residue remains an input to per-run scratch ownership; this review does not re-prosecute it.

## Cost and what fits

The reported 50.4/51.3 s for 1,919 files and 5.8 s for one file are plausible. The independent one-file measurement here is 6.4 s including checkout, default install, real adapter load, keying and removal. Earlier research measured 40 to 58 s for about 1,900 fresh keys and 4.2 to 6.1 s for one. This review did not repeat the all-files timing, so the worker's exact 50 s and peak-memory figures remain its measurements, not new reviewer measurements. The performance cost no longer buys an unproved current-key shortcut.

The shared store opens through `readStores` and `openReadOnly` (`DatabaseSync` with `readOnly: true`). Observed rows seed only the scratch store. The keyer owns and removes that scratch store and closes its adapters. The database-hash regressions and independent probe find no shared database writes. Both lookup APIs remove their checkouts on normal completion and install failure.

## Inputs for the next wave

- Call `keysAtCommit({ root, commit, adapters, squealVersion, env, files? })`. No `files` means files listed at the commit. An explicit absent-only selection avoids a checkout.
- Consume `{ key, stored }` or `{ notDetermined }` per file. `via`, `current` and `changed` were removed. Use `checkoutMs` for the complete checkout step.
- Check top-level `failure` before interpreting an empty default-selection map. Enumeration cannot occur when install fails. The external failure probe verifies that this is explicit.
- For D3, acquire current keys separately in row 023-06. Never label the target lookup as the current worktree's validation.
- Call `sideKeys({ root, code, tests, files, ... })` for the mixed tree. `tests: null` means the worktree's named tests now. Helper copying and absent-source classification remain row 023-08's work, as documented in the worker notes.
- Default install budget remains 300 s. Row 023-07 must own D4's total 600 s budget, including install. These library entries do not implement the complete command budget.
- Require passing full-suite CI for the exact release commit. This PASS does not assert that pending CI or the broader unknown affected checks passed.
