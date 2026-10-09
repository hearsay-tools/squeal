# Wave 13 sixth review: the completion barrier and optimizer starts

FAIL 4941c15

Two proven blockers (remaining B3 and new B4), one proven should-fix note (S1, pre-existing), two proven nits (N1, N2). Prior wave-13e B1 and B2 are closed. The root-project restart regression is repaired, but a separately configured project still reuses transient optimizer output. Even the root optimizer can build before the first key snapshot and keep bytes that snapshot never saw.

Reviewed `9d0ea80..4941c15`, from the 0.1.64 landing to the exact 0.1.69 bundle landing. The assigned branch starts at `431bc7e`, one documentation commit later. All candidate verification and probes ran detached at `4941c15b0bad7afef565e04dd7492d4709abb2c1` with a clean tracked tree. Returned to the assigned branch only to commit this report. Read wave-13, wave-13b, wave-13c, wave-13d, wave-13e and tasks 001-159/001-168. Other coordinators' work is considered only at the touch, keying and slow-instance seams. This is not a new review of their other rows.

## Verification

Node 24.21.0, Linux, Vitest 5.0.3, Vite 8.3.2. The repository and reviewer skill require the build and direct full gate; the implementation no-build instruction does not waive that reviewer gate. One full gate only, at most four outer workers. Both regenerated plugin bundles stayed byte-identical.

```text
$ git rev-parse HEAD
4941c15b0bad7afef565e04dd7492d4709abb2c1

$ npm ci
added 56 packages, and audited 57 packages in 3s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.69 lint
> biome check .
Checked 670 files in 466ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.69 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.69 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.69 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
$ git status --short
(no output)

$ npx vitest run --maxWorkers=4
FAIL test/daemon/handover.test.ts
  a 0.1.32 daemon, a current hook, then a released 0.1.31 hook: a current daemon serves
  expected [ 'alive' ] to deeply equal [ 'spawned' ]
  test/daemon/handover.test.ts:72:23
FAIL test/harness/attribution.test.ts
  returns on the heartbeat, before the start scan
  expected 423.61735299999964 to be less than 400
  test/harness/attribution.test.ts:147:21
FAIL test/harness/bundles.test.ts
  start a daemon, keep serving deltas from the store, and never stall
  ENOENT opening the replacement fixture CLI's 'ran' marker
  test/harness/bundles.test.ts:254:47
FAIL test/scheduler/backlog-tiers.test.ts
  cancels a backlog tier for an edit, keeps its completed files and runs the edit in the next small tier
  expected cancelled.files to have length 200, got 194
  test/scheduler/backlog-tiers.test.ts:133:31
FAIL test/scheduler/observed-growth.test.ts
  the timer re-keys both files on preload growth after B started
  expected control.test.mjs and hidden.test.mjs once each, got both twice
  test/scheduler/observed-growth.test.ts:282:7
Test Files  5 failed | 288 passed | 1 skipped (294)
     Tests  5 failed | 2203 passed | 10 skipped (2218)
Start at 17:20:34 (Europe/Warsaw)
Duration 1190.00s
(exit 1)

$ npx vitest run test/scheduler/observed-growth.test.ts test/harness/attribution.test.ts test/harness/bundles.test.ts test/scheduler/backlog-tiers.test.ts test/daemon/handover.test.ts -t 'the timer re-keys both files on preload growth after B started|returns on the heartbeat, before the start scan|start a daemon, keep serving deltas from the store, and never stall|cancels a backlog tier for an edit|a 0.1.32 daemon, a current hook, then a released 0.1.31 hook' --maxWorkers=1
Test Files  5 passed (5)
     Tests  5 passed | 52 skipped (57)
Start at 17:40:40 (Europe/Warsaw)
Duration 78.40s
(exit 0)
```

The full gate is not green. Every failed case passed its required isolated repeat, with files running sequentially under one worker. These gate results do not prove additional breaks of the bounded repair. The backlog's summed-duration budget already permits selecting fewer than 200 files under load; its review-wave-13e counterpart failed similarly. The attribution assertion exceeds its wall-clock bound by 24 ms. No source repair was attempted for these failures. The gate passed the changed touched-cache, stamp, own-write, late-touch, restart and no-relist regressions. It printed two fixture gitdir-repair notices and one earlier-run process-cleanup notice; no global-teardown failure.

