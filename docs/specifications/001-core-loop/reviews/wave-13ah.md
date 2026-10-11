# Wave 13ah: review of the durable shutdown marker (001-275)

## Verification output

Candidate: `589844c3`, package 0.1.122, `KEY_FORMAT_VERSION = 7`. Range: `3ee7d64d..589844c3`. Initial HEAD: `8a3643525e4606e3d42f8339ab9af645480df015`. `git diff --name-only 589844c3..HEAD` lists only `docs/board.md`; all executable sources, tests, manifests and distributions match the candidate. The checkout was clean throughout verification and the external probes. Linux, Node 24.21.0, Vitest 5.0.3.

This review is bounded by 001-274, `reviews/wave-13ag.md` B1 and the brief's exit, incarnation, clearing and pruning questions. No product, test, board, spec, status or distribution file was edited. The explicitly forbidden `npm run build` was not run. Bundle reproducibility and macOS are **unverified**, not findings. Existing daemon test helpers compile private source fixtures with `tsc`; they do not rebuild the committed bundles. No eval runner or repository script was run to check evals. The independent suite includes their existing unit tests.

```text
$ npm ci
added 56 packages, and audited 57 packages in 3s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.122 lint
> biome check .
Checked 863 files in 353ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.122 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  5 failed | 395 passed | 1 skipped (401)
     Tests  6 failed | 3190 passed | 10 skipped (3206)
Duration 608.35s
FAIL test/daemon/departure-timers.test.ts:111:3: Test timed out in 5000ms.
FAIL test/harness/bundles.test.ts:168:17: session-start and session-end: Test timed out in 5000ms.
FAIL test/harness/turn.test.ts:155:3: Test timed out in 5000ms.
FAIL test/status/checkpoint.test.ts:83:3: Test timed out in 5000ms.
FAIL test/scheduler/runs.test.ts:82:65:
  expected one tier [kill.test.ts, plain.test.ts], received two tiers [plain.test.ts], [kill.test.ts]
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/scheduler/runs.test.ts test/status/checkpoint.test.ts test/harness/bundles.test.ts test/harness/turn.test.ts test/daemon/departure-timers.test.ts --maxWorkers=4 --reporter=verbose
Test Files  5 passed (5)
     Tests  64 passed (64)
Duration 6.41s
(exit 0; one unchanged targeted retry)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/final.config.mts --reporter=verbose
Test Files  3 passed (3)
     Tests  35 passed (35)
Duration 63.60s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/death.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  6 passed (6)
Duration 22.06s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/exit-retention.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration 4.96s
(exit 0; native startup-churn and no-churn control)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/legacy-token.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration 9.89s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/virtual.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  3 passed | 4 skipped (7)
Duration 10.48s
(exit 0; original reproduction and both controls)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/hold-variants.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  9 passed (9)
Duration 456ms
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/row-variants.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  3 passed (3)
Duration 16.54s
(exit 0; durable row alone, legacy-shaped note alone, wrong row and note)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-275-review/probes/pre-registration.config.mts --reporter=verbose
Test Files  1 failed (1)
     Tests  1 failed | 2 passed (3)
Duration 3.02s
FAIL candidate leaves no exit row after worktree removal
AssertionError: expected '0.1.122@1791739635459#6fd8ae0b-bccd-4b7c-9a5a-ad30a6366572' to be null
(exit 1; repeated candidate failure, pre-change and registered-worktree controls pass)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full suite is **not green**. Five failures are 5 s timeouts; the sixth is a tier-membership assertion: two files explicitly handed to one batch run in separate tiers. Every failed file passes one targeted retry with the same environment and worker cap, without edits or timeout changes. These retries do not replace the failed full gate. Load sensitivity is **plausible**, not established as the cause. Host load reached 44.50 while the full run was active; automatic Squeal validation and the brief probe replays overlapped parts of that run. The failing tests and scheduler/watch paths are unchanged in the reviewed range. No additional spec break caused by the shutdown-marker change is proven by those failures. The full run printed two fixture gitdir-repair notices and an earlier-run process cleanup. No second full suite was run.

The replay restores wave-13ag's published probe source in a private directory, substitutes this checkout and 0.1.122 for candidate paths and simulated identities, and keeps historical sources unchanged: actual 0.1.112 ledger/handlers/CLI from `cf7e8a2c`, the base wait from `6864b726`, actual 0.1.115 CLI from `2ec0efa1`, actual tokenless 0.1.116 CLI/registration/daemon from `d9fe66ba`. It uses production keys, ledgers, store, sockets and waits with controlled mutation schedules, and real candidate stop, step-down and restart. Three additional real-daemon probes isolate the new row from notes and test mismatching evidence. The cleanup probe invokes public `startDaemon` and normal `store.prune` on real linked worktrees; its pre-change control uses sources archived from `3ee7d64d`.

Replayable [probe source snapshot](/p/squeal/tasks/856a3635-c087-43f0-ba4a-77fce450f815/files?artifact=a92a4ab5-3ab6-4e5e-845a-42d8a80567a2). Complete captured [verification output snapshot](/p/squeal/tasks/856a3635-c087-43f0-ba4a-77fce450f815/files?artifact=602d7841-4ee4-4210-9060-e256618ab754).

## Verdict

**FAIL 589844c3: 1 proven blocker, 0 should-fix, 0 nits.**

Wave-13ag B1's startup-churn failure closes. The shutdown guarantee survives note eviction and retains death attribution and succession semantics in every requested replay. A new cleanup failure remains: a start that fails before registration creates a durable exit row with no worktree record, so normal removed-worktree pruning never visits it. This violates 001-274's explicit done-when, "worktree removal leaves no `daemon-exit:` row".

## Blockers

### B1. A start that fails before registration leaves an exit row normal pruning never removes

**Proven by two candidate runs, a pre-change control and a registered-worktree control.** Changed locations: `src/core/daemon/daemon.ts:554` and `:586`. The existing pre-registration failure path is `:166` to `:171`; the cleanup boundary is `src/core/store/prune.ts:77` to `:80`. The registry addition at `src/core/types/store.ts:243` correctly covers explicit `worktrees.remove(id)`, but ordinary pruning reaches that function only for IDs in `worktrees.list()`.

Deterministic reproduction, with no product edits, injected SQLite errors or fake store:

1. Create a real linked git worktree in a repository with no Squeal registration for that worktree.
2. Set its `XDG_RUNTIME_DIR` to an existing regular file, then call public `startDaemon`. `prepareSocketDir` cannot create that directory. The daemon has opened the store and acquired its lock but has not called `#register`.
3. The start-failed path calls `#shutdown`, which now unconditionally calls `#markExit`. It writes `daemon-exit:<id> = <this incarnation>` and exits cleanly with code 1. There is still no `worktrees` row for this ID.
4. Delete the linked worktree's root and run ordinary `store.prune`, with time advanced ten days, seven-day retention and no size cap.

