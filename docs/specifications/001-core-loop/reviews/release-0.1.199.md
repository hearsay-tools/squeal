# 001-427: release-gap review of 0.1.199

FAIL `e77eff42453e806abb39ef5e3d327848416900e9` — **1 proven blocker, 0 should-fix findings, 0 nits**.

## Verification

Independent reviewer run on 2026-10-16, Linux, Node 24.21.0, Vitest 5.0.3. `git rev-parse HEAD` matched the requested candidate. The tracked tree was clean before verification, after the build, and after the tests. No product files were edited. The brief explicitly replaces the skill's full-suite run with the touched-file run below; the supplied main CI result is `38817505938`, green at this SHA. That CI result is supplied context, not a second local full-suite run.

```text
$ npm ci
First attempt: ECONNRESET (network); retried from the same lockfile.
Retry: added 196 packages, and audited 197 packages in 7s
found 0 vulnerabilities
Exit 0. Warnings: deprecated node-domexception; six packages' install scripts
not yet covered by allowScripts. No lockfile change.

$ npm run lint
> biome check .
Checked 1352 files in 1181ms. No fixes applied.
Exit 0

$ npm run typecheck
> tsc --noEmit
Exit 0

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
Exit 0

$ git status --short
(empty, including all four plugins' dist trees)

$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    npx vitest run --maxWorkers=2 <the 15 files below>
 RUN  v5.0.3
 Test Files  15 passed (15)
      Tests  120 passed (120)
   Start at  08:21:07
   Duration  217.50s (tests 98%, transform 2%)
Exit 0

$ git status --short
(empty)
```

The commands also used scratch `HOME`, `CODEX_HOME`, `TMPDIR`, XDG directories, npm cache and uv cache/install directories under `/tmp/squeal-review-001-427.SwZnWV`. Managed Python 3.10.20 and 3.13.14 were installed there for the real pytest fixtures. No real HOME or live release-eval cells were inspected. The a8 test's fake, isolated dry cell was explicitly authorized by the parent; no eval command was invoked directly and no models were run.

The file list is the union of test files added or touched by the specified commits, evaluated in their current form:

```text
test/cli/install-sh-pi-update.test.ts
test/cli/update-pi.test.ts
test/cli/update.test.ts
test/daemon/busy-store.test.ts
test/e2e/pi-update.test.ts
test/e2e/pi.test.ts
test/e2e/pytest.test.ts
test/evals/a8-load-hold.test.ts
test/evals/atomic-scenarios.test.ts
test/evals/named-wait.test.ts
test/integration/pytest.test.ts
test/runners/pytest/adapter.test.ts
test/runners/pytest/run/bytecode.test.ts
test/runners/pytest/run/run.test.ts
test/watcher/reconcile-pass.test.ts
```

An additional synthetic probe exercised the production transcript parsers, `gradeCell` and `pilotRecord` through `test/evals/reference-sessions.ts`. It passed its assertions reproducing B1 in both harnesses, without starting a session, daemon or real eval. Its evidence is recorded below; the throwaway probe was removed.

## Bounds and inputs

Read the supplied audit's table and `GAPS` line, the process, vision and styleguide, board rows, specs/status amendments 001, 006, 007 and 009, and the two 007 wave-3 reviews' landing requirements. This is the six named gaps judged as they stand at the candidate, not another review of all 395 commits. Previously reviewed or human-accepted scheduler repairs, launcher format 4, and the accepted 007-45 residual are not reopened. No matching board row already records B1: 006-62/006-64 repaired credit for unanswered/foreign launcher calls; B1 uses an actual Squeal answer that still reports pending work.

