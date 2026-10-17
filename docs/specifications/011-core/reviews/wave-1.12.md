# Wave 1.12 review — 011-14, issue 28

FAIL 09956c8fbf01fef56579c13a53ea13b3bbc9847b — three proven blockers, one should-fix, one nit.

Reviewed detached candidate `cand/0.1.212` at exactly `09956c8f`, range `e59bdd76..09956c8f` (eight commits). Product tree clean during verification. This review changes no product code. Contract: board 011-14; spec C5/C6; the 2026-10-17 amendment and accepted defaults in `tasks/011-14/notes.md`.

## Verification output

Node `v24.21.0`; npm installed from the candidate lockfile. Each check below ran independently in this reviewer tree.

```text
npm ci — exit 0
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities

npm run lint — exit 0
Checked 1407 files in 487ms. No fixes applied.

npm run typecheck — exit 0
> tsc --noEmit

npm run check:version -- origin/main — exit 0
version bump: 0.1.211 -> 0.1.212, ok
```

`origin/main` for the version check was `62254a2a68d132677251858cc7314357f8847997`.

```text
npx vitest run test/state/fingerprint-volatile.test.ts test/state/refingerprint.test.ts test/daemon/refingerprint-start.test.ts test/integration/fingerprint-two-worktrees.test.ts test/store/worktree-meta.test.ts --maxWorkers=4
Test Files  5 passed (5)
     Tests  23 passed (23)
  Duration  2.46s
exit 0

flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
Test Files  702 passed | 1 skipped (703)
     Tests  5975 passed | 9 skipped (5984)
  Duration  807.55s
exit 0
```

`npm run build` was deliberately omitted as instructed. CI run `39046878426` is pinned to the same SHA; it completed successfully (Node 24 lint/typecheck/version-sensitive/build/bundle checks and all three Node 22 shards; the nightly full-suite job was skipped). The coordinator's earlier full run is context, not substituted for this reviewer's run.

The existing issue-28 probe, run against this candidate, reports A/B/C/F equal and D/E distinct. The issue's two pairs are fixed and the assertion-value and changed-filename controls survive.

For red/green, archived `e59bdd76` outside this checkout, linked the installed dependencies, and copied only the two new test files `fingerprint-volatile.test.ts` and `fingerprint-two-worktrees.test.ts`. Ran:

```text
node node_modules/vitest/vitest.mjs run test/state/fingerprint-volatile.test.ts test/integration/fingerprint-two-worktrees.test.ts -t 'fingerprint of|a heal from' --maxWorkers=4
Test Files  2 failed (2)
     Tests  6 failed | 4 passed | 2 skipped (12)
  Duration  2.49s
exit 1
```

Five masking assertions and the real-runner, two-worktree inherited regression fail on the old code; the four precision controls pass. The two `renormalizeFingerprint` cases in that file were excluded from this baseline comparison because their new export does not exist there. This is evidence of behavioral regressions, not missing-import failures. All throwaway probes and the baseline run used an explicit throwaway `HOME`. No probe started a daemon against the real home or repository store.

Squeal’s separate background baseline reported failures in `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119`. Its `why` history includes the same node:test assertion failing on earlier commits (`d831ece`, `bbf5722`); those files are unchanged in this range. These background reports do not replace the independent full-run result above or establish a blocker against this row.

Additional probes imported the current source and the actual `e59bdd76` fingerprint source, and exercised isolated SQLite stores through the public store/sink/delta interfaces. Their discriminating outputs are preserved below; no probe source is part of this commit.

## Blockers

### B1 — Proven: named directories are mistaken for random segments and real changes disappear

`src/core/state/fingerprint.ts:55` and `:75`.

The new `-(?![a-z]{6}$)[A-Za-z0-9]{6}$` test classifies any six-character suffix containing a digit or capital letter as random, including meaningful release names. With the same error name and source location:

