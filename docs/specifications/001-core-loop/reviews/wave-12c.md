# Wave 12c re-review: daemon handover

Candidate: `7f62b20215c959f7545e893cef37681238ade897` (0.1.34). Re-review bounded by `reviews/wave-12b.md`, chiefly B1 and S1. Reviewed 001-130's original `ca19ee0..7f976a3` as landed in `0ce9728`, `c5ae51d`, `f20ed30`, `4fb77cc`, plus both committed plugin bundles in `7f62b20`.

**FAIL: 1 proven blocker (prior B1 remains), 1 proven nonblocking wording note (S1 partly remains), 1 proven provenance nit.** No plausible or unverified product finding. Per 001-131's brief, the remaining blocker goes to the human; this review does not start another fix round.

## Verification output

All verification and product probes ran on a clean detached checkout of the exact candidate. The initial assigned HEAD mismatch is N1 below. The build left tracked files unchanged. The assigned branch was restored after verification for this findings-only commit. Throwaway probes and archived released bundles lived in ignored `node_modules/.cache/wave12c/`; they were removed before this file was committed. Only private fixture daemons were started, signalled or stopped.

```text
$ git rev-parse HEAD
7f62b20215c959f7545e893cef37681238ade897

$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.

$ npm run lint
> squeal@0.1.34 lint
> biome check .
Checked 542 files in 167ms. No fixes applied.

$ npm run typecheck
> squeal@0.1.34 typecheck
> tsc --noEmit

$ npm run build
> squeal@0.1.34 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.34 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts

$ git status --porcelain
(no output)

$ npx vitest run
Test Files  210 passed | 1 skipped (211)
Tests       1724 passed | 10 skipped (1734)
Start at    16:09:00
Duration    136.59s (tests 96%, transform 3%, import 1%)
```

The full suite printed two fixture `repair: gitdir incorrect` lines and exited 0. One full suite was run. The prior out-of-range timing failure did not recur.

Additional discriminating probes on the same clean candidate:

```text
$ npx vitest run --config node_modules/.cache/wave12c/vitest.config.ts
Test Files  1 passed (1)
Tests       12 passed (12)
Start at    16:13:26
Duration    28.33s (tests 98%, transform 1%, import 1%)

$ npx vitest run --config node_modules/.cache/wave12c/vitest.config.ts -t 'released step-down protocol'
Test Files  1 passed (1)
Tests       2 passed | 12 skipped (14)
Start at    16:14:21
Duration    12.85s (tests 97%, transform 2%, import 1%)

Two concurrent current hook bundles:
waiting successors: 2; hook durations: 65.14 ms, 70.44 ms
eventual daemon: 0.1.34; one surviving successor
old tier: 5006.77 ms, stored pass at revision 0

Released bundle lock timeout:
--await-lock 350; process elapsed 477.00 ms including startup
exit 0; one persisted note naming 350 ms; holder PID unchanged

Released 0.1.33 tier handover:
Claude Code: 58.57 ms hook; successor 0.1.34; stored pass
Codex: 68.13 ms hook; successor 0.1.34; stored pass

B1 forced interleaving, repeated successfully:
0.1.32 -> 0.1.34 request -> 0.1.31
newer successor resumed, then exited; final daemon remained 0.1.31
notes: ["daemon stopped: squeal stop"]
```

The B1 probe deliberately asserts the bad final version to establish the counterexample. Green probe output is not evidence that B1 is fixed. Earlier versions of the throwaway probes failed because the slow fixture was outside its test glob and then because the probe read `check.testFile.path` instead of `check.testPath`; both probe mistakes were corrected before the final runs above. Neither was a product finding.

## Blockers

### B1. Proven, still blocking: a released older contender wins and the requesting successor abandons the upgrade

Location: `src/core/daemon/open.ts:140`, with the loser exit at `open.ts:82`; `src/core/daemon/lock.ts:76` provides retry polling, not a reserved handover. The requesting hook does spawn its CLI at `src/harness/shared/ensure.ts:93`.

001-130 outcome: "asking an older daemon to step down can only end with a daemon at least as new as the one that stepped down, under any mix of plugin versions on one worktree." Its done-when names the released B1 sequence ending with 0.1.32 or current, "never 0.1.31". D10 also says "a downgrade replaces nothing" and that an older hook never takes the post-step-down boundary to start an older daemon. This is the same B1 invariant as wave 12b, not an unrelated new race.

**Failure sequence, using unmodified released and candidate bundles:**

1. Start the released 0.1.32 Claude Code CLI from `dbeb862` in a private fixture. Wait for its five-second tier to begin.
2. Run the candidate's committed 0.1.34 Codex SessionStart. It takes the legacy `stop` fallback and spawns its own `--await-lock 120000` successor. No older consumer was registered at the gate.
3. Let that successor start waiting, then `SIGSTOP` only that successor until the old daemon exits. This selects a lock-acquisition interleaving; it changes no store, protocol or product code. The 0.1.32 tier finishes and its check is stored as current/pass at revision 0 before any replacement starts.
4. Run the released 0.1.31 Claude Code PostToolBatch from `8654424`. With no daemon, it starts 0.1.31 and registers its session.
5. `SIGCONT` the waiting 0.1.34 successor. It observes the changed daemon `startedAt`, returns `gave-up`, and exits. Pings continue to report the same 0.1.31 PID. There is no current successor left and no further boundary from the newer session. This was reproduced twice.

Normal retries reduce this window but cannot rule it out. D10 itself acknowledges that SQLite polling permits another spawn to win between release and retry. `takenOver` treats **any** changed record as success, including an older replacement; it forgets the invariant that prompted the upgrade. The registration gate only protects older consumers already present when the request is made. A newly registering older session can still win, as in the original B1 ordering.

