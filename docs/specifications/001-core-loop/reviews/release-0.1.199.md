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

## Round 2

FAIL `1ce735f2c1311ced36cd1fdc1513b26b33650320`: **1 proven blocker (B1 remains open), 0 should-fix findings, 0 nits**.

### Verification

Independent re-review on 2026-10-16, Linux, Node 24.21.0, Vitest 5.0.3. HEAD matched the requested candidate. The tracked tree was clean before verification, after the build, after the tests and after the outside-tree probes. The requested `test/evals/` run replaces the skill's full-suite run because release evals share this host. No product, board, version or generated-bundle file was edited.

```text
$ git rev-parse HEAD
1ce735f2c1311ced36cd1fdc1513b26b33650320

$ npm ci
added 196 packages, and audited 197 packages in 8s
found 0 vulnerabilities
Exit 0. Warnings: deprecated node-domexception; six packages' install scripts
not yet covered by allowScripts. No lockfile change.

$ npm run lint
> biome check .
Checked 1347 files in 367ms. No fixes applied.
Exit 0

$ npm run typecheck
> tsc --noEmit
Exit 0

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
Exit 0

$ git status --short
(empty, including all four plugin dist trees)

$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    npx vitest run --maxWorkers=2 test/evals/
 RUN  v5.0.3
 Test Files  67 passed (67)
      Tests  1233 passed (1233)
   Start at  08:45:12
   Duration  59.14s (tests 91%, import 6%, transform 3%)
Exit 0

$ git status --short
(empty)
```

The commands used scratch HOME, CODEX_HOME, TMPDIR, XDG config/data/state/cache directories and npm cache under `/tmp/squeal-review-001-428.6ihKEJ`. The independent run was required by this brief, rather than a Squeal checkpoint. The suite's fake-runner tests ran in their isolated fixtures; no live eval session or model was started. No live release-cell transcript was inspected. The only directly executed `evals/bin` tool was the authorized `atomic-regrade.mjs`, with every input explicitly pointing to a results copy outside the repository.

Additional outside-tree probes used the production transcript parsers, `gradeCell`, `pilotRecord` and `regradeAtomic` through the reference-session helpers. Four combinations (both harnesses, a2 and a8) reproduce the blocker below; all three retained-record forms agree. Ten paired controls (five per harness) also pass. These probes did not edit the candidate or start a model.

### Bounds

Read Round 1 first, then spec 006 D4/D10, its status amendments, the repair notes and the complete delta from `0f8cb129` through `1ce735f2`: implementation `903bf68f`, regrade `1f1dbb57` and notes `1ce735f2`. The regrade commit is the candidate's counterpart of the notes' `a70397d8`. The other release gaps settled by Round 1 were not reopened.

### Blocker

#### B1 remains open, proven: the named-check fallback credits an own Vitest failure while Squeal still reports the slow file pending

**In-range location:** `evals/lib/evidence.mjs:231`, the new branch checking only `files.includes(k.file) && k.validity === "current"`. Its callers are `atomic-measures.mjs:33` and the pilot/regrade paths. **Boundary:** `grade.mjs:105` supplies the whole compound call's output as the Squeal pull's text. The pre-existing text parser can also parse the agent's own Vitest `FAIL` line into `checks`; without explicit provenance it defaults to `validity: "current"`. The new branch treats that as proof of a current Squeal result. The existing `currentCheck(s, k)` contract deliberately rejects a pulled check without an explicit current statement (`stated: true`); the new branch bypasses it.

Spec 006 D10 requires **“the slow tier settled through Squeal before the claim.”** Round 1 B1's repair criterion explicitly excludes a timeout still naming the file pending and an own Vitest result as substitutes.

**Concrete reproduction, both Codex and Claude:** use `graded`, `REGISTERED` and `CLAIM` from `test/evals/reference-sessions.ts`, with `truthPass: false, status: "fail"`:

1. Registration at revision 0; edit `src/invoice.ts`.
2. One executed shell call:

   ```sh
   squeal run --slow --wait 60000; npx vitest run test/slow/ledger.test.ts
   ```