```text
open /tmp/run/release-v12345/a.js
open /tmp/run/release-v23456/a.js

old: distinct fingerprints
new: both Error: open <tmp>/a.js @ test/serve.test.ts:42:7
```

Likewise `/tmp/run/my-MODULE/a.js` and `/tmp/run/my-PLUGIN/a.js` collapse. These are named directories below the first scratch directory, not evidence of a random allocation. A failing check that changes which release/module it cannot open now remains silent. The added test protects only all-lowercase `my-module` and `my-plugin`, so it misses this boundary.

This breaks C5's retained path tail and the vision's requirement to notify when the failure itself changes. The old code distinguished these inputs, so this is an introduced loss of information.

**Fix scope:** narrow the classification of later scratch directories using a justified scratch layout/prefix or other evidence of randomness; keep meaningful version/module segments. Add both controls above. Do not fix B2 by simply accepting every six-letter suffix: that worsens this blocker. If the intended policy deliberately discards these named tails, obtain and record that contract change rather than claiming narrow masking.

### B2 — Proven: a valid lowercase mkdtemp suffix still produces changed-failure noise

`src/core/state/fingerprint.ts:55`.

The all-lowercase exclusion is not a property of Node's `mkdtemp`. A real `mkdtempSync` loop produced suffix `byytfc` on attempt 32. These valid issue-shaped paths remain different:

```text
open /tmp/squeal-1001/tmp/6db45f9b91a3d272/cez-installed-workers-abcdef/packages/cli.js
open /tmp/squeal-1001/tmp/6db45f9b91a3d272/cez-installed-workers-ghijkl/packages/cli.js

new:
Error: open <tmp>/cez-installed-workers-abcdef/packages/cli.js @ test/serve.test.ts:42:7
Error: open <tmp>/cez-installed-workers-ghijkl/packages/cli.js @ test/serve.test.ts:42:7
```

If just one run draws an all-lowercase suffix and the other a mixed-case suffix, one fingerprint retains the directory and the other removes it. Thus an ordinary rerun of the same failure still yields `fail-changed`, including the inherited refresh already reproduced by this row. The integration fixture allocates immediately below its temp root, where the unconditional first-segment rule conceals this gap; its green result does not cover later nested suffixes.

This is inside the row's promised masking of a mkdtemp suffix in a later segment and C5's same-failure silence goal.

**Fix scope:** cover the complete suffix alphabet in the same bounded scratch context that resolves B1. Add nested-temp tests for lowercase/lowercase and lowercase/mixed-case pairs, with a changed tail remaining distinct. The two classifier findings should be repaired together.

### B3 — Proven: a live old writer invalidates the store-wide migration marker permanently

`src/core/store/fingerprints.ts:33`, `:47`; `src/core/daemon/daemon.ts:369`.

Registration rewrites every worktree's known states and consumer views, but an older daemon can continue to write the old form. Its writes do not clear or advance `fingerprint.rules`. Replacing that daemon later calls the same gate, which returns immediately, leaving old fingerprints in a store advertised as current.

The isolated store probe used the actual old `describeFailure`, unchanged public sink/delta behavior, and **the identical raw error and identical port (35321) at every step**, not a changed volatile value:

```text
seed old result, known state, transition and told consumer view
first new-rules rewrite: 4 rows changed, fingerprint.rules = 2
old writer applies the identical old-rule failure:
  transition ["fail-changed"]
  consumer delta ["fail-changed"]
old consumer records its delivery
replacement's rewriteFingerprints(store, 2, renormalizeFingerprint): 0
  known state still contains 127.0.0.1:35321
new writer applies the identical raw failure under current rules:
  transition ["fail-changed"]
  consumer delta ["fail-changed"]
```

This is a deterministic public-store/sink simulation of the mixed-version boundary, not a claim that a full pair of differently bundled daemon processes was launched. The relevant old sink and delivery code is unchanged in the candidate range. A different key version does not prevent it: these known states and consumer views are per worktree/check, not partitioned by fingerprint-rules version.

