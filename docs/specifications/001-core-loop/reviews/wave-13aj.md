# Wave 13aj: review of the orphan exit mark (001-279)

## Verification output

Candidate: `466bb30b56b829e1a12c074a4a7fe25d95c008d3`, package and both plugins 0.1.124, `KEY_FORMAT_VERSION = 7`. Range: `bca8b06d..466bb30b`. Initial HEAD was `e61b3d7c6a777eac1adc0c8ac200a4b68c1afcc7`; only `docs/board.md` differed. Before verification, the reviewer checked out the exact candidate on `cez/95c01a17-review`. The tree stayed clean during all executable checks and external probes. Linux, Node 24.21.0, Vitest 5.0.3.

Bounded by 001-278, wave-13ai N1 and the brief's pruning, exit, death and succession questions. No product, test, board, spec, status or distribution file was edited. The explicitly forbidden `npm run build`, eval runner and repository scripts to check evals were not run. Existing daemon test helpers compile private source fixtures with `tsc`. Bundle reproducibility and macOS remain **unverified**, not findings. Spec 006's unit tests are included in the independent suite; its implementation is outside this review.

```text
$ npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; unapproved @parcel/watcher and esbuild install-script warnings)

$ npm run lint
> squeal@0.1.124 lint
> biome check .
Checked 868 files in 283ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.124 typecheck
> tsc --noEmit
(exit 0)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --maxWorkers=4
Test Files  406 passed | 1 skipped (407)
     Tests  3250 passed | 9 skipped (3259)
Duration 494.63s
(exit 0)

$ cmp plugins/claude-code/dist/cli/squeal.mjs plugins/codex/dist/cli/squeal.mjs
(no output, exit 0)
```

The independent full gate is green. Two fixture gitdir-repair notices and one earlier-run process cleanup appeared without a test failure. No retry or second full suite was run. External probes ran sequentially after the full suite, under the same environment, with one worker per config.

```text
$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null npx vitest run --config /tmp/squeal-001-279-review/probes/<name>.config.mts --reporter=verbose
```

| Config | Output | Duration | Exit |
| --- | --- | --- | --- |
| `prune-before-stop` | 1 file passed; 2 tests passed | 3.02 s | 0 |
| `pre-registration` | 1 file passed; 3 tests passed | 2.84 s | 0 |
| `failed-successor` | 1 file passed; 3 tests passed | 1.16 s | 0 |
| `exit-retention` | 1 file passed; 2 tests passed | 1.98 s | 0 |
| `row-variants` | 1 file passed; 3 tests passed | 3.43 s | 0 |
| `death` | 1 file passed; 6 tests passed | 7.23 s | 0 |
| `final` | 3 files passed; 35 tests passed | 40.41 s | 0 |
| `legacy-token` | 1 file passed; 2 tests passed | 3.52 s | 0 |
| `virtual` | 1 file passed; 3 tests passed, 4 skipped | 8.85 s | 0 |
| `hold-variants` | 1 file passed; 9 tests passed | 264 ms | 0 |
| `gap` | 1 file passed; 4 tests passed | 1.90 s | 0 |
| `orders` | 1 file passed; 9 tests passed | 9.52 s | 0 |
| `crash-orders` | 1 file passed; 4 tests passed | 6.05 s | 0 |
| `stop-timing` | 1 file passed; 2 tests passed, 12 measured exits | 10.35 s | 0 |

**87 passed, 4 skipped across 14 configurations.** The earlier probe sources were restored from wave-13ai's published snapshot. Only candidate paths and simulated candidate identities were updated to this checkout and 0.1.124. Historical sources remain unchanged: 0.1.112 from `cf7e8a2c`, the base wait from `6864b726`, 0.1.115 from `2ec0efa1`, tokenless 0.1.116 from `d9fe66ba`, the pre-durable-row control from `3ee7d64d`, and the pre-registration-fix control from `be1aad84`. The prune regression and bundle timings use the actual immediate range base `bca8b06d`, version 0.1.123. New ordering controls use public daemon/store calls, real linked worktrees and real crashes. The retained gap probe forces desk-open and cleanup timing with Node load hooks; daemon source, SQLite semantics, keys and status stay unchanged.