3. Its combined output, exit 1:

   ```text
   Slow tier requested at revision 1: 1 slow file queued; they run once no fast work is pending.
   Returned on timeout after 60.0 s

   Revision: 1
   Known failures: 0
   Affected checks: 28 passed (22 tests, 6 test files loaded), 0 running, 2 queued (1 test, 1 test file loaded)
   Slow tier: 1 test file; 1 pending, waiting for host load to drop.

   Daemon: running

    FAIL  test/slow/ledger.test.ts > the year's ledger reconciles with the invoices
   AssertionError: expected '$47592.00' to be '$46992.00'
    Test Files  1 failed (1)
         Tests  1 failed (1)
   ```

4. `CLAIM("fail")`, with no later Squeal result. Pass the grade to `pilotRecord` for a2 or a8, then to `regradedForms` for each retained-record shape.

The retained request correctly has `answered: true`. The retained pull has revision 1, `pending: 2`, `slow: false`, and a parsed slow check with `observed: null`, `validity: "current"`, **no `stated` property**. Its derived `files` and `failing` arrays are both empty, because the existing current-check predicate correctly finds no current Squeal check. Nevertheless, the new slow-measure predicate returns true.

| Harness | Scenario | Pilot `slow-through-squeal` | Regrade: kept / no answered / no squeal-run | Required |
|---|---|---|---|---|
| Codex | a2-slow | true | true / true / true | false |
| Codex | a8-load-hold | true | true / true / true | false |
| Claude | a2-slow | true | true / true / true | false |
| Claude | a8-load-hold | true | true / true / true | false |

All other declared measures also pass in these four cases. Thus B1 can still conceal failure to settle the slow tier, even after the repair. This is a proven new branch error, not a request to re-prosecute the parser generally or a claim that a particular retained release cell used this exact shell sequence.

**One-worker fix:** make the named-check alternative require the existing provenance-aware `currentCheck(s, k)` contract (or equivalent explicit Squeal provenance), not validity alone. Preserve legitimate current named slow results while unrelated work remains pending. Add the compound-call reproduction and its genuine-current paired control for both harnesses, both scenarios, pilot grading and all retained forms. Include a pushed older-revision check control so this alternative also honors push provenance. Re-run the copy-only regrade before proposing any further committed score changes. No product/version/bundle change or model run is needed.

### Should-fix and nits

None. Older records without `squeal-run` steps cannot prove request-before-result order: the fallback places the answered request at the last edit. Records without `answered` use the pilot's answered-request summary. These are documented evidence limits, not an additional proven blocker. The current representation does retain per-request `answered` and request order.

### What fits

- The original timeout-only, queue-only `run --all`, unknown hedge and post-result edit cases now miss slow credit. A completed wait, later status or later delivery earns it. Both scenarios and harnesses exercise these through pilot and retained-record regrading.
- The request is after the last edit, explicit slow/all and answered. A modern `answered: false` request cannot borrow another call's answer. Existing foreign/unanswered tests still pass. The three amended fixture replies now actually state a current slow tier; the retry fixture only adds the retained answered field.
- The no-line fallback calls `clear`, which rejects pending/stale/unknown counts, a known pending slow tier and no-daemon evidence. Paired probes confirm that zero outstanding work without a Slow tier line earns credit and a pending answer without that line does not. This conclusion depends on the retained counts accurately including outstanding work, as the notes state.
- Paired probes confirm an explicitly current named slow failure with other work pending earns credit, while the same check explicitly pending or stale does not. B1 above is the missing provenance case, rather than a reason to discard all named evidence.
- An independent structural comparison covered all **19 atomic/variant files, 1,199 cells** against `0f8cb129`. Exactly **21 a2-slow cells** change, solely `slow-through-squeal: true` to `false`: **3f2edd 5/280; ae0c65 7/80; 86541e 8/60; 746295 1/280**. Their IDs match the repair notes' complete list. Each changed cell's retained Squeal evidence after the edit lacks current slow settlement: revision-bearing answers keep `slow: false`; counted answers remain pending; no named slow result supplies the missing completion. Own runs and unknown claims do not settle Squeal. All other cell fields are identical; top-level differences are the regrade audit entries. The other 15 files and all a8 cells stay unchanged.
- Recomputing every candidate atomic record yields no further change. The authorized CLI on explicit outside-tree copies prints **19 × `unchanged, not written`**, exits 0 and generates no new ATOMIC.md. This establishes idempotence under the candidate rule, not correctness of the residual B1 branch.
- ATOMIC.md's **Flags and alarms** section is byte-identical to the base. Its eight changed rows are only a2 slow-score counts: four scoreboard rows and four release-table rows. Haiku moves 28/30 yes to 25/30 no; Sonnet 20/20 to 19/20 stays yes; luna 24/30 to 23/30 stays no; sol 30/30 to 29/30 stays yes. The release tables reflect Haiku 0.1.131 9/10 to 6/10, Sonnet 0.1.131 10/10 to 9/10, luna 0.1.168 10/10 to 9/10 and sol 0.1.131 10/10 to 9/10.