The first false event is caused by rewriting a live older daemon's comparison state; the second survives until that daemon is replaced because the once-per-store marker is already set. The notes' "each such failure can read as changed once" does not describe or repair this second upgrade event. This violates the added C5 guarantee that no standing failure reads as changed by the rules change.

**Fix scope:** make the upgrade protocol account for writers, not just an initial store scan. Establish a way to finish/retire old writers or normalize their comparison/written rows at a boundary they cannot bypass; do not leave a marker claiming all stored rows use current rules after an old writer commits. Add an old-write-after-migration test followed by replacement and unchanged-error delivery. Preserve the atomicity verified below. Re-running the current global rewrite on every start alone is insufficient: it still changes the comparison state under live old daemons.

## Should-fix

### S1 — Proven edge case: the message delimiter can occur in the error name

`src/core/state/fingerprint.ts:191`.

`CheckError.name` is an unrestricted string, and `src/runners/vitest/results.ts:29` retains it. Splitting at the first `": "` therefore need not find the message. For error name `Error: port 12345`, message `boom`, and location `test/a.test.ts:1:1`:

```text
old and fresh: Error: port 12345: boom @ test/a.test.ts:1:1
rewritten:     Error: port <port>: boom @ test/a.test.ts:1:1
```

The rewrite changes the name, contrary to its documented contract, and a fresh identical result disagrees with it. It is mathematically idempotent after that first rewrite, but it does not leave every current fingerprint unchanged. This is a constructed custom-name case beyond the issue's ordinary Error/AssertionError inputs; carry a regression and an unambiguous encoding or structured reconstruction into the repair rather than declaring all old forms safe.

## Nits

### N1 — Proven documentation mismatch: put the accepted baseline exception in C5

The new C5 sentence promises to rewrite "every stored fingerprint"; the status amendment and accepted notes expressly exclude `baselineFindings` meta entries, which also embed fingerprints. State the exception alongside the C5 promise so the next implementation does not have to infer it from the amendment log.

## What fits

- The original issue pairs normalize equally, without changing raw summaries or errors. Changed assertion values, changed file tails, the tested named lowercase segment, changed hosts, four-digit source lines/columns, and non-temp paths remain distinct.
- Ordinary-name old forms from the issue (`<tmp>/tmp/<hex>/...-jzfwcE/...`, already short `<tmp>/packages/...`, ports), full UUID/hex random segments, duration/address masks, and no-message fallback forms re-normalize consistently in the checked cases. Reapplying normalization is idempotent for these shapes. S1 limits the stronger current-identity claim.
- The rewrite and marker are one write transaction, nested as a savepoint inside registration's `BEGIN IMMEDIATE`. A probe threw on the third callback after earlier updates: results, states, transitions, views and marker all matched the before snapshot afterward. No partial upgrade was committed. The mixed-writer finding is an inter-transaction compatibility failure, not a missing transaction.
- The table inventory covers all five fingerprint columns in the schema. The shared meta-key registry test includes `fingerprint.rules`.
- The two-worktree test uses real Vitest runs, the shared store, schedulers and delivery. Its old-code failure and candidate pass support the inherited-refresh fix through equal fingerprints; no extra change to `storeResults` is needed for that case.
- **Accepted baseline exception:** the probe confirmed that membership changes from true to false when its embedded fingerprint is not rewritten. The failure is still delivered as an ordinary first-seen failure; it is not suppressed or falsely reported passing. Given the explicit accepted amendment, this bounded loss of the baseline label is acceptable for this row. It does not excuse B3's changed-failure events for an already told failure.
- The candidate version check passes and the source pin is exercised by the independent suite. The available `squeal--v0.1.199` tag carries key format 10; this review does not manufacture a new key-format bump or rebuild bundles.

## Inputs for the repair / next review

