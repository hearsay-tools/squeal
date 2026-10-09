# Wave 13 seventh review: Vitest without optimizer bundles

PASS 78f51e6

No proven blockers, two proven should-fix notes, no nits. Wave-13f B3, B4 and S1 are closed for the non-browser Vitest instances tested here. The candidate's slow-instance repair works, but its committed regression does not discriminate that repair. The registration note can describe a configuration that is no longer current.

Reviewed `431bc7e..78f51e6`, the assigned 0.1.69 baseline through the exact 0.1.72 bundle landing. The assigned checkout began at `28adb35`, two documentation-only commits later. All candidate gates and probes ran detached at `78f51e6a2e7ad9dce920a56511589807383677b4`, with a clean tracked tree. Returned to `cez/e668ca64` only to commit this report. Read wave-13 through wave-13f, task 001-176's notes, the wave brief, board, spec and amendment log. Rows 001-170 and 001-173 were considered only at the state-publication and Vitest-reporter seams; other coordinators' changes were not reviewed.

## Verification

Node 24.21.0, Linux. Main gate: Vitest 5.0.3, Vite 8.3.2. Independent compatibility probes: Vitest 4.1.10, Vite 7.3.7, installed outside the repository. Reviewer and repository instructions require a direct full suite and build. The implementation workers' no-build rule does not waive those reviewer checks. One full gate only, capped at four outer workers; external probes use one outer worker and the resolved-state matrix explicitly caps each adapter at one worker. Rebuilding changed neither plugin bundle.

```text
$ git rev-parse HEAD
78f51e6a2e7ad9dce920a56511589807383677b4

$ npm ci
added 56 packages, and audited 57 packages in 3s
found 0 vulnerabilities
(exit 0)

$ npm run lint
> squeal@0.1.72 lint
> biome check .
Checked 685 files in 319ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.72 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.72 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.72 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
$ git status --short
(no output)
```

```text
$ npx vitest run --maxWorkers=4
FAIL test/integration/revert-restore.test.ts
  stores what a fresh run of the restored bytes gives
  expected [ 'current pass', 'current pass' ] to not include 'current pass'
  test/integration/revert-restore.test.ts:195:57
FAIL test/status/torn-read.test.ts
  Stop's poll reads the header of one revision
  Test timed out in 5000ms.
  test/status/torn-read.test.ts:147:3
Test Files  2 failed | 297 passed | 1 skipped (300)
     Tests  2 failed | 2241 passed | 11 skipped (2254)
Start at 18:44:54 (Europe/Warsaw)
Duration 915.62s
(exit 1)

$ npx vitest run test/integration/revert-restore.test.ts --maxWorkers=1
Test Files 1 passed; Tests 1 passed; Duration 15.36s
(exit 0)
$ npx vitest run test/status/torn-read.test.ts -t "Stop's poll reads the header" --maxWorkers=1
Test Files 1 passed; Tests 1 passed | 3 skipped; Duration 6.58s
(exit 0)
```

The full gate is not green. Its revert/restore failure is a current-PASS assertion, not a timeout; its cause has not been established and is not dismissed as timing noise. The original case passed its required isolated repeat. A focused external replay with per-run snapshots withheld the armed load as unknown in eight cases; its later external fresh-CLI control failed, so that later control is unverified and is not used to support the verdict. A bounded replay stopping at the withholding assertion is recorded below. No differing fresh-disk test outcome was demonstrated by the failed full-gate assertion. The changed optimizer, source-stamp, touched-cache, own-write, late-touch, restart and no-relist files passed the full gate. The torn-read failure is a 5 s timeout and passed alone. The gate printed two fixture gitdir-repair notices and one earlier-run process-cleanup notice, with no global-teardown failure. These failures do not prove another break of the optimizer repair, whose non-browser correctness is separately discriminated above.


Install warned about the esbuild and @parcel/watcher install-script allowlist; subsequent checks completed. Background Squeal's 0.1.62 baseline is separate evidence and is not the independent gate: it reported a Codex CLI timeout at load 47.29 and a watcher timeout at load 75.84. No clean background checkpoint is claimed.

External replay and discrimination output:

