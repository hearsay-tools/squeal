# 011-159: `lookup-only` is the default, and a held inherited fail runs once

Worker fa8e6ec2, 2026-10-23, wave 26 W1. Brief: `tasks/wave-26.md` W1. Spec: 001 D11 and 011 C4 step 3 as amended 2026-10-23; 001 D6 (task 001-170).

## What changed

- `src/core/types/policy.ts`: `DEFAULT_POLICY.baseline.onStart` is `"lookup-only"`. The loader (`src/core/daemon/policy.ts`) needed no change: it fills a missing key from `DEFAULT_POLICY`.
- `src/core/scheduler/ledger.ts`: `Ledger.settle` tells a held fail from its own probe. `acceptedAt` returns no hits and `mayWait: false` exactly when results are stored at the key and none may stand, which only `heldFailure` causes. With `queueMisses: false` such a miss is still queued, at its normal D5 priority. A new `SettleOptions.heldFails` set collects these misses instead of queueing them. No second store read per miss.
- `src/core/scheduler/bootstrap.ts`: the start's two lookups pass `heldFails`. Under `lookup-only` the miss loop also queues a miss in that set, beside a predecessor's pending work and a resumed rest's reach. Under `lookup-then-run-missing` the loop is as before.
- The later lookup (C4 step 3, each reconciliation pass and tier selection) is `StoredKeys.adopt` in `stored-keys.ts`, which calls `settle` with `queueMisses: false` and no `heldFails`. It needed no change.
- `plugins/{claude-code,codex,pi}/skills/squeal/references/policy.md`: the `baseline.onStart` row names the new default and the held-fail run. `commands.md` names no default: its status example already shows the lookup-only wording, so it is unchanged. `squeal setup` and `squeal init` name no default (`src/cli/setup`, `src/cli/init.ts`).
- Status needed no change: `standing.ts` and `unknown-files.ts` read `baseline.onStart` through the loader, so a worktree with no `baseline` key gets the lookup-only wording.

## Done-when, and the checks

| Done-when | Check |
|---|---|
| No `baseline` key: a new worktree's start queues no miss | `held-confirm.test.ts` 1; `daemon/policy.test.ts` "starts lookup-only with no baseline key" |
| A held fail is queued once and run at start; the local result confirms or clears it | `held-confirm.test.ts` 2 (confirms, own fail, not run again) and 3 (clears, heals the worktree that stored it); `inherited-failure.test.ts` with real Vitest (B on the default, A pinned) |
| The same when a later lookup finds one | `adoption.test.ts` 2 (held during its run, confirmed after, not run again); `formats-read-as-one.test.ts` risk 7 (a held fail at a listed format) |
| `"lookup-then-run-missing"` set: behaviour as before | `held-confirm.test.ts` 4; every pinned test below |
| Status and the skill references name the new default | `status.test.ts` (with no `baseline` key the D7 snapshot reads `lookupOnly: true` and names the lookup-only reason), `next-step-rows`, `retry`, `status-wait-reasons` "in text"; `policy.md` in the three plugins |
| cezar's and squeal's configs need no change | squeal's `squeal.config.json` sets `"lookup-only"` already; cezar's does too (`research/missed-sharing.md`: "Cezar keeps `baseline.onStart: "lookup-only"`") |

## Decisions the spec did not settle

1. Priority of a held fail queued under `lookup-only`: its normal D5 priority (`priorityOf`), as under `lookup-then-run-missing`. `file.failing` reads this worktree's known states, so a held fail of a new worktree is `neverRun` or `transitive`, not `failing`. Unchanged from before.
2. The start's lookups collect held fails and the miss loop queues them, rather than `settle` queueing them. Reason: the first lookup uses the stored closure list and a re-check uses this worktree's own. A file held at the first key and a plain miss at the second must not stay queued. The set drops a file whose later lookup finds no held fail. It also keeps the queue order of `lookup-then-run-missing` exactly as before.
3. A merge hold (row 011-72) or a strict re-key skips the lookup, so it finds no held fail and queues nothing more. As before.

## Type changes

- `SettleOptions.heldFails?: Set<string>` (additive).
- `DEFAULT_POLICY.baseline.onStart`: value `"lookup-only"` (the type is unchanged).
- Test helpers, additive: `holdSide(repo, root, files, policy)` in `merge-hold-fixture.ts`, `open(..., policy)` in `preload-worktrees.ts`, `SlotOptions.policy` in `slots-fixture.ts`, and `sides()` options take `policy` in `tier-yields-claim-fixture.ts`; each defaults to the product default.