Repair B1/B2 together in the fingerprint rules and tests, with an explicit decision about how a later segment is recognized as scratch. Preserve host identity, meaningful named tails, source locations and non-temp paths. B3 needs a writer-aware migration contract, with a deterministic old-write/replacement regression in addition to the first-start test. S1 should be covered when changing that migration boundary. Document N1's already accepted exception.

Keep `rewriteFingerprints` before state derivation and keep its rows/marker atomic. Any rules repair must advance `FINGERPRINT_RULES` as its contract requires; re-check the guarded-source pin, version and committed bundles in the coordinator's integration tree. Re-review the repaired candidate and its new regression cases before landing.

## Re-review

FAIL 7b96b921642699855458007ec4d2bbd5cd043ff7 — two proven blockers in B3's repair scope; no new should-fix or nits.

One bounded re-review on 2026-10-17, detached at the requested SHA after fetching `cand/0.1.212`. The force-pushed branch's earlier candidates were not used. The range from `origin/main` is the requested 13 commits. Read the prior B1/B2/B3/S1/N1 findings, repair contract in `tasks/wave-1.md`, Repair 1 notes, amended C5 and the last status amendment. No product changes are proposed or committed by this review.

### Verification output

The following checks ran on the pinned candidate with a clean tree. Node `v24.21.0`. `origin/main` for the version check was `f74ccc4a1d68f210114c325593af8ff4cb6a6ec0`.

```text
npm ci — exit 0
added 196 packages, and audited 197 packages in 6s
found 0 vulnerabilities

npm run lint — exit 0
Checked 1408 files in 458ms. No fixes applied.

npm run typecheck — exit 0
> tsc --noEmit

npm run check:version -- origin/main — exit 0
version bump: 0.1.211 -> 0.1.212, ok

npx vitest run test/state test/delivery test/store test/integration/fingerprint-two-worktrees.test.ts test/keys/key-format.test.ts --maxWorkers=4
Test Files  50 passed (50)
     Tests  526 passed (526)
  Duration  10.87s
exit 0
```

The selection includes all three changed test files, the callers' state/delivery/store suites and the guarded-source pin. This is an independent run required by this review, not a Squeal checkpoint. `npm run build` was omitted as instructed. An independent full run was not taken this round; the coordinator's 701-file, 5,983-pass, 9-skip run remains coordinator evidence. CI `39052181753` has the exact pinned SHA but was still `in_progress` when checked, so it is not recorded as a pass.

Copied the candidate's `fingerprint-volatile.test.ts` and `fingerprint-upgrade.test.ts` into an archive of **09956c8f**, with the installed dependencies linked. With a throwaway HOME and `TMPDIR=/tmp`:

```text
node <candidate>/node_modules/vitest/vitest.mjs run test/state/fingerprint-volatile.test.ts test/state/fingerprint-upgrade.test.ts --maxWorkers=4
Test Files  2 failed (2)
     Tests  12 failed | 12 passed (24)
  Duration  786ms
exit 1
```

Ten failures are behavioral assertions: B1 names collapse, B2 lowercase allocations differ, another scratch root is not recognized, stored/fresh states produce `fail-changed`, S1's stored name disagrees and the baseline label is lost. Two failures are `sameFingerprint is not a function`. Thus the notes' twelve-failure statement is accurate, with that distinction; this is not twelve behavioral regressions.

Throwaway source-import/public-store/public-hook probes passed their five investigative cases (1.34 s). Those cases assert the repaired exact pairs and ordinary B3 behavior and record the counterexamples below, rather than asserting that the counterexamples should pass. Probes imported the actual pre-011-14 fingerprint/transition source from `origin/main`; old forms were not guessed by hand except for the hook's consumer-view fixture. Probes and baseline runs used an explicit throwaway HOME throughout. The temporary test was removed, and the 50-file verification above was repeated on the clean candidate afterward.