```text
Candidate B3 restart/checkpoint/slow, B4 real-daemon pre-scan, S1 ordinary edit,
with observation on/off and fresh controls:
  Test Files 2 passed; Tests 12 passed; Duration 41.82s; exit 0
Vitest 4.1.10 / Vite 7.3.7 B3/S1 replay:
  Test Files 1 passed; Tests 10 passed; Duration 45.63s; exit 0
Effective-state matrix, each version:
  root / separate config / inline project x SSR / client x forks / threads:
  12 cases; optimizerInUse before and after execution = [];
  NEW run PASS, ordinary OLD edit FAIL, no run failure
Old 431bc7e daemon, B4 pre-scan boundary:
  2 cases fail expected current FAIL; actual current PASS, both observation modes
Old 431bc7e adapter/scheduler, B3 restart and S1 edit:
  restart: stale cached PASS instead of fresh FAIL, both modes
  ordinary edit: stored current PASS instead of current FAIL, both modes
Original slow test, only slow factory changed to the old adapter:
  Test Files 1 passed; Tests 2 passed | 8 skipped; Duration 26.26s; exit 0
Slow test with cache cleared before warming NEW, candidate slow adapter:
  Test Files 1 passed; Tests 2 passed | 8 skipped; Duration 17.89s; exit 0
Same corrected precondition, old slow adapter:
  Test Files 1 failed; Tests 2 failed | 8 skipped; Duration 20.74s; exit 1
  actual stored current PASS, expected current FAIL, both modes
Bounded real-daemon armed-load withholding replay:
  Test Files 1 passed; Tests 8 passed; Duration 41.40s; exit 0
Registration after disabling the optimizer and completing its config revision:
  Test Files 1 passed; Tests 1 passed; Duration 10.40s; exit 0
  still prints: "which the config of the root project turns on"
```

The external replay copies preserve the fixture and scheduler sequences, with product imports pointed at the candidate and scratch roots moved outside the checkout. Each fixture has its own Git repository, store and optimizer cache, and links to installed packages. The real-daemon pre-scan cases use the brief's controlled Git boundary and stop only their owned daemons. The matrix captures each real `createVitest` result through a wrapper passed to `VitestAdapter`, then inspects project options and optimizer metadata before and after real runs. Its client environment is a Node-hosted custom environment using Vite's client transform, not browser mode.

Counterfactual source trees were extracted outside the checkout. The early counterfactual copy still imported some candidate helpers; it was corrected before the reported restart/edit discrimination. An early matrix fixture used a project-config filename Vitest rejects; the corrected matrix uses `vitest.p.config.ts`. Neither scratch setup mistake is a product finding. The original slow cases fail their NEW warm-up when the entire old adapter is used; that is not evidence that the receiving slow instance rejects a NEW bundle. S2's selective slow-only substitution and corrected precondition supply the discriminating evidence instead.

## Blockers

None proven in this bounded repair. This verdict does not claim every full-gate test passed or that browser mode is covered.

## Should-fix

### S1, proven: a later registration repeats an obsolete optimizer-override claim

`src/core/state/header.ts:73`, `src/runners/vitest/optimizer.ts:94`, `src/core/delivery/format.ts:367`.

D4 and row 001-176 require a note when the current project's config enables optimization. `readHeader` takes the newest historical daemon note with the prefix, without checking whether the current instance still overrides an enabled optimizer. A recreate with no enabled optimizer emits nothing and clears nothing. Historical notes therefore become current registration wording.

Independent scheduler/store proof:

1. Start the alias fixture with `deps.optimizer.ssr/client.enabled: true`; the initial note is correct.
2. Change only both `enabled` fields to false. Preserve the alias and test. Deliver the real config batch, complete the new revision and its recreated instance.
3. Register a new session. Its revision-1 header still prints:

```text
Squeal runs Vitest without its dependency optimizer, which the config of
 the root project turns on: ...
```

The config now leaves the optimizer off. No false test result is demonstrated; keep this nonblocking. The stale note can also survive a daemon restart because it is persisted.

Fix sized for one worker: separate the current instance's override state from historical daemon notes, or retire that prefixed note when a successful recreate reports no overridden project. Registration should name only currently overridden projects; status can retain dated historical notes. Add enable -> disable -> recreate -> new-registration coverage and preserve the once-only fast/slow note behavior. Qualifying a retained note as a past configuration is also truthful, but it must not be phrased as current config state.

### S2, proven: the committed slow-instance test passes with the optimizer repair absent from that instance

`test/integration/optimizer-off.test.ts:101`, `test/integration/optimizer-off.test.ts:105`, `test/integration/stamps-repo.ts:127`.

Row 001-176 requires B3 through the slow-instance factory to guard the same stale-bundle guarantee. The test opens its fast harness on OLD before calling `builtOn(NEW)`. That first open builds and leaves an OLD optimizer cache. With the candidate, `builtOn` bypasses that cache and reports PASS from the NEW source, but it does not rebuild the file-based project's on-disk bundle. The kept bundle still represents OLD, which is also what the receiving slow test is supposed to read. This does not plant the dangerous NEW bundle in the slow instance.