## Tests that rely on the old start, and the pins

The brief asked for a count, then the coordinator chose (2026-10-23, reply to request 2ad35ab8): shared helpers stay on the product default, and a test passes the pin only where it means the start baseline. `test/helpers/baseline.ts` holds `RUN_MISSING` (a `Policy` part, for in-process helpers' `policy` option) and `runMissingConfig(text?)` (a `squeal.config.json` text, for fixture repositories' `files`). One shape per helper:

- `openHarness`, `side()`, `catchUpSide` and other in-process helpers: `policy: RUN_MISSING` (merged with a `policy` the test already passes).
- `createFixtureRepo` and `daemonSuite().fixture`: `{ "squeal.config.json": runMissingConfig(<the test's own config, if any>) }`.

Structural count before the decision: 113 test files use `openHarness`, 14 use `side()`, 56 start a real daemon through `createFixtureRepo` or `daemonSuite`, 12 more start one on a repository of their own.

Counts: 173 files carry a pin ("means the baseline"), 10 files have an assertion updated to the new default ("lookup-only behaviour"), 4 shared helpers gained a `policy` option, 0 defects. Four files are both: `adoption`, `formats-read-as-one`, `unknown-files` and `status-wait-reasons` keep one case each on `lookup-then-run-missing`, so the old start and its status wording stay covered beside the new default's. A pin is a one-argument edit (a `policy` entry, or a `squeal.config.json` through `runMissingConfig`) with its import; where a file's own helper had no way to take it, the helper gained a `policy` or `baseline` parameter, named in the table.

### Lookup-only behaviour: the assertion now describes the new default

| Test file | Case | Why |
|---|---|---|
| `test/cli/next-step-rows.test.ts` | 3 cases (never run; four never run; from a subdirectory) | each row names "(the baseline is lookup-only)" |
| `test/cli/retry-no-reason.test.ts` | "runs once a stale, a never-run and a timed-out file" | with no `baseline` key the never-run file's retry names the lookup-only reason |
| `test/cli/retry.test.ts` | "queues one run at once, whatever the reason" | with no `baseline` key the retry names the lookup-only reason |
| `test/cli/status-wait-reasons.test.ts` | "in text" | each stale and never-run row names "(the baseline is lookup-only)" |
| `test/daemon/policy.test.ts` | "applies every given key over the defaults" | its given `baseline` equalled the new default; it now gives `lookup-then-run-missing`, and a new case checks no key gives `lookup-only` |
| `test/scheduler/adoption.test.ts` | 2 "a fail the first stored ... held" | the row's change: a later lookup's held fail is queued once, runs, and its local fail confirms it |
| `test/scheduler/adoption.test.ts` | 3 "a pass with nothing new takes no write lock" | its held fail now runs once; b fails it too, so the locked pass still finds a confirmed fail |
| `test/scheduler/formats-read-as-one.test.ts` | risk 7 "holds another worktree's unconfirmed fail at a listed format" | the held fail runs once; held until then |
| `test/status/status.test.ts` | 2 cases (the D7 snapshot; the human text) | with no `baseline` key the snapshot reads `lookupOnly: true` and names the lookup-only reason |
| `test/status/unknown-files.test.ts` | "ignores a reason kept for a key the file has moved from" | with no `baseline` key status names the lookup-only reason |
| `test/types.test.ts` | "exposes the policy defaults" | the defaults literal names the new default |

### Helper options: the product default unless a test passes the pin

| Helper | Option | Note |
|---|---|---|
| `test/scheduler/merge-hold-fixture.ts` | holdSide() takes a `policy` (default: the product default) | pinned per call below |
| `test/scheduler/preload-worktrees.ts` | open() takes a `policy` (default: the product default) | observed-growth's local `open` passes the pin |
| `test/scheduler/slots-fixture.ts` | slotHarness() takes a `policy` (default: the product default) | pinned per call below |
| `test/scheduler/tier-yields-claim-fixture.ts` | sides() takes a `policy` for this worktree (default: the product default) | pinned per call below |

### Means the baseline: pinned

One line per test file, or per shared helper whose own contract is the start baseline (its doc says "whose baseline ran" or the like), pinned inside it for all its users.