Install warned that esbuild and @parcel/watcher install scripts were not allowlisted; subsequent checks completed. Background Squeal is separate evidence: its 0.1.62 daemon reported a completed checkpoint at revision 2 with 20 known failures, largely timing/readiness/observed-growth cases. The direct candidate gate passed its other files. No green background checkpoint is claimed.

External probes used this checkout's `node_modules/.bin/vitest run --root <scratch> --config <scratch>/<config> --maxWorkers=1`. Fixtures, helper copies, stores, caches, counterfactual sources and logs were outside the repository. External adapters were capped at one worker. Probe summaries:

```text
Candidate replay of wave-13e B1/B2/B3, with fresh controls:
  Test Files 3 passed; Tests 12 passed; Duration 100.95s; exit 0
Same three observed regressions against copied src at 9d0ea80:
  Test Files 3 failed; Tests 3 failed | 9 skipped; Duration 81.75s; exit 1
  B1 CSS: current PASS; B2 virtual: current PASS after late batch;
  B3 root restart: fresh adapter with stale cache PASS
Separate-project restart proof, asserting the bad state and uncached control:
  Test Files 1 passed; Tests 2 passed; Duration 19.51s; exit 0
Root pre-scan startup proof, asserting the bad state and fresh control:
  Test Files 1 passed; Tests 2 passed; Duration 16.83s; exit 0
Real-daemon pre-scan startup proof, asserting the bad state and fresh control:
  Test Files 1 passed; Tests 2 passed; Duration 26.59s; exit 0
Ordinary alias-input edit, expecting agreement with fresh disk:
  Test Files 1 failed; Tests 2 failed; Duration 22.48s; exit 1
Same ordinary edit at copied 9d0ea80, asserting the pre-existing bad state:
  Test Files 1 passed; Tests 2 passed; Duration 14.51s; exit 0
```

The proof tests for B3/B4 deliberately assert the false PASS and the failing disk control. Their green result proves the counterexample, not correctness. An early external CSS copy had a fixture import incorrectly rebased to an absolute path; it was corrected before the final 12-case replay. An early daemon probe attempted to read a key field from `KnownState`; the final proof checks `validity: current` and the PASS in `results.byKey` for the current test-file key instead. Those scratch mistakes are not product findings.

## Blockers

Both findings break vision principle 2 and spec goal 3, “Everything the agent is told is true at the moment it is told.” D5 says a result is stored only under a key whose inputs were stable for the whole run. Here declared source inputs are stable during the recorded runs, but the cached executable bundle holds other bytes. Neither missing declaration nor a coarse timestamp is the explanation.

### B3, proven, partially open: the force option does not reach a file-based project's optimizer

`src/runners/vitest/adapter.ts:160`, `src/runners/vitest/adapter.ts:163`.

D4's new contract is “every Vitest instance start, fast and slow, initial and replacement, passes Vite's inline forceOptimizeDeps and rebuilds the bundles from the disk; no start trusts a bundle it did not build.” The option repairs the root server but is not a CLI override applying to every project.

Minimal supported fixture: the root config lists `test.projects: ["./vitest.p.config.ts"]`. That file defines project `p`, aliases `local-pkg` to `src/mod.js`, and enables `test.deps.optimizer.ssr` and `.client` with `include: ["local-pkg"]`. The test imports `which` from `local-pkg` and expects `"new"`. Policy explicitly declares `inputs: ["src/mod.js"]`; restored disk exports `"old"`.

Independent proof, observation on and off:

1. Create the fixture on OLD. Write NEW, create the real adapter, run project p's test and assert PASS. Close it, leaving its optimizer cache.
2. Restore OLD before creating any receiving adapter or scheduler.
3. A new adapter, with the candidate's force option, still reports PASS.
4. A new scheduler on OLD stores current PASS. Force its full-suite checkpoint; it executes again and still stores current PASS.
5. Close it, delete only this fixture's `node_modules/.vite`, then create another adapter on unchanged OLD. It reports FAIL.

```text
observe=true and observe=false, project p:
  new adapter, optimizer cache kept: PASS
  scheduler baseline: current PASS
  forced checkpoint: current PASS
  new adapter, optimizer cache removed: FAIL
```

Source corroboration in installed Vitest 5.0.3: `resolveSingleProjectEntry` constructs a file-based project's own `projectInline`. It calls `inheritRootViteOverrides` only for an inline entry inheriting the root. A project supplied by its config file therefore does not inherit this third-argument `forceOptimizeDeps`. Inspecting root-option propagation alone would miss this distinction.

