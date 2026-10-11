# Wave 13ag: second-round review of wave 13af (001-273)

## Verification output

Candidate: `4ab06fb8`, package 0.1.121. Range: `781a7b87..4ab06fb8`. Actual initial HEAD: `61566daa8d7d61ab6f23a405f300c6c4e0cd226c`. As the assignment allows, documentation follows the candidate: `git diff --name-only 4ab06fb8..61566daa` lists only `docs/board.md`. All executable files match the candidate. Linux, Node 24.21.0, Vitest 5.0.3. The checkout was clean during verification and the external probes.

This re-review is bounded by `reviews/wave-13af.md` B1, B2 and S1. Interleaved spec 006 changes are outside that scope; their unit tests are included in the independent suite. No eval runner or repository script was run to check evals. The explicitly forbidden `npm run build` was not run. Bundle reproducibility and macOS remain **unverified**, not findings. Existing daemon test helpers compile private source fixtures; no committed distribution was rebuilt. No product, test, board, spec, status or distribution file was edited.

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.121 lint
> biome check .
Checked 862 files in 217ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.121 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  1 failed | 398 passed | 1 skipped (400)
     Tests  1 failed | 3190 passed | 9 skipped (3200)
Duration 540.11s
FAIL test/harness/starting-daemon.test.ts:119:3
  says no daemon is validating when the daemon heartbeat and then stopped within the grace
Error: Test timed out in 5000ms.
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/harness/starting-daemon.test.ts --maxWorkers=4 --reporter=verbose
Test Files  1 passed (1)
     Tests  10 passed (10)
Duration 4.86s
(exit 0; retry 1)
Test Files  1 passed (1)
     Tests  10 passed (10)
Duration 4.98s
(exit 0; same command, retry 2)
Test Files  1 passed (1)
     Tests  10 passed (10)
Duration 5.57s
(exit 0; same command, retry 3)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-273-probe/final.config.mts --reporter=verbose
Test Files  3 passed (3)
     Tests  35 passed (35)
Duration 41.34s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-273-probe/death.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  6 passed (6)
Duration 6.01s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-273-probe/virtual.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  3 passed | 4 skipped (7)
Duration 8.77s
(exit 0; original reproduction and both controls)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-273-probe/legacy-token.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  2 passed (2)
Duration 3.30s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-273-probe/hold-variants.config.mts --reporter=verbose
Test Files  1 passed (1)
     Tests  9 passed (9)
Duration 1.15s
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-273-probe/exit-retention.config.mts --reporter=verbose
Test Files  1 failed (1)
     Tests  1 failed | 1 passed (2)
Duration 1.78s
AssertionError: expected { state: 'down', ... } to not have property "died"
(exit 1; real shutdown-marker eviction; no-churn control passes)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full suite is **not green**. Its one failure is a 5 s timeout, not an assertion failure; the unchanged file passes three independent targeted runs without changing its timeout. Load sensitivity is **plausible**, not established as the cause. This is not a proven break of the assigned repair. The coordinator's reported slow/permits timeout did not recur. The full run printed two fixture gitdir-repair notices and one earlier-run process cleanup. None caused another failure. These retries do not replace the failed full gate. No second full suite was run.

The 35-probe replay restores the published first-round source, updates simulated candidate versions to 0.1.121 and raises the real step-down request above that version. It preserves actual 0.1.112 ledger/handler/CLI sources from `cf7e8a2c`, the base wait from `6864b726`, and the actual 0.1.115 CLI from `2ec0efa1`. The supplementary compatibility and mid-shutdown probes use the actual 0.1.116 CLI/registration sources from `d9fe66ba`. Historical sources are unchanged. Production keys, ledgers, store, sockets and waits are used with controlled mutation schedules; real candidate stop, step-down and restart remain in the replay.

