# Wave 13ai: second-round review of pre-registration shutdown evidence (001-277)

## Verification output

Candidate: `6bad4eba`, package and both plugins 0.1.123, `KEY_FORMAT_VERSION = 7`. Range: `be1aad84..6bad4eba`. Initial HEAD: `9344162a65f2efc4dd7ea9ad85d1c251f302bfc3`; `git diff --name-only 6bad4eba..HEAD` lists only `docs/board.md`. Executable sources, tests, manifests and distributions match the candidate. The checkout stayed clean during verification and the external probes. Linux, Node 24.21.0, Vitest 5.0.3.

Bounded by wave-13ah B1 and 001-277's before/after-registration questions. Interleaved spec 006 changes are outside this review; their unit tests are included in the independent suite. No product, test, board, spec, status or distribution file was edited. The forbidden `npm run build`, eval runner and repository scripts to check evals were not run. Existing daemon test helpers compile private source fixtures with `tsc`. Rebuild equivalence and macOS are **unverified**, not findings.

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.123 lint
> biome check .
Checked 874 files in 336ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.123 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  1 failed | 405 passed | 1 skipped (407)
     Tests  1 failed | 3244 passed | 10 skipped (3255)
Duration 631.98s
FAIL test/harness/codex/turns.test.ts:47:3
  speaks once over three calls of one batch with one transition
Error: Test timed out in 5000ms.
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run test/harness/codex/turns.test.ts test/cli/remove.test.ts --maxWorkers=4 --reporter=verbose
Test Files  2 passed (2)
     Tests  25 passed (25)
Duration 4.75s
(exit 0; one targeted retry, unchanged timeouts)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

Each external row below ran as:

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-277-review/probes/<name>.config.mts --reporter=verbose
```

| Config | Output | Duration | Exit |
| --- | --- | --- | --- |
| `pre-registration` | 1 file passed; 3 tests passed | 2.44 s | 0 |
| `failed-successor` | 1 file passed; 3 tests passed | 1.47 s | 0 |
| `exit-retention` | 1 file passed; 2 tests passed | 2.02 s | 0 |
| `row-variants` | 1 file passed; 3 tests passed | 5.37 s | 0 |
| `death` | 1 file passed; 6 tests passed | 7.75 s | 0 |
| `final` | 3 files passed; 35 tests passed | 41.01 s | 0 |
| `legacy-token` | 1 file passed; 2 tests passed | 3.51 s | 0 |
| `virtual` | 1 file passed; 3 tests passed, 4 skipped | 8.76 s | 0 |
| `hold-variants` | 1 file passed; 9 tests passed | 255 ms | 0 |
| `gap` | 1 file passed; 4 tests passed | 15.58 s | 0 |
| `prune-before-stop` | 1 file passed; 2 tests assert the existing residual below | 4.45 s | 0 |
| `stop-timing` | 1 file passed; 2 tests passed, 12 measured exits | 11.08 s | 0 |

The independent full gate is **not green**. Its one failure is a timeout in an unchanged file; that file passes the targeted retry without edits. Load sensitivity is **plausible**, not established as the cause. The coordinator's `cli/remove.test.ts` failure did not recur in either the independent full suite or the targeted run. No second full suite was run, and the targeted pass does not replace the failed gate. Automatic Squeal validation overlapped the full suite; host load reached 28.56 at one observation. Two gitdir-repair notices and one earlier-run process cleanup appeared without another test failure.

Squeal separately completed its revision-0 checkpoint and last reported one known failure, an unchanged `test/harness/codex/hooks.test.ts` PostToolUse timeout. Its two e2e timing failures recovered under the same inputs. That checkpoint does not replace this independent run.

The prior probes were restored privately, with candidate paths and simulated identities changed to this checkout and 0.1.123. Historical sources remain unchanged: 0.1.112 from `cf7e8a2c`, the base wait from `6864b726`, 0.1.115 from `2ec0efa1`, and tokenless 0.1.116 from `d9fe66ba`. The original orphan probe keeps its pre-durable-row control from `3ee7d64d`; additional comparisons use the actual immediate base `be1aad84`. The controller restart interrupted one incomplete succession replay; only its complete replay is counted. Initial gap-harness attempts needed missing filesystem imports and seed-store creation; they are not candidate failures.

Replayable [probe source snapshot](/p/squeal/tasks/18acb54c-b806-4c7d-9d3b-a99fb4eb1832/files?artifact=aa217bc1-7a87-46ce-aa27-d4c9b2d4fdfa). Complete captured [verification output snapshot](/p/squeal/tasks/18acb54c-b806-4c7d-9d3b-a99fb4eb1832/files?artifact=aaefb363-c934-477c-9967-a7a1e61ecbf6).

## Verdict

**PASS 6bad4eba: 0 proven blockers, 0 candidate should-fix, 0 nits. One proven pre-existing note.**

Wave-13ah B1 closes. A failed socket start in a never-registered linked worktree leaves no exit row before or after normal pruning. A stop or step-down forced before registration preserves predecessor evidence until registration, then commits its own matching evidence with its owner. Requested death, note-churn, succession and virtual-read replays pass. No several-second stop regression is observed.

The answer to the broader question, "can any after-registration exit still leave a row no prune reaches?", is **yes**, in the pre-existing ordering below. It occurs on `be1aad84` as well as the candidate, so it is a note rather than a blocker against 001-276. This PASS does not certify every possible removed-worktree ordering as orphan-free.

## Blockers

None in the assigned repair.

## Should-fix

None introduced by the candidate. The full-suite timeout remains a verification limitation.

## Pre-existing note

### N1. Pruning a running daemon's owner before its stop recreates an orphan

**Proven on both `be1aad84` and `6bad4eba`, with public daemon and store calls, no product edits or mocked store.** Locations: `src/core/daemon/daemon.ts:559` and `:594`, and `src/core/store/prune.ts:77`. The new `#registered` flag at `:592` remembers a successful registration; it does not track whether another connection subsequently removed that owner. The same mark write before this guard already has the defect.