Observed:

```text
exit = { reason: "start-failed", code: 1,
         message: "could not start serving: EEXIST: file already exists, mkdir '<runtime>'" }
before removal = { worktree: null, mark: "0.1.122@<start>#<token>" }
prune.worktreesRemoved = 0
after removal and prune = { mark: "0.1.122@<start>#<token>" }
required mark === null assertion: FAIL
```

The same socket failure under the pre-change sources (`3ee7d64d`) leaves no exit row and passes. A candidate that registers, stops, has its linked root removed and is pruned returns `worktreesRemoved = 1` and removes the row. The defect is confined to rows written before their owning registration exists. One row remains per distinct failed, never-registered worktree until another daemon successfully registers it or an explicit caller removes its ID. No false test result or false death sentence is established by this probe.

One worker's fix: ensure pre-registration failures cannot create an exit row without a prunable owner, while preserving the durable mark for an incarnation whose shutdown is in progress. Do not create a predecessor's liveness claim or delete its valid evidence merely to handle a failed successor. Add the failed-socket-start/removal/prune regression and keep the registered-worktree control, startup-churn pair, row-only proof and original death/succession cases. Ownership can stay in `daemon.ts` plus daemon/store regression tests; the coordinator owns any necessary version, key pin and bundles.

## Should-fix