Squeal's separate background baseline reported the same recorder-fidelity failures at `test/runners/node-test/run-reads-fidelity.test.ts:116` and `test/runners/vitest/observe-fidelity.test.ts:119` that the first review recorded. `why` was read for both; its history includes these failures on earlier commits/worktrees. Their source files are unchanged by this row. These reports are not substituted for the independent run and do not establish a new blocker against this repair.

### Previously reported cases

- **B1 closed for its exact pairs:** `release-v12345` versus `release-v23456` and `my-MODULE` versus `my-PLUGIN` now remain distinct. Deeper names survive the fresh-path rule.
- **B2 closed for its exact pairs:** `cez-installed-workers-abcdef` versus `-ghijkl`, and `-byytfc` versus `-QI9brD`, below Squeal's root now compare equally. A changed file tail stays distinct. The original issue probe was also run with `node --import tsx docs/specifications/011-core/research/probes/issue-28/fingerprint-probe.mjs`: A/B/C/F remain equal, D/E distinct, exit 0.
- **B3's original port sequence closed:** an old-form state/view, identical raw failure under current rules, an old writer after that, then replacement gives no current-code transition or delta. A probe also used the actual old `transitionKind` to confirm the accepted residual: an old comparison against the current form returns `fail-changed`. The rewrite module, registration call, marker and rules counter are removed. No store-wide rewriting remains.
- **S1 closed under the amended contract:** `Error: port 12345` as an error name compares equally before/after renormalization, with the location kept. Normalization intentionally includes the name as the repair contract now requires.
- **N1 closed:** baseline lookup normalizes both its stored entries and the queried fingerprint; the old-form entry retains its label. C5 no longer promises rewriting or needs the old baseline exception.
- C5 and the last status amendment correctly distinguish current-code comparisons from the accepted older-daemon residual. The failures below arise in current code and are not that accepted residual.

### Blockers remaining in the B3 repair scope

#### R1 — Proven: the old-forms rule does not consistently equate Squeal's own old and fresh paths

`src/core/state/fingerprint.ts:46`, `:56`, `:69`, `:74`, `:190`.

The ordinary issue layout works, but two supported shapes do not. Each experiment used **the identical raw message, error name, location and allocation** before and after; only the fingerprint rules differed. Seeding an isolated public store/sink and told consumer with the actual pre-011-14 fingerprint, then applying the current result, produced both `transition ["fail-changed"]` and `delta ["fail-changed"]` for each shape.

First, the scratch key can be all decimal digits. `daemonScratch` takes the first 16 hex characters of SHA-256 and does not require a letter. The old global hex rule deliberately keeps decimal runs, so this genuine old form never contains the `<hex>` token required by `MASKED_SQUEAL_SCRATCH`:

```text
raw:   open /tmp/squeal-1001/tmp/1234567890123456/work-abcdef/packages/cli.js
old:   Error: open <tmp>/tmp/1234567890123456/work-abcdef/packages/cli.js @ test/a.test.ts:42:7
fresh: Error: open <tmp>/packages/cli.js @ test/a.test.ts:42:7
sameFingerprint(old, fresh): false
```

This is possible under the real key generator, not an invalid key spelling. For example SHA-256 of repository id `00000000000000000000000000000911`, NUL, and root `/repo/demo` starts `8368996719379271` (found by 2,322 cheap hash attempts).

Second, a retained tail beginning `tmp/<hex>/<name>/...` is mistaken for another old scratch prefix. The rule is not idempotent, and applying it once to each side leaves the sides one normalization apart:

```text
raw: open /tmp/squeal-1001/tmp/6db45f9b91a3d272/work-abcdef/tmp/abcdef1234567890/named/a.js
old:   Error: open <tmp>/tmp/<hex>/work-abcdef/tmp/<hex>/named/a.js @ test/a.test.ts:42:7
fresh: Error: open <tmp>/tmp/<hex>/named/a.js @ test/a.test.ts:42:7

renormalize(old):   Error: open <tmp>/tmp/<hex>/named/a.js @ test/a.test.ts:42:7
renormalize(fresh): Error: open <tmp>/a.js @ test/a.test.ts:42:7
sameFingerprint(old, fresh): false
```