Replayable [probe source snapshot](/p/squeal/tasks/95c01a17-e049-4c7d-9305-f20f3062598f/files?artifact=e059adc1-bf72-4403-8b90-2becd69ef9be). Full suite and probe [verification output snapshot](/p/squeal/tasks/95c01a17-e049-4c7d-9305-f20f3062598f/files?artifact=dea90091-7dad-4cae-abbc-89ea70642751).

## Verdict

**PASS 466bb30b: 0 proven blockers, 0 should-fix, 0 nits.**

Wave-13ai N1 closes for this candidate. Pruning a running daemon's owner before stopping it no longer recreates an unreachable `daemon-exit:` row. Requested startup, death, succession and virtual-read replays retain their distinctions. No candidate-created orphan or loss of needed shutdown evidence was found in the tested orders.

The answer to the brief's broad question needs one scope limit: an orphan already written by an older daemon still survives normal prune. The worker took the explicitly offered first fix and skipped the optional sweep. This is **proven pre-existing behavior**, not a blocker against that choice. A blanket claim that this candidate cleans every historical orphan would be false.

## Blockers

None.

## Should-fix

None in the assigned repair.

## Nits

None.

## The lock argument and the transaction boundary

**Supported by source inspection and real lock-loser/restart probes for production callers.** The worker's argument is correct for an already-registered daemon whose worktree row is removed while it runs:

1. `src/core/daemon/daemon.ts:284` is the only production caller of `worktrees.upsert`; the sole SQL insert is `src/core/store/repos/worktrees.ts:86`. That daemon registers once, before `#registered` becomes true at `daemon.ts:301`. Heartbeat and final `setDaemon(null)` only update an existing owner (`worktrees.ts:112` and `:128`), so neither recreates one.
2. A successor takes the same per-worktree singleton lock before opening the store (`src/core/daemon/open.ts:86`). Prune and `worktrees.remove` do not release or remove that lock. Shutdown releases it last, after the old store connection closes (`daemon.ts:574` to `:576`). In the four cleanup-before-exit controls, a second start against the still-existing or restored root returns `lost-lock` and creates no owner. A start after exit registers successfully and has no old mark.
3. Existence and mark creation now share a `BEGIN IMMEDIATE` write transaction (`daemon.ts:597`; `src/core/store/connection.ts:41`). Removal also deletes owner and registered meta rows in one transaction (`worktrees.ts:146`; `daemonExit` is registered at `src/core/types/store.ts:243`). If removal commits first, marking finds no owner and writes nothing. If marking commits first, removal deletes both. Another writer cannot commit between the check and write. This transaction, rather than the singleton lock alone, closes the original prune/write race.
4. The pre-registration socket gap is a separate case. A stop before registration writes no mark through `#markExit`; subsequent `#register` commits its own owner and matching mark together (`daemon.ts:277` to `:300`). All four forced stop/step-down cases, with and without predecessor evidence, still pass. Thus a registration can follow an earlier prune during startup, but it does not commit an ownerless mark.

This argument concerns Squeal's production callers. The store API exposes `upsert` and does not enforce the daemon lock on an arbitrary external writer. No production path or requested replay supplies such a writer. The candidate needs no extra incarnation comparison in the existence guard under the established singleton contract.

## Answers to the brief and what fits