| Test file | Where the pin is | Why |
|---|---|---|
| `test/cli/hold-wait.test.ts` | onHold() | both importers passed at the start before the conflict |
| `test/cli/status-wait-reasons.test.ts` | "in JSON" | its config sets `lookup-then-run-missing`, so the run-missing reasons stay covered beside the text case's default ones |
| `test/daemon/bare-note-inputs.test.ts` | "names the file no declaration covers" | waits for the start to run both node:test files |
| `test/daemon/busy-edit.test.ts` | 1 case | it waits for "the baseline recorded" before the edit |
| `test/daemon/busy-tier.test.ts` | 1 case | it waits for the start's run of the slow file |
| `test/daemon/departure.test.ts` | 5 cases | they wait for "the baseline done" or the start's slow test |
| `test/daemon/died.test.ts` | heldDaemon() | "its baseline holding test/held.test.ts in a tier" |
| `test/daemon/drain-checkpoint.test.ts` | "joins the running baseline" | named for it |
| `test/daemon/escaped.test.ts` | 2 cases (escape test; forgetful setup) | each waits for the start's result of its test file |
| `test/daemon/hardening.test.ts` | "SIGTERM during a tier stops Vitest's worker pool" | needs the start's tier in flight |
| `test/daemon/hold.test.ts` | heldFixture, for cases 1, 3, 5 | the start's run of the held file |
| `test/daemon/idle-gc-daemon.test.ts` | 1 case | it waits for "the fast baseline, then 2 s quiet" |
| `test/daemon/install-wait.test.ts` | freshWorktree() | "then runs the baseline" after the install |
| `test/daemon/last-use-daemon.test.ts` | 1 case | it waits for "the baseline done" |
| `test/daemon/reinstall.test.ts` | installedWorktree, "exits at npm ci with an edit" | waits for the start's baseline before the reinstall |
| `test/daemon/reload-projects-kit.ts` | reloadRepo's config, for reload-projects and reload-projects-flight | the tests count each project file's run at start; the config writer keeps the pin through reloads |
| `test/daemon/scratch-children.test.ts` | 1 case | it waits for the start's result for test/math.test.ts |
| `test/daemon/scratch-identity.test.ts` | "keeps both temp directories ... the newcomer's tests still pass", repository b only | waits for the newcomer start's run of test/tmp.test.ts (its `baseline`) |
| `test/daemon/scratch-refused.test.ts` | "serves with a private temp directory of its own" | waits for the start's result of test/tmp.test.ts |
| `test/daemon/scratch.test.ts` | "started from inside the root, it runs the root's tests" | waits for the start's results |
| `test/daemon/serving.test.ts` | "a broken vitest.config.ts at start" | the first daemon's start must settle current results |
| `test/daemon/serving.test.ts` | "answers a ping in under 100 ms while a tier is running" | needs the start's tier in flight |
| `test/daemon/shared-store.test.ts` | 1 case | it waits for "the baseline" of each of 3 starts |
| `test/daemon/slow-lane.test.ts` | 1 case | the start queues the slow file that runs beside the edit |
| `test/daemon/step-down-lanes.test.ts` | 2 cases "with ... in flight, cancels both" | both wait for the start's run of the held files ("(baseline)") |
| `test/daemon/step-down.test.ts` | cancelsItsTier() (the 0.1.0 build of the sources) | the start's tier runs the slow file; the released 0.1.31 daemon has the old default |
| `test/daemon/stop-cancel.test.ts` | "returns within seconds mid-batch"; "starts no slow file once a stop during the departure drain is accepted" | both wait for the start's run of the held or slow file |
| `test/daemon/symlinked-install.test.ts` | linkedInstallWorktree() | "lists and runs the tests" at the start |
| `test/daemon/symlinked-source.test.ts` | 1 case | it waits for the start's baseline before the test behind the link |
| `test/daemon/unused-stop.test.ts` | 2 cases (UNUSED config; the subagent case's fixture) | both wait for "the baseline done"; the lookup-only case stays |
| `test/delivery/hold-told.test.ts` | registered() | both importers pass at the start, then again after the hold |
| `test/harness/hung-daemon.test.ts` | served(), for its cases | "a ready daemon ... nothing pending" with a passing baseline; the edit's `PASS -> FAIL` needs the start's pass |
| `test/harness/pytest-bundle.test.ts` | 1 case (a bundle built from the sources) | it waits for "the bundled baseline" |
| `test/integration/capacity-project.test.ts` | repository config, 1 case | the start's backlog takes the capped slots |
| `test/integration/fingerprint-two-worktrees.test.ts` | "tells A FAIL -> PASS for the healed check" (A only) | A's start stores the fails; B stays on the default and its held fail runs once and heals A |
| `test/integration/node-test-packages.test.ts` | repository config, 1 case | it waits for the start's baseline before the install bump |
| `test/integration/node-test.test.ts` | repository config, 1 case | it waits for "the main baseline"; the linked worktrees read the same config |
| `test/integration/optimizer-off.test.ts` | 6 cases (restart forced checkpoint, slow instance, ordinary edit) | each asserts what the harness start stored |
| `test/integration/optimizer-start.test.ts` | repository config, its 2 cases | `settle` waits for the start's completed checkpoint and reads the start's result; on the default it timed out after 600 s |
| `test/integration/project-config-stamps.test.ts` | 6 cases (closure walk, two projects, slow instance) | each asserts what the harness start stored |
| `test/integration/pytest-environment.test.ts` | repository config, its 2 cases | both wait for "the baseline" |
| `test/integration/pytest.test.ts` | repository config, 1 case | it waits for "the main baseline"; the synced worktree reads the same config |
| `test/integration/query-stamps.test.ts` | 6 cases (own read, transient transform, slow instance) | `probe()` expects the start's run to plant the variant |
| `test/integration/setup-missing-import.test.ts` | 2 cases | the start's run reports the setup's missing import |
| `test/integration/slow-spawn.test.ts` | repository config, 1 case | the start runs the slow node:test file before the edit |
| `test/integration/status-wait-edit.test.ts` | 1 case | it waits for the start's results before the edit |
| `test/integration/status-wait-sync.test.ts` | 3 cases | `settled` waits for the start baseline; fixture config pinned |
| `test/integration/touched-caches.test.ts` | open() | the probe runs after the start ran every file |
| `test/integration/touched-in-flight.test.ts` | 3 harnesses | the touch lands during the start's run |
| `test/integration/touched-late.test.ts` | first harness | the first worktree's start stores the results the second reads |
| `test/integration/touched-own-write.test.ts` | open(), its 4 cases | the start's run is the one that rewrites the input |
| `test/integration/touched-scope.test.ts` | rig(), its 2 cases | the rewrite lands during the start's tier |
| `test/integration/touched-stamped.test.ts` | slow case | the slow lane is made by the start's run |
| `test/keys/install-inheritance.test.ts` | 5 harnesses | the first start runs all; the second runs the changed-key miss, or none |
| `test/keys/require-helper.test.ts` | 1 harness | the start runs the test before the helper edit |
| `test/runners/pytest/adapter-skip.test.ts` | first daemon only (openDaemon() takes a `policy`) | the first start runs test_param.py; the fresh worktree stays on the default and inherits |
| `test/runners/pytest/spawned.test.ts` | open() | the start runs the pytest files before the edit |
| `test/runners/vitest/broken.test.ts` | A only | A's start loads the instance before its temp dir is removed |
| `test/runners/vitest/setup-failure.test.ts` | 4 harnesses | the start's run hits the global setup |
| `test/runners/vitest/setup-recovery.test.ts` | 2 harnesses | the start's run hits the global setup |
| `test/scheduler/adoption.test.ts` | 2 "under lookup-then-run-missing a held fail stays queued" | named for the start that runs its misses |
| `test/scheduler/backlog-cancel.test.ts` | 1 harness | the start's tiers run before the forced full suite |
| `test/scheduler/backlog-quiet-exempt.test.ts` | 4a | "the start's baseline ran every file, the backlog's in its tiers" |
| `test/scheduler/backlog-quiet-vitest.test.ts` | case 8 | the start runs the suite before the edits cancel a backlog tier |
| `test/scheduler/backlog-slots.test.ts` | cases 2 and 4 | the start's backlog fills the slots; case 1 passes on the default |
| `test/scheduler/backlog-wall-latency.test.ts` | 1 harness | the start stores the edited file's pass and its duration |
| `test/scheduler/backlog.test.ts` | 1 case | the start runs all 200 files before the environment change re-queues them |
| `test/scheduler/busy-withhold.test.ts` | harness(), its cases | each case counts runs from the start's run and reads the state it stored |
| `test/scheduler/capacity-pool.test.ts` | 2 cases | "the baseline's tiers are the backlog's": the start's run takes the pool's grant |
| `test/scheduler/catch-up-claims.test.ts` | case 8, main only | the second worktree inherits the first's baseline; it stays on the default |
| `test/scheduler/catch-up-classification.test.ts` | options(), its cases | `started()` is a daemon whose start ran every file; B3's revisions are an earlier daemon's after its baseline |
| `test/scheduler/catch-up-order.test.ts` | case 7 changed(), its 2 cases | the light files are current from the start's run when the heavy file runs |
| `test/scheduler/catch-up-turn.test.ts` | "gives way to the edit's tier" | the start's run creates the pool the case then takes permits from |
| `test/scheduler/catch-up.test.ts` | case 3 "under lookup-then-run-missing", the next start | the case names the policy; the first daemon stays on the default |
| `test/scheduler/checkpoint-lookup.test.ts` | 1 case | the start's run observes the swap file's directory |
| `test/scheduler/checkpoint-resume.test.ts` | 3 cases (run --all during the baseline; forced run --all, both daemons; owed run --all's next daemon) | each checks the baseline checkpoint a start runs |
| `test/scheduler/checkpoints.test.ts` | 5 cases (tiers of one checkpoint; run --all at once; second worktree's A; restarted daemon's first; S9) | D5/D7: the start's baseline checkpoint runs the misses; the second worktree and the restarted daemon stay on the default |
| `test/scheduler/claims-expiry.test.ts` | 3 cases, both sides | both starts run the misses whose claims the cases race |
| `test/scheduler/claims-finished.test.ts` | 3 cases, the starting side | the race is between the start's selection of its misses and their run |
| `test/scheduler/claims-slow-slot.test.ts` | 2 cases | the start's slow tier takes the permits |
| `test/scheduler/claims-slow.test.ts` | slowSide(), its cases | both starts run the slow file whose claim the cases race |
| `test/scheduler/claims-split.test.ts` | every side, its 3 cases | each start's backlog tier is the split |
| `test/scheduler/claims.test.ts` | cases 1, 4, 8, 9; case 6 a only (b on the default runs the held fail) | the claims race between the starts' runs of their misses |
| `test/scheduler/command-hold-slow.test.ts` | slowSide(), its 4 cases | the start queues the slow file the load guard holds |
| `test/scheduler/command-hold.test.ts` | 6 cases; case 3's first scheduler only | each hold lands on the start's tier, or counts from its run; case 3's next start takes the handed-over queue on the default; case 7 passes on the default |
| `test/scheduler/daemon-loop.test.ts` | "a gitignored generated file in a closure" (B2) | the start runs gen.test.ts and stores the key the rewrite then changes |
| `test/scheduler/edit-beside-backlog.test.ts` | harness(), its 4 cases | the edit lands while the start's backlog tier runs |
| `test/scheduler/edit-cut-fixture.ts` (edit-cut, edit-cut-readers, edit-cut-route, edit-cut-new-source, catch-up-quiet) | started(), 19 calls | its contract: "a daemon whose baseline ran every file, so each has a last-known duration", which the cut reads |
| `test/scheduler/edit-cut-readers.test.ts` | reading(), its cases | its contract: "a daemon whose baseline ran `files`", whose observed reads the cut uses |
| `test/scheduler/edit-cut-route.test.ts` | case 9 "(lookup-then-run-missing)" | the case names the policy; its table entry gave none, which was that policy's default |
| `test/scheduler/editor-scratch-observed.test.ts` | observer(), its 4 cases | the start's run lists `lib/` |
| `test/scheduler/environment-growth-wait.test.ts` | its scheduler | "the baseline's run completes and is held" |
| `test/scheduler/environment-growth.test.ts` | 2 cases (three growing runs; B's forced full suite, both worktrees) | the start's runs grow the environment and store the fails the case reads |
| `test/scheduler/file-wall-time.test.ts` | 1 case | the start runs the setup-heavy file whose file-level time the case reads |
| `test/scheduler/first-commit-adoption.test.ts` | case 1, first daemon only | "math's result at its key was in the store"; the second daemon stays on the default |
| `test/scheduler/first-observation.test.ts` | "re-runs a file that reads a new path every run" | the start's run is the first of the three |
| `test/scheduler/forced-requeue-fixture.ts` (forced-requeue, strict-lookup) | listing(), forced-requeue's 2 cases | its contract: "its baseline done" |
| `test/scheduler/formats-read-as-one.test.ts` | "settles a file from its newest set ... runs one stored at 12" | asserts the start runs the miss a format below the list leaves |
| `test/scheduler/fresh-worktree-durations.test.ts` | its policy, 1 case | row 011-154: the first baseline tier of a new worktree's misses |
| `test/scheduler/handover-queued.test.ts` | heldThenStopped()'s first daemon; case "default baseline, under a key-format change" | the helper's contract: "a worktree whose every file ran once"; the case names the old default |
| `test/scheduler/held-heal.test.ts` | 2 cases (healMixed) (A only) | A's start stores X PASS, Y FAIL; B stays on the default and runs its held file once |
| `test/scheduler/idle-pass.test.ts` | 1 case | the idle pass is measured after the start's runs |
| `test/scheduler/in-use.test.ts` | heldBaseline(), its 5 cases | "a started scheduler whose baseline's first fast backlog tier is held" |
| `test/scheduler/inherited-failure.test.ts` | 3 cases (inheritFail) (A only) | A's start stores the fail; B stays on the default and its held fail runs once with real Vitest |
| `test/scheduler/install-wait.test.ts` | 3 cases (validates after an install; no dependencies; edit during the wait) | the baseline runs after the install wait |
| `test/scheduler/integration.test.ts` | 2 cases (break/fix delivery; restarted daemon queues a known failure first, both daemons) | the start's pass is what PASS -> FAIL reports; the restart runs every re-keyed miss |
| `test/scheduler/lanes.test.ts` | openMixed(), its 3 cases | it asserts the start ran the node:test file to a pass |
| `test/scheduler/merge-hold-heal.test.ts` | main only | main's start stores the fails; the other worktree stays on the default |
| `test/scheduler/merge-hold-operations.test.ts` | started(), its cases | the abort ends the hold "with no run" after the start's runs |
| `test/scheduler/merge-hold-records.test.ts` | case 6 | it counts runs from the start's |
| `test/scheduler/merge-hold-setup.test.ts` | control | the start's run hits the setup failure the case reads |
| `test/scheduler/merge-hold.test.ts` | cases 2, 3, 4 (the first daemon) | both importers passed at the start before the conflict |
| `test/scheduler/observed-growth.test.ts` | open(), its 6 cases | each case compares two worktrees' start runs; a local `open` passes the pin to preload-worktrees' `open` |
| `test/scheduler/observed-inputs.test.ts` | observing(), its cases; the changed and linked worktrees | "runs each file once at the start"; a changed worktree's miss runs at its start |
| `test/scheduler/ordering.test.ts` | 3 cases | the edit's order reads the durations the start's runs stored |
| `test/scheduler/preload-heal.test.ts` | "keeps B's own fail" | both starts run the node:test file |
| `test/scheduler/promotion.test.ts` | 5 sides | A runs and B, Z are queued by the start |
| `test/scheduler/promotions-published.test.ts` | 1 case | the promoted file is queued by the start |
| `test/scheduler/pytest-slots.test.ts` | forcedPass() | packing reads the durations the start's run stored |
| `test/scheduler/recursive-listing.test.ts` | 1 case | the start's run observes the listed directories |
| `test/scheduler/rekeyed-duration.test.ts` | ranOnce()'s first daemon (options() takes a `baseline`) | the first start stores the slow files' durations; the restart stays on the default |
| `test/scheduler/replaced-failures.test.ts` | 2 cases | `failing()` after the start |
| `test/scheduler/rerun-failure.test.ts` | failFirst(), its 4 cases | the start's run of the flaky file is the held first run |
| `test/scheduler/rerun-grown.test.ts` | "reports FAIL, re-runs it forced once" | the start's run grows the closure |
| `test/scheduler/rerun-restart.test.ts` | failThenExit()'s first daemon; "names the re-run" | the first daemon's start runs the flaky file to its new failure; the next daemons stay on the default and run the handed-over re-run |
| `test/scheduler/rerun-slow-teardown.test.ts` | 4 cases (slowOptions) | the start's slow tier runs the file |
| `test/scheduler/rest-resume.test.ts` | ranOnce, for its 3 cases | "a worktree whose every file ran once" |
| `test/scheduler/retry-fixture.ts` | options(), for retry, retry-delivery, retry-no-result, joined-retry | `failing()` asserts the start's run of the flaky file |
| `test/scheduler/revision-lag.test.ts` | "records each revision within 500 ms" (barrelInFlight) | the start runs every file before the edits |
| `test/scheduler/run-lanes.test.ts` | open(), its 3 cases | it waits for the start's full-suite claim |
| `test/scheduler/runner-failure.test.ts` | 3 cases (broken config; restart's first daemon; failed listing) | each asserts the states and the completed baseline the start stored before the failure |
| `test/scheduler/runner-part-bound.test.ts` | 1 case | the stalled revision leaves files unknown that the start had run |
| `test/scheduler/runs.test.ts` | 7 cases | D5/D12: each starts from the results and keys the start's tiers stored |
| `test/scheduler/runtime-gone-slow.test.ts` | 1 case | the start's slow tier is the one whose runtime goes |
| `test/scheduler/runtime-gone-tier.test.ts` | 5 cases (the first daemon of each, and case 3's second, whose files the first's setup failure left unqueued; the `{}` entry of "a second such run") | "the first daemon runs its misses"; `{}` was the old default |
| `test/scheduler/scratch-inputs.test.ts` | policy() and the 004-81 case, 7 cases | each case reads what the start's run stored or wrote |
| `test/scheduler/slots-backlog-turn.test.ts` | 1 case | "the baseline's first slot holds the lane; its other files are queued as the backlog" |
| `test/scheduler/slow-activity.test.ts` | options(), its cases | the start queues the slow files whose activity the cases read |
| `test/scheduler/slow-backlog.test.ts` | open(), its 5 cases | the baseline's fast backlog tiers and their drain |
| `test/scheduler/slow-continuous.test.ts` | inTurn(), its 3 cases | it waits for the start's runs before the edit |
| `test/scheduler/slow-lane.test.ts` | open(), its 3 cases | the start queues the slow file the lane runs |
| `test/scheduler/slow-node-test.test.ts` | open(), its 3 cases | the baseline's idle slow tier |
| `test/scheduler/slow-nudge.test.ts` | 3 cases | the slow file the start queued waits for the nudge |
| `test/scheduler/slow-parallel.test.ts` | 3 cases | the start queues the slow files the idle tier takes |
| `test/scheduler/slow-pending.test.ts` | 1 case | the start queues the slow file |
| `test/scheduler/slow-pool.test.ts` | open(), its 2 cases | the start's slow tier takes the pool's workers |
| `test/scheduler/slow-rank.test.ts` | open(), its 3 cases | the start runs the three slow files before the edits |
| `test/scheduler/slow-request-join.test.ts` | 1 case | the slow file the request joins runs from the start's queue |
| `test/scheduler/slow-request-load.test.ts` | loaded() | the start queues the slow files the load defers |
| `test/scheduler/slow-slot-fair.test.ts` | daemon(), its 6 cases | each daemon's start queues the slow files that wait at the slot |
| `test/scheduler/slow-tier.test.ts` | slowPolicy() and the maxDeferMs case, 10 of its 11 cases (requestSlowSuite passes either way and shares the fixture) | the start's slow tier is the subject of each case |
| `test/scheduler/slow-trigger.test.ts` | guarded(), its 2 cases | the start queues the slow file the load guard holds |
| `test/scheduler/slow-width.test.ts` | open(), its 2 cases | the start's slow tier takes the files its run starts at once |
| `test/scheduler/stopping-crash.test.ts` | heldTier()'s first daemon | "every file ran once"; its `{}` was the old default |
| `test/scheduler/tier-holds.test.ts` | 2 cases | the start's backlog tier is the one that holds the permits |
| `test/scheduler/tier-sharing.test.ts` | 1 case | the start runs both files before the edit |
| `test/scheduler/tier-yields-claim-ends.test.ts` | case 1 "the claimant's heartbeat lost" | the yield reads the 200 s durations the start's run stored; cases 2 to 4 pass on the default |
| `test/scheduler/tier-yields-fairness.test.ts` | forcedAndCut(), its 3 cases | the start stores H's fail before the forced run |
| `test/scheduler/tier-yields-overrun.test.ts` | heldTier(), its cases | "`ms` each last time": the estimate reads the durations the start stored |
| `test/scheduler/tier-yields-text.test.ts` | promotedBehind() | the remainder reads the durations the start stored |
| `test/scheduler/tier-yields-vitest.test.ts` | openTwoProjects() | it asserts the start ran the held file once |
| `test/scheduler/tier-yields.test.ts` | cases 1, 2, 3 | the tier's estimate reads the durations the start's runs stored; case 4 passes on the default |
| `test/scheduler/timed-out-tier.test.ts` | 2 cases | "finishes the baseline": the start's tier is the one that times out |
| `test/scheduler/unknown-run.test.ts` | "is named by why across worktrees" (A only) | A's start stores the pass; B and B2 stay on the default |
| `test/scheduler/validity.test.ts` | 2 cases (content edit during a tier; lockfile without a watch batch) | each starts from the start's current results and full-suite claim |
| `test/scheduler/wall-fixture.ts` (backlog-wall.test.ts) | wallSide, its only user's 9 cases | `backlog()` is "the tiers of the forced full run after the baseline, every duration known" |
| `test/scheduler/warm-up-repo.ts` (warm-up, warm-up-in-flight) | warmUpRepo(), its cases | each case compares a warm-up with the start's `baseline` snapshot, or holds the start's tier |
| `test/scheduler/withheld-retry.test.ts` | 5 cases | the start's run is the one the touch withholds |
| `test/scheduler/withheld-touch.test.ts` | "queues the edited file again" | the header must show every file current after the start |
| `test/status/unknown-files.test.ts` | "names an unkeyed file, ... a key never run" | its config sets `lookup-then-run-missing`, so the run-missing reason stays covered beside case "says a lookup-only baseline queued nothing" |
| `test/status/why-foreign-key.test.ts` | A only | A's start stores the fail; B stays on the default and its held fail runs once, which replaces A's result at the key |
| `test/status/why-replaced.test.ts` | A only | A's start stores the pass B inherits |
| `test/status/why-revert.test.ts` | 1 case | the start stores K0's result the revert restores |
| `test/store/prune-removed.test.ts` | A only (new in 0.1.280) | A's start stores the passes B inherits after the prune; B stays on the default |

## Rebase onto 0.1.280

On the coordinator's choice (2026-10-24, reply to request 3721b345), the wip commits were rebased onto origin/main `ab48c6833` (0.1.280 and docs) before the full run ended, so one run on the rebased tree found the rest. The rebase had no conflict. Of 0.1.280's new tests, `test/store/prune-removed.test.ts` (row 011-160) needed a pin of its first worktree; `focused*.test.ts`, `drain-wait`, `focus`, `focuses-file`, `slow-waiting` and `run-summary` pass on the new default.

## Expected failures: the bundles

The committed bundles still carry the old default, and this row builds none (the brief; versions and bundles are the coordinator's, 0.1.281). These four fail with `cli/ps.mjs differs from the build`:

- `test/harness/plugin.test.ts` "are committed exactly as `npm run build` produces them"
- `test/harness/codex/plugin.test.ts`, `test/harness/pi/package.test.ts`, `test/harness/opencode/package.test.ts` "has the bundles exactly as `npm run build:plugin` produces them"

## The same reliance outside Vitest (read, not run)

`squeal.config.json` excludes `test/e2e/**` from Vitest under Squeal, and the brief said to read `evals/` and `test/e2e/`, not to run them.

- `test/e2e/`: these start the shipped bundle (`plugins/*/dist`, not rebuilt by this row) in a fixture repository with no `baseline` key, then wait for "a passing baseline": a fresh start with `counts.current > 0` and nothing pending. The fixtures and tests that wait so: `opencode-fixture.ts` (`baseline()`, line 251), `pi-fixture.ts` (`baseline()`, line 201), `slow-shape.ts`, and `lifecycle`, `merge-hold`, `node-test`, `opencode`, `pi`, `policy`, `ps`, `pytest`, `shipped-plugin`, `stop-gap`, `stopped`, `torn-status`, `transitions`, `worktrees`. They pass today against the bundle. Once a release builds the new default into the bundle, each fixture repository needs `"baseline": {"onStart": "lookup-then-run-missing"}` (the `runMissingConfig()` shape), or each wait must be for its own run instead of the start's. That edit belongs to the row that rebuilds the bundle.
- `evals/`: `evals/ledgerline/squeal.config.json` has no `baseline` key. `evals/lib/atomic.mjs` `waitSettled` (line 74 and line 140) waits until no test file is stale or unknown. Under the new default a fresh eval worktree's start runs nothing, so each turn waits until its bound. The eval fixture needs the same key before the next eval run on a release with this row.

## Seam map for the next worker

- Where a held fail is decided: `heldFailure` (`src/core/state/inherited.ts`), called by `acceptedAt` (`accept.ts`), which `Ledger.probe` wraps. Also by `claims.ts` (a held fail never waits on another worktree's claim), `store-results.ts` (heals), the state sink and `why`.
- Where lookups happen: the start's two in `baseline` (stored closure list, then this worktree's own for the misses), `StoredKeys.adopt` on each reconciliation pass and tier selection, and every revision's `settle` with `queueMisses` true.
- A heal that leaves a file held writes `held-files:<worktree>`; the start's `takeHeldFiles` drops that list and its lookup finds the file as a held miss, which the miss loop now queues under `lookup-only` too. A running daemon takes it through `Ledger.confirmHeld`, which queues whatever the policy.
- `stored-keys.ts`'s header says "another worktree's unconfirmed fail stays held (C5), and a file policy left unqueued stays so". Both stay true, but it does not say that the held fail is now queued. The file is not this row's; a later row can add the sentence.