**One-worker repair, if the human keeps the invariant:** retain the accepted handover's version floor and requesting CLI until a qualifying daemon actually serves. When a legacy contender wins below that floor, the handover owner must recover using the existing legacy-stop/step-down path and retry its own successor within an explicit overall budget, instead of returning `lost-lock`. Keep ordinary mixed-session requests gated, keep equal/newer holders untouched, and preserve tier storage before lock release. Add a deterministic released-bundle contention test that makes the older contender win; a timing-based expectation that it usually loses does not prove the done-when. If this recovery conflicts with keeping a newly arrived older session's daemon untouched, the human must settle that contract and amend the outcome before acceptance.

## Should-fix

### S1. Proven note, nonblocking: the budget correction still has two contradictory remnants

Location: `src/harness/shared/ensure.ts:25` describes the running tier as "bounded by the backlog budget's few minutes in practice"; `docs/specifications/001-core-loop/spec.md:96` still concludes that "a departure waits for a backlog tier up to its time bound".

The main D5 correction and the changed scheduler comments correctly state that selection uses last-known durations and gives no wall-clock cap. The two remaining phrases continue to imply that this selection budget bounds handover/departure time. Unknown durations, an oversized first file and a slower subsequent run defeat that inference, as wave 12b S1 already established. No scheduler behavior was changed in this repair and none is requested by this note.

**One-worker fix:** remove these remaining duration-bound claims. Describe the independent 120000 ms successor wait and its timeout separately from the tier's run deadline and cancellation grace. The existing normal 350 ms timeout probe is verified; a several-minute tier was not run by this review.

## Nits

### N1. Proven provenance mismatch at assignment, corrected for verification

Initial HEAD was `5cd8261f6dd37d9e35397313854a5edd7465b5f9`, not the named build `7f62b20`. The delta contains only `docs/board.md` and `docs/specifications/001-core-loop/tasks/wave-12.md`. Verification and probes ran after explicitly checking out the exact candidate; the assigned branch was restored only to commit this review. Nonblocking. Dispatch the exact candidate when possible.

## What fits

- **Ordinary B1 ordering, both plugins:** eight cases covered every pairing of newer Claude Code/Codex and released 0.1.31 Claude Code/Codex. With the newer hook first and the older boundary after old-process exit, 0.1.34 served. With the older registration first, the original 0.1.32 PID kept serving. These settle the uncontended path, not B1's contention window.
- **Unversioned consumer:** a live consumer registered through delivery without ever recording a version blocked the current Codex hook's step-down; the 0.1.32 PID remained. The gate deliberately treats unknown and malformed other-session versions as older, as the source tests confirm.
- **Two newer hooks:** simultaneous committed Claude Code and Codex SessionStart bundles spawned two waiting successors while a released 0.1.32 tier ran. Both hooks returned in about 70 ms. The tier stored its pass; a 0.1.34 daemon served without another boundary; the other successor exited. The lifetime lock still prevents two winners.
- **Running-tier protocol path:** each committed plugin upgraded its released 0.1.33 daemon while a five-second tier ran. Each old process stayed until the tier finished, persisted one superseded note, and the requesting bundle's 0.1.34 successor served without another boundary. The legacy 0.1.32 fallback also retained its tier result, including in the B1 counterexample.
- **Timeout and losers:** the released current CLI's 350 ms wait exited 0, persisted exactly one timeout note and left the holder serving. The full suite covers takeover after release, immediate equal/newer-holder give-up, malformed CLI flags, and equal/newer versions left untouched.
- **Seams and transactions:** `squealVersion` reaches delivery registration from shared hook context; registration writes the consumer and version slot in one transaction. Current unregister/expiry removes the slot in the same drop path. Both plugins share the same gate and successor call. `awaitLockMs` reaches CLI parsing, `startDaemon`, `openDaemon` and the lock wait; losers do not open the integrity-check path. Shutdown still records the tier before clearing the record, closing the socket and releasing the lifetime lock.
- **Scope and style:** no schema migration or runtime dependency was added. Both plugin bundles rebuild without drift. D5 selection semantics, cancellation and the settled wave-12b backlog proofs were not re-prosecuted; only their wording delta was checked. Other spec sections and unrelated pre-existing code remain outside this bounded re-review.

## Inputs for the human and next wave

1. Decide B1 under the last-round rule. The passing suite and ordinary mixed-bundle tests do not establish the stated never-downgrade outcome. The remaining decision is whether to retain that invariant with recovery when a released older contender wins, or explicitly accept and document the weaker best-effort contract. No further worker was dispatched by this review.
2. If repair is authorized, one row can own shared handover ensure, daemon lock/open lifecycle and their tests. Its done-when must force a released 0.1.31 winner after a released 0.1.32 step-down and obtain a daemon at least 0.1.32 without another newer-session boundary. Include both plugins, the legacy fallback and modern step-down path, and preserve the existing unknown/older-consumer gate before ordinary requests.
3. Keep ownership and budgets explicit: hook requests use one 100 ms round trip or two for legacy fallback, detached successor wait is currently 120000 ms, and lock retries are 10 ms with 250 ms takeover checks. A repair must carry the original version floor/CLI through contenders and specify cleanup/timeout without waiting for a tier synchronously in the hook. Preserve tier store, runner close, record clear, socket close, lock release order.
4. S1 needs wording only. Re-check already settled normal handover, consumer gates, equal/newer losers and tier retention only if a repair changes them. No candidate implementation was rewritten by this review.
