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