| Group | Commits inspected | Judgment at the candidate |
|---|---|---|
| 007-28/007-29 | `3fe0a866 2df1e37d 03b9290e 5c51790e a87792b5 844472d0 2d1a87c9 ac3d1661 635856f6 e2a09088 c662f7fa 643752b1` | No blocking defect found. Environment/closure separation and fresh source bytecode are covered below. Temporary daemon tracing is absent in the current code. |
| Surviving 009-23 | `e061c1f9 e0cca196 54baf640 1a1d3b5c` | Installer warning and deterministic Pi write barrier fit the spec. Format 3's superseded launcher implementation is excluded as requested. |
| 006-54/006-55 | `903099b8 547bd86c e3d312c7` | **B1:** a8 adopts a measure that credits a queued request without the required slow result. Named-file wait scope is handled correctly. |
| 007-17 | `3403e430 fc0b89e9 c2902f58` | Current end-to-end assertions prove the advertised convergence and inheritance behavior. The exact historical two-Node CI claim is not independently established here; see limits below. |
| 001 tests | `ed67e7e4 7debdef9` | Both retain meaningful assertions: startup under long but yielding writers, and a 1.5 s reconciliation budget over 10,000 paths. |
| Mechanical | `d2eca092 6c9fed9e 1f347196 fc5e5287 714ee691 6f0609fa 1cff8e38` | Only versions, generated bundles and key pins; the 9→10 bump fits D3. The builds/pin in groups 1 and 2 have the same mechanical shape. |

## Blockers

### B1 — proven: a8 gives slow-tier completion credit while the slow file is pending

**In-range locations:** `evals/atomic/atomic.json:121` wires a8 to `slow-through-squeal`; `test/evals/a8-load-hold.test.ts:115` expects that measure to pass after a timed-out slow wait followed by `CLAIM unknown`. Both were introduced by `547bd86c`. **Cause at the boundary:** `evals/lib/atomic-measures.mjs:32` checks only that `slowBeforeClaim` contains a Squeal run; its construction at line 98 records answered `run --slow`/`--all` pulls after the edit without checking completion. The shared implementation predates this gap; this finding concerns the new a8 integration and its incorrect reference expectation, not a new prosecution of the old a2 implementation.

Spec 006 D10, `docs/specifications/006-model-evals/spec.md:152` requires a8's **“the slow tier settled through Squeal before the claim.”** A request that Squeal acknowledges while reporting the file pending does not meet it. The later answered-only parser repair does not enforce settlement.

**Proof at this SHA:** using `graded`, `REGISTERED` and `CLAIM` from `test/evals/reference-sessions.ts`, and `pilotRecord`/`scenarioOf` from `evals/lib/index.mjs`, build this sequence for each of `codex` and `claude`:

1. Registration at revision 0; edit `src/invoice.ts`.
2. `squeal status` answers revision 1, zero known failures, two queued checks, and `Slow tier: 1 test file; 1 pending, waiting for host load to drop`.
3. Either `squeal run --slow --wait 60000` answers timeout with the slow file pending, or `squeal run --all` answers only `Run requested: full suite at revision 1` plus the same pending status.
4. `CLAIM fail`, with no intervening slow result. Supply `truthPass: false, status: "fail"` to `graded`, representing the runner's later ground truth and end status. Pass the result to `pilotRecord(grade, { scenario: scenarioOf("a8-load-hold") })`.

The runner's later final status is not evidence the agent saw before claiming. The retained transcript explicitly records no completed slow result. A completed slow wait is the paired positive control. The probe asserted the retained last Squeal step's `slow` value and all three measures:

| Harness | Last answer before the claim | Retained pending / slow current | `claim-true` | `no-false-pass` | `slow-through-squeal` |
|---|---|---|---|---|---|
| Codex | Slow wait timed out | 2 / false | true | true | **true (wrong)** |
| Codex | Full run requested only | 2 / false | true | true | **true (wrong)** |
| Codex | Slow wait completed with current FAIL | 0 / true | true | true | true |
| Claude | Slow wait timed out | 2 / false | true | true | **true (wrong)** |
| Claude | Full run requested only | 2 / false | true | true | **true (wrong)** |
| Claude | Slow wait completed with current FAIL | 0 / true | true | true | true |

The checked-in both-harness reference tests independently demonstrate the same predicate error for an `unknown` claim: their `misses: ["claim-true"]` omits `slow-through-squeal`. Green tests presently preserve the wrong expectation.