Reproduction:

1. Start a real daemon in a linked worktree and await readiness. Public `timings.checkMs = 60000` keeps the root-deletion check from racing the controlled schedule.
2. Delete that linked root, then run normal `store.prune`. It removes one worktree and its mark; both owner and mark are absent.
3. Call the still-running daemon's public `stop("stop-requested")`. Its registered incarnation writes a new mark, but clearing its registration updates no row because prune already deleted it.
4. Run normal prune again, ten days on with seven-day retention and no cap. It sees zero worktrees to remove, and the mark remains.

```text
base      = { worktree: null, mark: "0.1.122@<start>#<token>" }
candidate = { worktree: null, mark: "0.1.123@<start>#<token>" }
second prune.worktreesRemoved = 0
```

The two probe tests assert this residual so that both baseline and candidate behavior are recorded. Their green result does not mean orphan cleanup works in this ordering. No false result or death sentence is established; the missing owner makes the mark irrelevant to death classification. It remains a cleanup limitation.

If the human chooses to close it, one worker can make mark creation and a current matching-owner check one transaction, or add the brief's optional exact-prefix orphan cleanup to prune. Preserve registration's atomic mark replacement and the row-only shutdown guarantee. Include prune-before-stop on a deleted linked root and the opposite stop-before-prune control. The optional orphan sweep was not taken in 001-276.

## Nits

None.

## Answers to the brief and what fits