The notes honestly name the simple collision for `/tmp/<not squeal-N>/tmp/<16 hex>/<x>/...`: its `<x>` is discarded at comparison. That is not the whole cost. The second example is **inside Squeal's layout**, with a tail the new contract permits, and creates changed-failure noise rather than only collapsing two tails. The claim that every normalization rule maps its output to itself is false for this shape.

This is a continuation of B3's old/current compatibility requirement, exposed by the repair's new old-forms boundary; it is not a request to widen the fresh masking policy. **Fix scope:** cover every supported scratch-key spelling at the compatibility boundary, make comparison normalization stable for repeated old-shaped prefixes, and keep old/fresh forms of these identical failures equivalent. Add public sink/delta regressions for both examples. State the actual information loss of any ambiguous-prefix policy in the notes/contract, including collisions in a retained Squeal tail; preserve B1/B2's exact controls. One fingerprint-compatibility repair row can own this.

#### R2 — Proven: a stored consumer fingerprint is still compared raw in the waiting Stop hook

`src/harness/shared/stop-slow.ts:182`:

```ts
return view?.outcome !== "fail" || (view.fingerprint ?? "") !== f.fingerprint;
```

This reads `consumer_views.fingerprint` against the current known failure. The repair inventory covered core state/delivery and baseline findings, but missed this harness consumer. It violates repair item 2's **every comparison of a stored fingerprint** and C5's compare-under-current-rules contract.

Public-hook probe, independently for Claude Code and Codex, using `stop-slow-helpers`' real isolated fixture:

1. Enable `requireSlowSuite`, register the main consumer, make the fixture's edit and settle a slow failure with message `listen 127.0.0.1:35321`.
2. Give the consumer its already-told old-form view, `AssertionError: listen 127.0.0.1:35321 @ src/a.ts:3:5`. The current state has `:<port>`; `sameFingerprint` equates them.
3. Run the ordinary Stop entry and then the waiting entry. The ordinary entry is silent; the waiting entry returns `decision: "block"` with `1 check fails: test/e2e/slow.test.ts > ledger > posts`.
4. Start the next turn through `startTurn(store, consumer)` without re-registering/reseeding its view, and repeat the two Stops: the same block returns again in both harnesses, with no failure change.

The current delta correctly sees no notable difference and retains the old view as what was told (`planDelta`, lines 136-139), so this raw comparison can hold the agent on every subsequent Stop. This is current code, not an older daemon. The comparison itself predates this row, but removing rewriting and explicitly retaining stored old forms makes adapting this consumer part of B3's repair; it is not an unrelated audit finding.

**Fix scope:** use the shared normalized fingerprint comparison in `untold`, with both harnesses regressed for an old-form view and current-form state. Check a second turn without registration, and retain the existing genuinely changed-failure block control. No change to slow scheduling or policy is needed.

### Should-fix and nits

None newly filed. The shortcomings in the old-forms cost statement are part of R1's required compatibility decision, not a separate documentation nit.

### What fits / input to the coordinator

The move from global rewriting to comparison is sound for the checked ordinary forms and removes the original migration-marker race. `derive.ts`, `shown-result.ts`, `producers.ts`, `transitions.ts` and `delivery/delta.ts` use `sameFingerprint`; baseline lookup uses equivalent normalized set keys. The only remaining diagnostic comparison found by the repository-wide search is R2; raw equality in pytest adapter environment fingerprints concerns dependency/environment keys, not diagnostic fingerprints. Null checks and the equality fast path inside `sameFingerprint` are not omitted diagnostic comparisons.

The exact original B1/B2/S1/N1 cases need not be re-prosecuted. B3 is not fully closed until R1 and R2 are resolved or their changed contract is accepted through the coordinator's process. This is the requested one re-review round; the coordinator owns the next decision under the second-FAIL rule.