| Question | Independent result |
| --- | --- |
| Is the original prune-before-stop orphan repaired? | **Proven closed.** The same real linked-worktree schedule on the actual 0.1.123 range base leaves `{worktree: null, mark: "0.1.123@<start>#<token>"}` after stop and a second prune. Candidate 0.1.124 leaves `{worktree: null, mark: null}`. The base test deliberately asserts its defect; the candidate test requires absence. |
| Can prune or explicit owner removal before/after stop or step-down recreate a mark? | **No in all eight tested combinations.** Cleanup-before-exit suppresses the mark; exit-before-cleanup writes a valid mark and cleanup removes it. A second prune finds no mark. Each case restores or retains the root, restarts successfully with no old mark, then stops and prunes that new owner normally. |
| Can crash and restart reopen the orphan ordering? | **No in four real SIGKILL cases:** prune or explicit removal, each before or after crash. A crash with its registration retained still reads as death. Cleanup removes the owner without leaving a mark, restart registers without old evidence, and its later stopped owner prunes cleanly. Source inspection supports the crash boundary: an uncommitted SQLite mark transaction rolls back on process death; a committed mark remains owned until removal. |
| Does a failed socket start before registration still leave no mark? | **Yes.** Original candidate/prior/registered controls pass, including normal prune after deleted linked roots. Failed-successor controls preserve predecessor evidence and create no mark when no predecessor exists. The actual pre-registration-fix baseline still reproduces its old orphan. |
| Can the socket/register gap drop a registered daemon's needed evidence? | **No in the four forced schedules.** Stop and step-down before registration preserve predecessor evidence until the new owner and matching mark commit together. After every diagnostic note is removed and the child is killed, status is down without `died`. Normal removed-root prune then removes that owned row. |
| Does startup note churn still read down? | **Yes.** Both zero-churn and 25-native-missing-cwd-diagnostic controls remain down after a SIGKILL during shutdown, in snapshot and next hook. The latter evicts the note while retaining the durable mark. Row-only and matching-note-only controls pass; wrong-incarnation row and note do not hide a real death. |
| Are ordinary-note SIGKILL, SIGSTOP and tokenless behavior retained? | **Yes.** Ordinary diagnostics do not hide SIGKILL or its held run from snapshot and next hook. A stale-heartbeat SIGSTOP still holds the lock and is not called dead. Actual 0.1.116 stop/step-down killed while draining still report death under the documented compatibility exception; actual tokenless registration/CLI controls pass. |
| Do death and succession distinctions still hold? | **All 6 death and 35 succession probes pass.** Older/newer/unverifiable successors, before refinement or after window installation, same/different revision, ABA, predecessor adoption and its controls, actual old CLIs, later-move refresh, and real clean stop/step-down/restart retain their earlier behavior. |
| Do wave-13ag's adjacent virtual-read controls hold? | **Yes.** The real-adapter invalidate/restore reproduction and both controls pass; nine held-source identity variants pass. This diff changes none of that boundary. |
| Does normal prune clean marks an older daemon already orphaned? | **No, intentionally.** A real 0.1.123 base daemon creates the orphan; the candidate store's normal prune still removes zero owners and retains it. Restoring the root and successfully registering the candidate clears it; subsequent stop/removal/prune is clean. Explicit `worktrees.remove(id)` also deletes the exact registered meta key even without an owner. A historical sweep was an optional alternative, not part of the selected fix. |
| Are format, versions and bundles consistent? | **Yes for inspected content and the full suite's guard.** Version 7 is re-pinned in place as requested for the unreleased format; pins 1 through 6 are unchanged. Package and both plugins are 0.1.124. Both byte-identical CLI bundles contain the transaction/existence guard. No schema, public type or runtime dependency change is introduced. Rebuild equivalence remains unverified because building was forbidden. |

Actual bundle measurements alternate the 0.1.123 base and 0.1.124 candidate across three rounds. All candidate samples are below `remove`'s 5-second wait; three samples do not establish a latency distribution.

| Request through process exit, ms | Base 0.1.123 | Candidate 0.1.124 |
| --- | --- | --- |
| Stop | 182.1, 205.5, 239.1 | 163.5, 205.4, 186.7 |
| Step-down | 202.6, 206.9, 178.0 | 183.4, 161.9, 166.6 |

## Inputs for the next wave

No fix wave is needed for 001-278. Retain the new mark transaction and the existing atomic owner/mark registration, exact meta-row removal, final lock-release order and tokenless compatibility behavior. If the human later wants cleanup of historical orphans, that is a separate optional sweep task; this review does not certify it as implemented. No blocker needs escalation. Only this review file is committed.