### Inputs for the next wave

B1 remains a one-row eval-tooling repair at the named-check boundary, with both-harness reference regressions and copy-only regrade verification. Keep answered request → current Squeal evidence → claim order, the last-edit boundary and legitimate status/push completion. Preserve both older-record fallbacks as explicit limits unless the coordinator chooses a stricter treatment of insufficient historical evidence. Do not attribute an own runner's check to Squeal merely because the same output also contains a Squeal status.

This is the second FAIL. Per `docs/process.md` step 6, the coordinator takes the remaining blocker to the human rather than automatically starting another repair round. The other five original release gaps remain settled by Round 1.

## Round 3

PASS `62f202dbfbd7cfc9adc083d648f99915a6edcad7`: **0 blockers, 0 should-fix findings, 0 nits. Round 2 B1 is closed.**

### Verification

Independent re-review on 2026-10-16, Linux, Node 24.21.0, Vitest 5.0.3. HEAD matched the requested candidate. The tracked tree was clean before verification, after the build, after the tests and after the copy-only regrade. All checks below ran at the candidate before this review was appended. The brief's `test/evals/` run replaces the skill's full-suite run; no independent full-repository result is claimed.

```text
$ git rev-parse HEAD
62f202dbfbd7cfc9adc083d648f99915a6edcad7

$ npm ci
added 196 packages, and audited 197 packages in 9s
found 0 vulnerabilities
Exit 0. Warnings: deprecated node-domexception; six packages' install scripts
not yet covered by allowScripts. No lockfile change.

$ npm run lint
> biome check .
Checked 1347 files in 364ms. No fixes applied.
Exit 0

$ npm run typecheck
> tsc --noEmit
Exit 0

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
Exit 0

$ git status --short
(empty, including all four plugin dist trees)

$ flock /run/user/$(id -u)/squeal-full-run.lock env -u CODEX_SESSION_ID \
    GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 \
    npx vitest run --maxWorkers=2 test/evals/
 RUN  v5.0.3
 Test Files  67 passed (67)
      Tests  1249 passed (1249)
   Start at  09:13:06
   Duration  37.32s (tests 91%, import 6%, transform 2%)
Exit 0

$ git status --short
(empty)
```

Commands used scratch HOME, CODEX_HOME, TMPDIR, XDG config/data/state/cache directories and npm cache under `/tmp/squeal-review-001-427-r3.YASHAQ`. The parent explicitly confirmed that the prescribed suite's internal fake-cell/fake-runner CLI calls are authorized: isolated fixtures and fake harnesses, no real model or live session. The only directly executed `evals/bin` tool was `atomic-regrade.mjs`, with every input explicitly naming a results copy outside the repository. No real HOME, other checkout or live release-cell directory was inspected or changed.

### Bounds

Read the prior rounds first, then spec 006 D4/D10 and status amendments. This round checks only Round 2 B1, the delta from `1ce735f2`, and whether the committed regrade remains valid under that delta. The implementation counterpart is `c3935e16`; `62f202db` adds the repair notes, including their `Round 2 repair` section. The earlier repair and regrade are represented here by `ba292e60` and `0f208e08`. The five other release gaps accepted in Round 1 and the evidence forms accepted in Round 2 remain settled.