Fix sized for one worker: enforce rebuilding or verified optimizer-source evidence for every project server/environment, including file-based configs, before it can execute an inherited bundle. Verify the actual effective project optimizer option or removal/rebuild, not merely the createVitest argument. Add this separate-config restart and forced-checkpoint regression with both observation settings and an uncached control; extend it through the slow-instance factory. Preserve the passing root-project restart test.

### B4, proven: an optimizer build before the first key scan escapes the completion barrier

`src/runners/vitest/adapter.ts:169`, `src/core/daemon/daemon.ts:356`, `src/core/scheduler/scheduler.ts:149`, `src/core/scheduler/stability.ts:44`.

This is a remaining gap of the new initial-start guarantee and the completion barrier, under 001-169's explicit question about any current result executing bytes other than its key. Rebuilding on startup reads the disk at startup, not necessarily the disk the subsequent key names. The first stat snapshot can be taken after the restore, so neither its barrier nor a later ordinary batch sees a touch.

Independent root-project scheduler proof, observation on and off:

1. Start the real adapter with the aliased declared `src/mod.js` on NEW. Wait until its optimizer output on disk contains NEW; no test warm-up is needed.
2. Restore OLD before `scheduler.start()` and its first stat-cache seed.
3. Let baseline key and execute the test. It stores current PASS under the restored source key. A fresh adapter on OLD reports FAIL.

Confirmed through the real `startDaemon`, not only the eager test harness. A scratch-only git wrapper pauses the scheduler's first `git rev-parse --show-object-format` before delegating to the real git. At that boundary the wrapper waits for this fixture's NEW optimizer output, restores OLD once, and returns. It changes no git result. The daemon has already opened its Vitest runner (`daemon.ts:356`) but has not scanned keys. Its ordinary baseline and watcher then run.

```text
real daemon, observe=true and observe=false:
  stored test outcome: PASS
  stored validity: current
  results.byKey(current test-file key): PASS
  fresh adapter on the same restored disk: FAIL
```

The final daemon proof starts and stops two owned daemons in isolated fixture repositories. Their stores are separate from this worktree's. A preceding eager-harness probe initially enabled observation only after adapter creation, which caused an extra recreation and hid the observed case. Its corrected constant startup setting matches the daemon, whose policy is already loaded when it opens the adapter; the real-daemon proof confirms both modes.

Source ordering supports the experiment: the daemon explicitly awaits `vitestRunner.open()` before making its loop; scheduler scan seeds hashes before baseline; the change feed starts after scheduler start (`src/core/daemon-loop/index.ts:55`). A completed NEW optimizer build followed by OLD before the seed is invisible to that first OLD snapshot. This is not the previously accepted interval between SourceStamps' source read and Vite's separate read: no source changes during either recorded test run.

Fix sized for one worker: extend startup/build validity to cover bytes read before the first key snapshot. Establish keyed source evidence before creating project-derived optimizer state, or persist/check the optimizer's consumed input hashes and withhold/rebuild when they differ from the selected key. Moving the run-completion stat check alone cannot detect a write before its snapshot. Add the controlled startup boundary as a daemon regression, both observation settings, with a fresh failing control. Do not mark this path closed solely because every instance receives forceOptimizeDeps.

## Should-fix

### S1, proven, pre-existing: an ordinary source edit also keeps the root alias optimizer's old bytes

`src/runners/vitest/adapter.ts:260`, `src/runners/vitest/adapter.ts:268`.

With the same root-project alias fixture and declared source, run baseline on NEW and get current PASS. Write OLD once and send its normal watch batch. The revision and key change; the next scheduled run still stores current PASS, observation on and off. A fresh candidate adapter on OLD fails. The normal `change` invalidates source modules without replacing the optimizer, whose bundled source is not independently checked.

```text
candidate, observe=true and observe=false:
  before edit: NEW current PASS
  after ordinary NEW -> OLD content revision: OLD current PASS
  fresh candidate adapter on OLD: FAIL
copied 9d0ea80, both modes:
  after the same ordinary edit: current PASS
```