Replayable [probe source snapshot](/p/squeal/tasks/7ac973ae-08f5-49c6-ac59-0ceb2f9028a8/files?artifact=09001cf6-200e-4c1f-aaef-980cbe390e0f). Complete captured [verification output snapshot](/p/squeal/tasks/7ac973ae-08f5-49c6-ac59-0ceb2f9028a8/files?artifact=72c21793-d09f-4220-9fdc-341905dc0cdc).

## Verdict

**FAIL 4ab06fb8: 1 proven blocker, 0 should-fix, 0 nits.**

B2 and S1 close. B1's original ordinary-note-before-SIGKILL failure closes, but its replacement shutdown evidence can be erased by ordinary diagnostics during shutdown. A real candidate then falsely tells status and the next hook that it died without shutting down. This is a variant opened by the B1 repair, not a reopening of settled succession or key semantics. Second-round blocker: the human decides the next step.

## Blockers

### B1. Ordinary startup diagnostics can evict the only shutdown marker

**Proven by a real source daemon, native node:test diagnostics, public status snapshot and next hook, with a no-churn positive control.** Locations: `src/core/daemon/daemon.ts:550` to `:551`, `src/core/status/died.ts:38`; retention boundary: `src/core/notes.ts:35` and `:42`. The eviction function predates this range; making that rolling list the only source of shutdown evidence is the changed dependency.

D7 now promises: "one stopped or killed while it shut down is down, not dead". The repaired daemon writes its matching `exitOf` marker before awaiting `#starting`, but startup can still produce diagnostics after that write. The list keeps only the newest `MAX_PERSISTED_NOTES` (20). `withDeath` knows shutdown happened only while the marker remains in that list.

Deterministic reproduction, with no injected notes or product edits:

1. Configure 25 node:test projects whose declared working directories are absent, plus one project at the root. These are supported runner-failure states, each producing the native "cwd missing-N is not a directory; the project is skipped until that changes" note. The last project's configured Node executable is a wrapper that holds its version probe until an external flag appears.
2. Start the real candidate daemon in a child process through `startDaemon`, then immediately call its public `stop("stop-requested")` while startup is pending. The driver reads the real registration and notes synchronously after calling stop; the probe asserts that `exitOf` matches this exact incarnation. Shutdown has begun and its marker exists.
3. Startup continues while `#shutdown` awaits `#starting`. Wait until the executable probe is held and the note list contains the 20 newest native missing-cwd diagnostics. The matching marker is gone; the daemon has not exited or cleared its registration.
4. SIGKILL that child and await its actual signal exit. At a stale-heartbeat offset, read the snapshot and run the next session-start hook with daemon ensuring disabled.

Observed:

```text
snapshot.daemon = { state: "down", since: <heartbeat>, died: { runs: [] } }
next hook = "The last daemon died without shutting down, between runs."
required no-death assertion: FAIL
```

The empty run list is correct for this startup case; the assertion is about shutdown attribution. The same real startup, held executable probe, stop and SIGKILL with **zero missing-cwd projects** retains its matching marker. Its snapshot is down without `died`, and its next hook has no death sentence. That control passes. The preliminary reproduction and the final paired probe both reproduce eviction. Fully completed stop and step-down controls still clear the live registration and do not claim a death.

One worker's fix: keep incarnation-bound shutdown evidence until that incarnation's live registration is cleared, independently of the rolling diagnostic list, or otherwise guarantee that retaining 20 later diagnostics cannot erase it. Preserve ordinary-note SIGKILL reporting, wrong-incarnation isolation, the held-lock SIGSTOP case, clean exits and the documented tokenless behavior. Add this native-startup churn reproduction and its no-churn control. Changing death wording alone would not repair the lost distinction.

## Should-fix

None in the assigned re-review. The full-suite timeout and its retries are recorded above; its cause remains unverified.

## Nits

None.

## Answers to the brief and what fits