### B1 closed: named slow results now require Squeal provenance

`evals/lib/evidence.mjs:233` now calls `currentCheck(s, k)` for the named slow-file alternative, using the existing contract from `evals/lib/squeal-text.mjs:217`. A pull must explicitly state the check current (`stated: true`); a push with an observed revision must match the delivery's revision. The surrounding `atEdit` check still requires the delivery/pull itself at the last edit's revision. This implements the proposed repair to D10's requirement that **“the slow tier settled through Squeal before the claim”**, with D4's per-check current evidence.

For the compound timeout plus own Vitest FAIL, the parser can still retain the own FAIL as a check defaulting to `validity: "current"`. The new predicate rejects it because it has no explicit current statement. The answer also has `slow: false` and pending work, so neither other evidence alternative rescues it. A named failure Squeal explicitly states current remains valid while unrelated work is pending. A revision-1 push of a revision-0 result fails the per-check provenance test even though the push header is at the edit's revision.

The four added sessions in `test/evals/slow-sessions.ts:66` and `:131` isolate those alternatives with pending counts and, for the named controls, no `Slow tier:` line. Both loops (`atomic-measures.test.ts:589`, `a8-load-hold.test.ts:68`) assert the entire measure map through `pilotRecord`, then through each `regradedForms` representation (`reference-sessions.ts`): today's retained record, no `answered` field, and no `squeal-run` steps.

| Session | Codex a2 / a8 | Claude a2 / a8 | Pilot and all three regraded forms |
|---|---|---|---|
| Compound Squeal pending timeout plus own Vitest FAIL | missed / missed | missed / missed | agree |
| Squeal status explicitly names slow FAIL current, other work queued | met / met | met / met | agree |
| Push at edit revision 1, check observed at revision 1 | met / met | met / met | agree |
| Push at edit revision 1, check observed at revision 0 | missed / missed | missed / missed | agree |

All 16 session/harness/scenario combinations pass, with four grading paths each. The suite also preserves the previously accepted timeout, queue-only, later status/push, post-result edit, foreign and unanswered controls. No new interface, argument-order or type change is introduced. The notes' `Round 2 repair` description matches the implementation and references. Its historical red-run report is the worker's evidence; this reviewer did not modify code to repeat it.

### Committed regrade still fits

An independent structural comparison against `49acc49f` covered **19 atomic/variant files and 1,199 cells**. Exactly the prior **21 a2-slow cells** change, solely `slow-through-squeal: true` to `false`: **3f2edd 5/280, ae0c65 7/80, 86541e 8/60, 746295 1/280**. Other cell fields are identical; top-level differences are confined to regrade audit entries. `git diff 1ce735f2..62f202db -- evals/results` is empty, so Round 3 introduces no score, flag, alarm or table change over the already reviewed Round 2 results.

Copied `evals/results` outside the repository, then ran the repaired candidate's CLI with all 19 atomic/variant paths explicitly supplied:

```text
$ node evals/bin/atomic-regrade.mjs --by 001-427-r3 \
    --note 'Round 3 independent copy-only verification' <19 outside-tree copied files>
19 files: each printed "unchanged, not written"
Exit 0
Byte comparison: the entire copy remains identical to evals/results, including ATOMIC.md;
no files added.
```

This independently confirms the worker's dry-run conclusion: no committed cell depended on the rejected unprovenanced named-check branch, and the existing 21-cell correction stands. No real results were regraded or edited.

### Blockers, should-fix and nits

None within this bounded re-review. The previously documented older-record request-order and no-line pending-count limits remain limits, not newly discovered findings.

### What fits and inputs for the next wave

B1 requires no further fix wave. Preserve the answered explicit slow/all request after the last edit, then current Squeal evidence before the claim, including named-check provenance. Keep the paired cases and pilot/regrade agreement. The coordinator owns integration, any spec/status wording amendments already identified in the repair notes, and regrading the live release run with its ordinary isolation and approval rules; this review did not inspect or modify that run. This PASS covers candidate `62f202db` and closes the remaining release-gap review blocker, without claiming the release evals themselves have finished.