None in the assigned review. The full-suite failures and their targeted recovery are verification limits above. Their causes remain unverified; the full gate must not be reported as passed.

## Nits

None.

## Answers to the brief and what fits

| Question | Independent result |
| --- | --- |
| Can note churn still turn the original clean stop into a death? | **Original wave-13ag B1 closed.** The genuine startup stop writes its marker, 25 native missing-cwd diagnostics evict its note, and SIGKILL leaves snapshot and next hook down without death. The zero-churn control also passes. A matching row with every note removed gives the same result. No assertion about failed persistence to an unusable store is made. |
| Can a wrong incarnation hide a real death? | No escape found. An ordinary-note SIGKILL still names the real held run in status and next hook. A separate real-daemon probe supplies both a wrong-incarnation row and wrong-incarnation `exitOf` note; neither hides the SIGKILL. Equality includes the start token, not merely version/time. |
| Does the held-lock SIGSTOP control remain? | **Pass.** A stale heartbeat with a process still holding the daemon lock is down without `died`. |
| Do clean stop and step-down remain down? | **Pass.** Both completed real exits clear the live registration and retain predecessor identity; restart does not spuriously adopt a complete ledger. Candidate stop and step-down killed while draining also stay down without death in snapshot and next hook. |
| Does retaining `exitOf` have a reason? | **Yes.** 0.1.121 leaves only that matching note. Removing the new row while preserving the matching shutdown note still suppresses death. Removing notes while preserving the matching row does likewise. Ordinary notes never count. |
| Does the tokenless older release retain its documented behavior? | **Pass with actual 0.1.116 daemons.** Stop and step-down killed mid-shutdown still report death and the held run. The compatibility exception remains recorded at `status.md:186`; this change does not claim to repair it. Actual 0.1.116 registration/CLI controls also pass: no inherited token and conservative fallback. |
| Is the new row cleared on registration? | Source inspection: `#register` deletes it with registration and `releaseRunning` in one transaction, except when this daemon's shutdown has already begun, preserving its own mark. The landed startup regression checks successor token change and row absence. The full independent suite includes that test. A failed start before registration cannot clear its new row and produces B1. |
| Is the new row pruned on every path? | **No, B1.** The registry is correct and a normally registered, removed worktree prunes the row; an exit row with no registered owner survives normal pruning. |
| Do the 35 succession cases remain? | **35 of 35 pass.** Older/newer/unverifiable successors before refinement or after installation, same or different revision; real sockets, same-revision ABA, crash/clean/actual-legacy-clear/unreadable-predecessor adoption, newer-writer controls, new-to-new backlog exclusion, no-incarnation sync, actual old CLI controls, and real exit/restart identity retention remain. The later-move control still refreshes membership. |
| Does wave-13ag's nearby virtual-read evidence remain valid? | **Pass.** The original restore-after-invalidate rejection and both real-adapter controls pass; all nine additional held-source identity cases pass. This range changes none of those sources. |
| Do D7 and the release metadata match the repair? | D7 replaces the accepted retention limit with durable, incarnation-bound evidence, successor clearing and removal; `status.md:189` records it. The removal promise has B1's gap. Package and both plugins are 0.1.122, both CLI bundles are byte-identical, and the key guard uses version 7 while retaining pins 1 through 6. No schema migration or runtime dependency is added. Rebuild equivalence remains unverified because building was forbidden. |

## Inputs for the next wave

Route B1 to the human, as this brief requires. If a repair is authorized, limit it to ownership of the pre-registration exit mark and its cleanup regression. Preserve the successful durable marker, atomic registration clearing, matching-note compatibility, wrong-incarnation isolation and tokenless exception. The repair's done-when must include normal pruning after a failed socket start in a never-registered linked worktree, the pre-change and registered controls, and the existing startup-churn/death/succession proofs. Carry forward the independent gate result as recorded above. Only this review file is committed.