| Question / prior finding | Independent result |
| --- | --- |
| Does the original B1 ordinary watcher note still hide a real death? | **Closed for that reproduction.** With the note present, both snapshot and next hook name the real SIGKILL and held test's run. Removing only the note leaves the same correct death attribution. The original SIGSTOP control still holds the lock and is not called dead. |
| Can an exit path still name a shutdown as a death? | **Yes, B1 above.** Normal token-bearing stop/step-down killed while draining retain their matching marker and read down without death. Fully completed exits clear the live registration. Native startup note churn can erase that marker before shutdown finishes, causing false death. |
| Does a pre-token registration killed mid-shutdown read as dead? | **Verified with actual 0.1.116 daemon processes**, for both stop and step-down. Each has no token, emits its real old shutdown note, and is SIGKILLed with a file held mid-tier. Candidate snapshot and next hook report death and name that held file's run. This matches the explicit compatibility amendment at `status.md:186`; it is not treated as a blocker. |
| Does original B2 now reject the virtual module's old-byte result after invalidate and restore? | **Closed.** The original real adapter probe now returns no completed files or results and names `src/mod.ts changed on disk after this run loaded it`. No-invalidate/restore rejects the same way. Invalidate without restore retains the legitimate old-byte assertion failure with `failure: null`. |
| Can another read identity in the changed hold path escape the end check? | No escape found in the tested variants. Nine additional probes cover file, query and `\0` file IDs, virtual inputs first stamped by invalidate or already stamped, repeated holds, a later load of the same virtual ID, different project containers reading one input, multiple declared inputs, and unchanged bytes. These use controlled Vite graph/container shapes and real disk stats/hashes through public `SourceStamps`, not full adapter runs. The original virtual probe and landed suite provide the real-adapter evidence. |
| What preserves those distinctions in B2? | Source inspection: `hold` keeps each virtual load's own input map, original load time and optional stamp (`sources.ts:149`); the end check uses the stamp produced by the pre-drop check when it was not yet available at hold time (`:232`). Held stamps survive a later load replacing the container's current entry. Unknown-read detection and cached-module checks remain; the repair does not broaden the existing contract to undeclared plugin reads or every opaque cache. |
| Are S1's D3, D5 and D7 amendments present? | **Closed.** D3 documents display-only config and built-in reporter exclusions while preserving outcome-changing inputs. D5 documents fresh per-call baseline/retry bounds, late-reply abandonment, and virtual declared-input retention. D7 documents token-bearing incarnation, tokenless fallback/adoption, sequence-driven window refresh and shutdown markers. Five dated amendments at `status.md:182` to `:186` record the contracts, including the tokenless shutdown exception. Schema V1 and first-commit adoption are preserved. |
| Do the 35 succession probes still hold? | **35 of 35 pass.** All twelve older/newer/unverifiable successor combinations, before refinement or after installation, at one or across revisions, remain. Real-socket succession, same-revision ABA, old-then-new adoption after crash/clean/actual legacy clear/unreadable predecessor, newer-writer controls, new-to-new backlog exclusion, no-incarnation sync, actual old CLI controls and real exit/restart identity retention remain. The later-move control still refreshes membership and waits. |
| Are the additional actual 0.1.116 token controls retained? | **2 of 2 pass.** Its actual registration cannot claim a leftover token even at equal start time; its actual CLI falls back against the candidate's token-bearing answer. |

`KEY_FORMAT_VERSION = 6` remains pinned in place as requested for an unreleased format; versions 1 through 5 are unchanged. The full suite's guard accepts the new pin. Package/plugin version 0.1.121 and both byte-identical CLI bundles agree. No new runtime dependency or schema migration is introduced. Rebuild equivalence remains unverified because building was forbidden.

## Inputs for the next wave

Route B1 to the human. Do not dispatch another repair under the first-round standing rule: this is the second round. If authorized, one worker can own durable shutdown evidence, its note/registration boundary and death regressions; the coordinator owns any necessary amendment, version/pin update and bundle rebuild. Its done-when must include native diagnostic churn during pending startup, the no-churn control, original ordinary-note death and clean stop/step-down controls, actual tokenless compatibility, lint/typecheck and the independent suite. B2, S1 and the 35 succession cases need no further design work unless that fix changes their boundaries. Only this review file is committed.