Independent selective counterfactual: keep the candidate fast adapter, scheduler and `builtOn`; replace only the adapter created by `withSlowLanes` with the pre-176 implementation at `431bc7e`. Both observation variants still pass the committed slow test. The OLD bundle produces its expected FAIL even though the slow optimizer remains enabled.

Change only the external test's precondition: after opening the fast harness, delete this fixture's `.vite` cache before `builtOn(NEW)`. Now it builds a NEW bundle while the source holds NEW, restores OLD and lets the actual slow lane run:

```text
candidate slow adapter: OLD current FAIL, 2/2 pass
old slow adapter: OLD current PASS, 2/2 fail at the stored-state assertion
```

The current product repair is effective, so this is a should-fix test note, not a blocker. Fix sized for one worker: ensure the kept optimizer cache holds NEW before receiving slow-instance creation, then assert restored OLD current FAIL. Clearing this fixture's cache before `builtOn`, with an assertion on the bundle's consumed bytes, is sufficient. Keep observation on/off and add a fresh failing control. Counterfactual failure must be at slow-result publication, not at the earlier warm-up.

## Nits

None. Prior wave-13f N1 is corrected: D4's remedy now excludes ignored paths declared as inputs and explicitly says declaring the file does not help. N2 is corrected by the dated 001-168 amendment, preserving the older 001-159 history.

## What fits

- **B3 closed, proven.** A separately configured project's retained NEW optimizer cache no longer supplies a PASS on OLD. The new adapter, scheduler baseline and forced checkpoint each fail on restored bytes, observation on/off. The corrected slow probe proves the same receiving-instance behavior and fails at publication with the old slow adapter.
- **B4 closed, proven.** The real daemon builds NEW before its first key scan, restores OLD at the controlled boundary, and stores current FAIL, both observation modes. The old daemon stores current PASS under that same experiment. Source/key scan order has not been moved; bundle resolution is removed instead.
- **Prior S1 closed, proven.** A normal NEW -> OLD alias-source edit stores current FAIL. Old source repeats current PASS, both modes. The repair covers lifetime edits as well as starts.
- **Resolved options and bundle use agree for tested non-browser configurations.** The root, separate-config and inline-project matrix tests both Vite SSR/client environments in forks/threads on Vitest 5/Vite 8 and Vitest 4/Vite 7. The metadata remains empty after execution, not merely immediately after the helper. Config options are false. Installed Vite source creates the explicit optimizer for `noDiscovery`, initializes it once, and makes its later `run` a no-op; the resolver reads current metadata on each lookup.
- **Instances share the start path.** Fast, slow, initial and replacement adapters use `VitestAdapter.#start`, which calls `withoutOptimizer` before `standalone`. The helper visits the root server and all project servers, each environment once by server identity. The registration and status initial-note cases pass; S1 concerns the later config change.
- **Earlier conservative rules remain.** The diff retains source stamps, touch withholding, completion barrier, immediate slow touch receipt, exclusive recreation and the no-relist choice. Earlier repaired cases remain required in the gate; the loaded revert/restore failure and its passing isolated repeat are recorded separately, with no invented cause.
- **Boundaries remain explicit.** D4 and worker notes exclude browser-mode discovering optimizers. No real browser/provider was run and no claim is made for it. The already accepted separate-read interval, undeclared plugin inputs and paths outside keyed/watch scope are not reopened. This is not a new review of the settled process, store, recorder, lane or liveness slices.

## Inputs for the next wave

1. No optimizer correctness repair is required by the evidence above. Preserve the metadata/state enforcement for every non-browser start, including separately configured projects and slow instances.
2. Give S1 to one worker for current override state and the enable/disable registration regression; keep historical notes separate from current config claims.
3. Give S2 to one test worker: explicitly plant NEW in the retained slow cache, then verify OLD against the real slow run and fresh control. Require selective counterfactual failure at result publication.
4. Preserve the B3 restart/forced-checkpoint, B4 daemon pre-scan and S1 ordinary-edit controls with both observation modes. Preserve the earlier completion-barrier/result-lookup/inheritance and no-relist regressions. A passing full-suite claim must use the actual independent gate, not these targeted probes.
5. Keep browser mode as an explicit coverage limit until it gets its own supported-mode decision and experiment; do not advertise the non-browser proof as every optional Vitest provider.

All throwaway scripts, copied source/helper trees, fixtures, isolated stores, caches, external dependency installation and external logs were removed before committing. Owned probe daemons were stopped. No unrelated daemon or repository store was changed. Only this report is committed.