| Question | Independent result |
| --- | --- |
| Is wave-13ah B1's failed-socket orphan closed? | **Yes.** The original candidate/prior/registered-control replay passes 3 of 3. Candidate failure has `worktree: null, mark: null`; normal prune removes zero owners and no mark survives. The actual immediate base still creates an orphan in the additional control. |
| Can a failed successor overwrite or clear its predecessor's valid evidence? | **No in the tested failed-socket path.** A seeded predecessor's mark survives unchanged. With no predecessor, the failure creates no mark. `#register` remains the only successful-start clearing boundary. |
| Does the socket/register gap lose the new daemon's shutdown evidence? | **No in all four forced cases:** stop and step-down, each with and without a predecessor. The real socket accepts the request while the desk's open result is held; shutdown begins before registration. The pre-registration record/mark remain unchanged. The registration transaction then commits its own token-bearing record and matching mark together. After removing every note and SIGKILLing the child, the snapshot is down without `died`; deleting the root and pruning removes one owner and its row. |
| How was that gap forced? | A Node load hook wraps only the private fixture's real desk open result and cleanup promise, plus transaction completion observation. It holds open until the real request starts shutdown and holds cleanup to observe registration. `daemon.ts`, keys, status, handlers and SQLite behavior remain unchanged. This verifies the branch under a forced schedule; it does not measure how often ordinary startup reaches it. |
| Can a registered daemon still leave an unreachable mark after its owner was pruned? | **Yes, N1, already present at the range base.** Ordinary stop-before-removal/prune is clean. Prune-before-stop can recreate the mark. No blanket orphan-free claim is made. |
| Can note churn turn a known shutdown into a death again? | **No in the original reproduction.** Both zero-churn and 25-native-diagnostic cases pass after the child is killed while shutdown waits for startup. The row-only probe still works with every note removed. |
| Can a wrong incarnation hide a real death? | **No in the replays.** Wrong row and wrong note do not suppress the actual SIGKILL; an ordinary-note death still names the held run in status and the next hook. The matching-note-only compatibility case remains valid. |
| Does held-lock SIGSTOP remain down without death? | **Yes.** The original live-lock control passes. |
| Are clean stop, step-down, restart and legacy behavior retained? | **Yes.** Completed exits clear live registration and retain predecessor identity; restart clears the old mark and avoids spurious ledger adoption. Candidate exits killed while draining stay down without death. Actual tokenless 0.1.116 stop/step-down killed while draining still report death under the documented compatibility exception; its actual registration and CLI controls pass. |
| Do succession and the nearby virtual-read probes remain valid? | **Yes.** All 35 succession cases, original virtual invalidate/restore rejection and both real-adapter controls, and nine held-source identity variants pass. No changed boundary reopens wave-13ag B2 or S1. |
| Did 001-276 make stop slower enough to explain the coordinator's failure? | **No such slowdown observed.** `remove` passed in the full suite and targeted retry. The actual bundles' paired request-to-process-exit samples are below; the changed ordinary exit path adds a synchronous boolean guard and no wait. Three samples per build/path cannot establish a precise latency distribution. |
| Do the format pin and bundles match? | Version 7 is re-pinned in place as explicitly requested for the unreleased format; pins 1 through 6 remain. The full suite's key guard passes. Package and both plugins are 0.1.123; CLI bundles are byte-identical and contain the guard, post-commit flag and gap transaction write. Rebuild equivalence remains unverified. No schema migration, runtime dependency or public type change is added. |

Actual plugin-bundle stop measurements alternate the two versions across three rounds. Every candidate sample is below `remove`'s 5-second wait.

| Request through process exit, ms | Base 0.1.122 | Candidate 0.1.123 |
| --- | --- | --- |
| Stop | 241.2, 236.5, 248.0 | 247.1, 240.6, 350.5 |
| Step-down | 205.5, 182.8, 169.2 | 205.6, 189.0, 194.3 |

## Inputs for the next wave

No fix wave is needed for wave-13ah B1. Carry the failed independent gate and successful targeted retry separately; CI and Squeal do not turn that gate into a pass. Do not claim that all exit/prune orderings are clean. N1 has been reported to the parent as a pre-existing cleanup limitation; any separate task should preserve the successful gap, startup-churn, predecessor-evidence, wrong-incarnation, legacy and succession proofs above. Only this review file is committed.