This is a note, not another blocker of the bounded touch/start repair: the counterfactual proves the same ordinary-edit defect before this range, and a normal content edit is not the touched-unchanged or restart trigger B1-B3 specified. It is relevant input for an optimizer repair. Include ordinary keyed source edits in optimizer invalidation/evidence, and add the source-revision regression with an uncached control. A start-only rebuild still leaves this lifetime gap.

## Nits

### N1, proven: D4 still offers declaring the fixture as a remedy for an own-write unknown

`docs/specifications/001-core-loop/spec.md:85` says “the remedy is to write outside the worktree or under an ignored path, or to declare the file.” The new skill reference correctly says the ignored path must be absent from inputs and that declaring it does not help: it puts the file in the key and completion barrier. The worker notes explicitly made this decision. Remove “or to declare the file” and qualify the ignored-path remedy as in `plugins/claude-code/skills/squeal/references/reports.md:46`. No product change is needed.

### N2, proven: the changed D2/D4 contract has no 001-168 amendment entry

`docs/specifications/001-core-loop/status.md:144`. At the exact candidate the log's latest touch amendment is 001-159, followed by the inherited-failure decision for 001-170/001-171. No 001-168 entry records removal of the own-write exception, the completion barrier or optimization at every start. The wave brief requires one status line per row, and the process requires a dated amendment for accepted rule changes. Append that entry with the decision and evidence link; preserve the historical 001-159 entry.

## What fits

- **Prior B1 closed, proven by external replay and counterfactual.** The held virtual test and held CSS test that rewrite their input no longer publish a PASS, both observation settings. The CSS input is outside the barrier, isolating removal of the adapter's own-write exemption. Fresh disk controls fail. The old observed CSS case stores current PASS.
- **Prior B2 closed, proven by external replay and counterfactual.** A late restore batch leaves no result for `results.byKey` and a second worktree runs and fails instead of inheriting a false PASS, both observation settings. The barrier's unknown reason names the declared source. At 9d0ea80 the same late batch leaves the virtual current PASS.
- **Root-project B3 restart case closed, proven.** The external replay covers close/reopen with stale cache kept, a forced checkpoint from that cache and the uncached failing control. Both settings pass the expected disk-state assertions. The original candidate gate passes all committed restart cases.
- **Slow root optimizer startup control holds.** The independent slow-factory cases preserve a stale root optimizer cache, create the receiving slow instance on OLD and store current FAIL, both settings. This does not prove file-based project optimizer coverage (B3).
- **Earlier repaired stamp/touch cases remain honest in the gate.** The separate-container and query regressions now assert withheld unknowns when they plant after selection; they require the completion-barrier reason. The touch-before-selection regressions still require restored current FAIL. Conservative unknown is consistent with the newly authorized interval rule.
- **No-relist choice and live slow touch delivery remain intact.** A touch re-fetches referencing closures without claiming a project recreation or listing newly added tests ahead of their watch batch. The candidate gate passes its no-relist addition and slow in-flight withholding cases.
- **Start-cost evidence is recorded in D4.** The supplied Squeal/cezar measurements distinguish optimizer-disabled repositories from the small enabled-alias fixture. No second benchmark or full suite was run. Coarse timestamp filesystems, absent undeclared inputs and the previously accepted separate-read interval remain outside these experiments; no wider coverage claim is made.
- Previously settled process ownership, recorder, store, lane and liveness findings were not re-prosecuted.

## Inputs for the next wave

1. Send B3 and B4 to the human as row 001-169 directs. The reviewer does not accept these limitations or edit the board.
2. Treat optimizer validity as a relation between consumed source bytes and keyed bytes, for every server and from its build time onward. Root-only force, a run-only interval and a fresh in-memory instance each leave a proven path here.
3. A B3 repair must test file-based projects through both fresh creation and forced scheduler checkpoints. A B4 repair must include startup before first source hashing, not just a transient rewrite after tier selection.
4. Keep B1/B2's observation-on/off, fresh-control, result-lookup and inheritance regressions. Preserve per-module/container stamps, 001-150's overlapping gates, immediate slow touch delivery and no-relist behavior.
5. S1 should join the optimizer repair or receive its own small row. Fix N1/N2 as documentation corrections. Keep the loaded full gate and passing isolated repeats distinct in any landing claim.

All throwaway probe scripts, fixtures, isolated stores, optimizer caches, counterfactual source copies and external logs were removed after recording this evidence. Both independent-probe daemons were stopped; no unrelated daemon or this repository's store was changed. Only this report is committed.