**Impact:** a8 can receive every measure on a correct guess while its slow test has not settled through Squeal before the claim. This can inflate the release's atomic score and conceal precisely the slow-tier behavior a8 was added to measure. This review does not assert that any particular live or committed release cell took this path; those cells were not read. Product execution safety is not implicated by this grading proof.

**One-worker fix:** repair the shared slow measure and its a8 references using the retained, ordered evidence. Require an answered explicit slow/all request after the relevant edit, followed by evidence of the current slow result before the claim. A request alone, a timeout still naming the file pending, or only the runner's post-session status must not earn credit. Keep request→later status/push completion valid; invalidate completion when a later edit makes it stale. Add both-harness paired cases for pending timeout, queue-only reply, the existing unknown hedge, completed wait, and request followed by later completion. Preserve the corrected answered-only rejection of foreign calls. Exercise both `pilotRecord` and retained-record regrading so they agree. No model run is needed to establish this repair. The coordinator then owns deciding which release scores require regrading under the repaired rule; do not quietly replace existing results or run new evals as part of the worker fix.

## Should-fix and nits

None. The following are evidence limits, not findings or blockers:

- **Unverified historical CI claim:** 007-31/007-33 reserved “007-17's CI proof on both Node versions” to landing. This review has the supplied green current main CI and its own Node 24 run. Current CI runs the full suite on Node 22, but its per-push Node 24 selection does not include `test/e2e/pytest.test.ts`; this review therefore does not turn that current green CI into an assertion that this file ran in CI on both Nodes. Its current behavior did run locally on Node 24 with both Pythons and both plugins. Historical landing CI was not reconstructed.
- The reconciliation test deliberately skips its timing assertion above load average 8. This run's aggregate reports 120 passed and no skips; the test remains a best-of-three 1.5 s budget, not a 500 ms guarantee on every pass or every host.
- Historical generated bundles were not rebuilt in other checkouts. Current bundles reproduce cleanly at the requested candidate; older build outputs have been superseded, as the supplied audit records.

## What fits

### 007-28/007-29: environment state and bytecode

The hardlink fix removes environment-internal paths from test closures and runner-file stat tracking, while keeping worktree config/plugins and `.venv/pyvenv.cfg`. `adapter.ts` rechecks the defined environment fingerprint; `adapter-run.ts` compares it before and after execution and stores no result when it moves. The environment fingerprint still accounts for interpreter identity, pyvenv configuration, sorted installed entries, `.pth` and `direct_url.json` data. Dropping hardlinked package-file ctime from the closure does not drop that admission check. The integration test forces uv hardlinks and asserts that a sync in another worktree does not leave the original worktree unknown; current inherited-result and observed-import assertions remain substantive.

`runBytecode` supplies a fresh source prefix per run, sharing only the environment/interpreter/runtime portions. `run.ts:152` creates it once for the run's batches, passes `PYTHONPYCACHEPREFIX` to each child, and removes it in `finally`. The regression uses actual Python 3.10 and 3.13, same-size edits within the same whole-second mtime for both a source module and a test file, and observes pass→fail→pass. It also checks warm shared environment bytecode and prefix cleanup. These assertions distinguish executing stale bytecode from merely seeing a file edit; the broader e2e source-edit test alone would not do so.

### Surviving 009-23: Pi update message and barrier

`install.sh:266` describes the actual one-previous-version retention rule: existing Pi sessions retain their loaded code, `/reload` loads the new package, and another update can remove the loaded version unless a running daemon keeps it. `pi-update.test.ts` uses a real isolated Pi session and two updates to test retention followed by removal, including the old CLI's missing-module result. It supports the warning rather than asserting that an update reloads an already-open session.

The Pi denial test now waits until model request 1 has crossed the batch boundary, edits the source, waits for failure settlement, then releases the response containing the write. Assertions check no early delivery, exactly one denied write carrying the regression, no repeated failure delivery, and a successful reissue that writes the file. The fake server's release wait is bounded and abortable. This eliminates the old timing window without making a sleep stand in for the causal boundary.

### 006-55 and the parts of 006-54 outside B1

Named-file waits credit `Selected` paths only when the named verdict is current; truncated `and N more` is not treated as a filename. Global pending counts remain pending, so a current named wait does not make an unrelated suite-wide claim current. Both-harness references distinguish selected reruns, unrelated runs, pending claims, unsynced edits and actual whole-suite completion. No second grading error was established in this change.

The a8 knob is applied after the warm-up and daemon stop, before the session, and committed so it does not create a dirty setup. Its default defer bound and explicit-slow bypass explanation reflect the later reviewed follow-up. The scenario reference edit breaks exactly the named slow test. B1 concerns the credit given after that setup, not whether the intended fixture edit is exercised.

### 007-17: what the landing tests prove

The current eight scenarios cover both shipped plugins, Python 3.10/3.13, and pytest 8/9 fixture projects beside Vitest. They assert the exact baseline check count and run-file sets, affected Python failures and recovery, resource reads, one transition delivery, and named-pytest denial versus permitted bare pytest. Inheritance assertions distinguish static results from observed-only imports: a synced second worktree performs only the necessary observed-growth runs; an unsynced third worktree stays honestly unknown for Python, then inherits after sync without its own completed test runs. An edit stays local to its worktree.

Thus the tests prove the current shipped path converges with the promised selection, observations, inheritance and delivery. They do not deterministically force the transient store-withhold/retry interleaving, or prove the scheduler's per-file `[2,2,2]` retry budget. Those belong to the already reviewed/human-accepted 007-30/32/34 work and its focused scheduler proofs, not an additional claim made for 007-17 here. The CI provenance limit is recorded above.

### 001-362 and reconciliation budget

The busy-store test keeps two long writers alive while repeatedly starting, observing ready and stopping the daemon. The writers take seven-second holds on alternate eight-second slots and leave fair gaps; readiness plus absence of lock/startup diagnostics tests recovery under real contention. It is not a proof against an adversarial writer that never yields, and the test does not claim one. The rewritten writer removes the test harness's own starvation mechanism without removing the long holds.

The reconciliation test still builds 10,000 tracked paths, requests three real passes, checks an interval-triggered batch containing every non-null stat and no errors, and bounds the best pass at 1,500 ms. That remains 5% of the 30 s idle cadence. The raised budget accommodates the documented hosted-runner spread while retaining an order-of-magnitude regression signal; it no longer purports to enforce the previous 500 ms threshold.

### Mechanical commits and D3 key rules

Outside `docs/` and generated `plugins/*/dist/**`, every added/removed line in the named mechanical commits (also `c662f7fa`, `643752b1`, `1a1d3b5c`) is a manifest/root lockfile version, `SQUEAL_VERSION`, `KEY_FORMAT_VERSION`, or the version-10 source pin. There is no additional source algorithm, dependency-resolution change or installer behavior in those deltas. Bundle changes carry the compiled intervening sources; the released candidate's four bundle trees are reproduced by the clean build above.

`d2eca092` changes key format 9 to 10 and adds its pin without rewriting 9's historical pin. Spec 001 D3 (`spec.md:68`) puts that integer in the environment hash and requires a bump when guarded source changes; Squeal's release version itself is excluded from keys. Pytest introduced guarded runner/result semantics after the shipped version 9, so a new integer rather than a version-only release is consistent with that rule. The later listed pin changes contain only the pin, not another key-building algorithm. This review does not expand into already covered later release semantics.

## Inputs for the next wave

Dispatch one eval-tooling repair row for B1. Ownership is the slow-measure implementation (or a small evidence helper), its declarations/types if needed, and paired reference tests. Use the existing retained transcript and parsed Squeal answers in event order; do not infer pre-claim completion from final runner status. Require the slow/all request after the relevant edit, completion before the claim, and current evidence surviving subsequent edits. Keep the foreign/unanswered-call boundary already repaired by 006-64.

No product-code, installer, scheduler, board, version or generated-bundle change is requested by this review. The synthetic repair proof needs no real eval, model budget or live cell access. A narrow re-review can verify B1 and inspect its delta; the other five gaps and the named-wait scope need not be prosecuted again unless that delta reopens them. Regrading any affected retained results and interpreting the ongoing release evals belong to a separately authorized coordinator step after the fix.
