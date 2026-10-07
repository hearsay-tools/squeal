# Review: wave 10, 001-96 (task 001-98)

Reviewer task 001-98 for spec 001, 2026-10-07. Range `272fe53..1bd3c4f`: the 001-96 commits as cherry-picked (`12383f9`, `11bfb3c`, `ee54668`, worker shas `4f9108d`, `cbfbedf`, `662ee66`) and the dist rebuild `1bd3c4f` (0.1.13). 001-97 is in the range and out of scope. I read the range against `reviews/wave-10c.md` B1 and S1, the 001-96 brief, and D6 and D9 as amended.

The design as built: the registration revision is taken when the consumer registers, with the live daemon's `startedAt` (`scanned`) when its bootstrap marker matches. A `start` revision after the registration revision, or the one it is, makes its paths unknown, and a failure whose closure meets them gets neither line. "None of your changes" appears only while the daemon recorded at registration as scanned is still the recorded one. SessionStart waits for the heartbeat only.

## Verdict

**PASS at `1bd3c4f`.** Counts: 0 blockers, 2 should-fix, 6 nits.

- **Can attribution say anything false now?** Not through anything this range changed. Every case the brief named gives a true line or no line:
  - the wave 10c restart probe, with and without a resume;
  - an edit in the first 500 ms;
  - a session registered before a `start` revision and resumed after it;
  - a real daemon stopped, an outside edit, and a respawn.

  Two false lines remain, both from before the range:
  - S2: "none of your changes" for a registration made by PostToolBatch after the agent's edit.
  - N1: "touches your changes" for another session's edit in the same worktree.
- **The first tool call after a session starts behaves.**
  - **Lines:** PostToolBatch while the daemon starts printed nothing on both real clones (311 calls).
  - **PostToolBatch latency:** p95 58 ms (squeal) and 71 ms (cezar) during the start, the same as after it.
  - **SessionStart latency with a spawn:** 164 to 196 ms on the real clones, against 809 to 889 ms in 0.1.12 and 131 to 184 ms in 0.1.11.
- **The cost is silence.**
  - On squeal, an agent edit made in the first ~1.8 s after spawn lands in a `start` revision. That file then gets no line for the rest of the session (S1).
  - A session that spawns its daemon never hears "none of your changes".

## Verification

HEAD is `84188de`, one commit past the candidate, and it changes only `docs/board.md` and `tasks/wave-10.md` (`git diff --stat 1bd3c4f HEAD`). I ran everything at `84188de`.

```
$ git rev-parse HEAD
84188de32fd42e7d938d39d998faa9d5ef3f864f
$ npm ci
added 50 packages, and audited 51 packages in 2s ... found 0 vulnerabilities (install-scripts warnings for @parcel/watcher and esbuild)
$ npm run lint
Checked 373 files in 108ms. No fixes applied.
$ npm run typecheck
tsc --noEmit   (no output, exit 0)
$ npm run build
(exit 0)
$ git status --porcelain
(empty: committed bundles match the build)
$ npx vitest run          (load average about 18 at the end, other sessions' work)
 FAIL  test/harness/bundles.test.ts > bundled hooks without a usable store > session-start exits 0 on a corrupt store file
 Error: ENOTEMPTY, Directory not empty: .../squeal-cli-4mtK7w   (test/store/helpers.ts:26, the cleanup)
 Test Files  1 failed | 133 passed (134)
      Tests  1 failed | 1036 passed | 7 skipped (1044)
$ npx vitest run test/harness/bundles.test.ts     (3 times, load 15)
      Tests  32 passed (32)   (each time)
$ npx vitest run test/harness/latency.test.ts     (load 1.23)
 session-start 56 p50 / 62 p95; post-tool-batch 52/58; pre-tool-use 49/55; pre-tool-use (Bash, silent) 41/50;
 stop 58/65; stop (silent) 59/66; user-prompt-submit 55/58; user-prompt-submit (silent) 47/50;
 session-end 42/48; waiter 35/37; session-start (spawn) 92/146/158 max, budget 200
```

The one failure is a cleanup race in a path this range does not touch (N4). It passed 3 of 3 times alone.

The probes ran in a throwaway `test/harness/probe98.test.ts` (deleted) and in scripts outside the repository. Those scripts ran the committed bundles against two local clones:

- **squeal**: this repository, with a hardlinked `node_modules`;
- **cezar**: `~/projects/cezar` at `13351da8`, with 2,272 tracked files, its `squeal.config.json` copied in, and every `node_modules` hardlinked.

The clones were deleted afterwards and no daemon was left running.

### Probes through the handlers (fake daemon, `runHook`)

| Probe | Line on the failure | Verdict |
| --- | --- | --- |
| P1 wave 10c restart probe: `startup` with a scanned daemon, reboot, `resume` spawning daemon 99 whose `start` revision changes `src/math.ts`, failure at a README-only revision | none | correct (10c B1 closed) |
| P1b same restart without a resume (delivery only) | none | correct |
| P1c agent edits `src/math.ts`, then a restart whose `start` revision changes only `package.json` | `touches your changes: src/math.ts` | correct; no "none" either, since the daemon changed |
| P2 the agent's early edit absorbed into a `start` revision, then edited again under the watcher, then a later README-only failure | none, both times | silent for the session's life (S1) |
| P3a registered, edit, SessionEnd, daemon gone, `resume` spawns a daemon whose `start` revision changes `src/math.ts` after the registration | none | correct |
| P3b registered, SessionEnd, new daemon scanned with a `start` revision changing `src/math.ts`, then `resume` | none | correct: the revision is in the gap and the daemon changed, so no "none" |
| P3c registered, SessionEnd, a user edit of `src/math.ts` under the same daemon, `resume` | `none of your changes are in its imports` | true by D6: changes while not registered are not the session's, and the daemon is unchanged |
| P4 A spawns (not scanned), B registers after the marker, B edits `src/math.ts` | A: `touches your changes: src/math.ts`; B: the same | A's line is B's edit (N1, from before the range) |
| P5 store and scanned daemon exist, the consumer is not registered, the agent's batch edits `src/math.ts`, PostToolBatch registers, then a failure | `none of your changes are in its imports` | **false** (S2, from before the range) |
| P6 a scanned daemon whose `start` revision changed `src/math.ts` is current; a new session registers, edits `src/math.ts`, a failure | none | silent: the registration revision is a `start` revision (S1 b) |

### Real clones: when an early edit is counted

Each run:

1. Starts with no daemon and a warm store.
2. Runs the bundled `session-start.mjs` (`startup`, new session id).
3. Appends a newline to one source file a set delay after the hook returned. On squeal the file is `src/core/delivery/collapse.ts`; on cezar it is `packages/cezar/src/agent-config/catalog.ts`.
4. Runs PostToolBatch once.
5. Polls the store for revisions, their trigger, and the marker.

Times are milliseconds from the hook's start.

| Repository | Load | SessionStart | Heartbeat | Start-scan revision | Marker | Edit at | Edit landed in |
| --- | --- | --- | --- | --- | --- | --- | --- |
| squeal | 3 to 7 | 164 to 177 (7 runs) | 146 to 167 | 396 to 438 | 1,680 to 1,932 | 477, 478 | `start` revision at the marker (2 of 2) |
| squeal | | | | | | 1,165 | `start` revision at the marker |
| squeal | | | | | | 2,671; 4,179 | `watch` revision at 2,830; 4,341 |
| cezar | 1.8 to 2.3 | 171 to 193 (6 runs) | 145 to 166 | 643 to 686 | 9,188 to 9,649 | 1,173; 3,182; 6,185 | `watch` revision at 9,279 to 9,500 |

- **Every spawning session's registration** was the bare pre-start revision (`0`, `2`, `4`...), so it carries no `scanned`. Such a session can be told "touches your changes" but never "none of your changes".
- **A session registered after the marker** got `{"since":12,"gaps":[],"scanned":...}`.
- **On a store's first daemon,** SessionStart took 42 ms and registered nothing, as D9 says. The marker came at 1,925 ms (squeal) and 9,861 ms (cezar).
- **Why the two repositories differ.** On squeal the early edit is picked up by the feed's own start reconciliation, which records a `start` revision (`change-feed.ts:108`). On cezar it was picked up as `watch`. Both outcomes are safe.

**End to end on squeal.** Session A spawned the daemon, and its edit at +300 ms broke `test/delivery/collapse.test.ts` (`in` to `of`). The edit landed in `start` revision 12 at the marker. Session B registered after the marker, at 12, with `scanned`. Three baseline failures came, and neither A nor B got a line. A's silence is right. B's is the P6 cost: B made no change, so "none" would have been true.

**Restart on squeal.** Session A registered with a scanned daemon, then `squeal stop`, then an outside edit to `collapse.ts`. A's next PostToolBatch respawned the daemon. Four transitions at revision 14 followed, with no attribution line.

**PostToolBatch during the start** (load 1.0 to 1.7, sequential calls for 16 s after SessionStart):

| Clone | 0 to 9 s: n, p50, p95, max | after 9 s: n, p50, p95 | Output during the start |
| --- | --- | --- | --- |
| cezar | 138, 59, 71, 399 | 114, 62, 71 | none |
| squeal | 173, 50, 58, 105 | 138, 51, 60 | none |

## Previous findings (`wave-10c.md`, section 1)

| Finding | Now | Evidence |
| --- | --- | --- |
| B1 a consumer registered across a restart counts the new `start` revision as its changes | **closed** | `changedAfter` puts `start` paths in `unknown`, and `attribute` gives neither line when the closure meets it (`attribution.ts:98`). P1, P1b and the real restart give no line. `registered.test.ts` and `attribution.test.ts` case 2 cover it. |
| S1 the marker wait costs 800+ ms and no spawning session gets attribution | **closed by the redesign** | `settle` waits for the heartbeat only (`ensure.ts:51`). Spawn costs 164 to 196 ms on the real clones and 146 ms p95 in the latency test. Spawning sessions get "touches your changes" for edits counted after the start, never "none". |
| N1 lowercase sentence start in D6 | closed | |
| N2 a registration without a revision is never filled in | superseded | Every registration now records a revision. |

## Blockers

None.

## Should-fix

### S1. An edit absorbed early stays silent for the whole session, longer than D6 and `reports.md` say (proven, measured)

`ChangeFeed.start` reconciles with trigger `"start"` (`src/core/watcher/change-feed.ts:108`). `keys.bootstrap` has already recorded what changed while no daemon ran (`keying.ts:97`). So the feed's revision holds only edits made while this daemon was starting: the agent's, or anyone's during the session. Yet `changedAfter` treats it like the start scan's revision.

On squeal, edits at 477 ms and 1,165 ms land there. The start scan's own revision is at about 0.4 s, so these edits came after the start revision existed. On cezar the same edits were picked up as `watch`.

`unknown` never shrinks: every later failure whose closure holds that file gets neither line for the session's life, even after the agent edits it again under the watcher (P2).

A second cost, in `registered.ts`: `changedAfter` also counts `r.since` when it is a `start` revision (`registered.ts:201`). Every session that registers while a daemon's `start` revision is still the latest revision is silenced for that revision's paths (P6, and B in the end-to-end run). Two examples:

- the second session after an idle-out;
- a worker starting in a worktree where nothing changed since its daemon started.

That inclusion exists for an edit absorbed before registration, which only a registration made before the scan can have.

D6 says the start scan "absorbs an edit made before it read the file". `reports.md` says "before a daemon that started during your session first read it". Both understate the window.

None of this is a false line. It cuts against the 001-96 outcome "attribution appears on real repositories from the first tool call after the daemon's start revision exists".

**Fix (one worker):**

- **a.** In `change-feed.ts` (or `daemon-loop`, wherever the trigger is chosen), record the feed's start reconciliation with an ordinary trigger. Keep `"start"` for `keys.bootstrap` only.
- **b.** In `registered.ts` `changedAfter`, count `r.since` as unknown only when the registration has no `scanned`.
- **c.** Make D6's sentence and `reports.md` say what is left unknown: what the start scan recorded, and, for a session registered before the scan, the scan's own revision.

Tests:

- a daemon test that an edit made after `keys.bootstrap` and before the watcher starts lands in a non-`start` revision;
- P6 as a `registered.test.ts` case giving "touches your changes";
- P2 still silent when the edit is in the start scan's revision.

### S2. A registration made by PostToolBatch after the batch's edits can say "none of your changes" (proven by P5, from before the range)

PostToolBatch registers a consumer that is not registered (`hooks/post-tool-batch.ts:21`) after the batch it follows ran. Its registration revision then already holds the batch's edits. Under a scanned daemon it gets `scanned`, so a failure that edit causes says "none of your changes are in its imports". The same holds after `back()`: the batch's edits fall in the gap, and `scanned` is kept for the same daemon.

Reach:

- the first session in a repository in `-p` mode. SessionStart has no store yet, and UserPromptSubmit registers nothing in `-p`. The marker must come before the first batch: about 1.9 s on squeal, 9.9 s on cezar.
- a consumer the waiterless expiry removed during a tool call longer than 10 minutes.

Before 001-96 the same happened with `bootstrapped` (0.1.12) and with no marker at all (0.1.11). So this is not a regression of this range, but it is the one false line the brief's question finds.

**Fix (one worker, `src/core/delivery/delivery.ts` `register`, `registered.ts`, `hooks/post-tool-batch.ts`):** a registration made after tool calls records no `scanned`. For example, add a `register` option `afterTools: true` from PostToolBatch, and pass `scanned: null` to `tellRegistered` for it. "Touches your changes" then still misses the batch's own edits, which is silence, not a false line. Test: P5 through `runHook`, expecting no "none".

## Nits

- **N1. Another session's edit in the same worktree is told to each session as "touches your changes" (P4, from before the range).** D6 defines the line as paths changed "in this worktree", and `reports.md` says "files changed in this worktree since your session registered", but the line itself says "your". This is the same exposure the Stop paragraph of D9 accepts for wake-ups. Worth a `lessons.md` dogfooding item: coordinators run several workers per worktree only rarely, but a human and an agent share one all the time.
- **N2. `reports.md` explains the missing "none" as "a daemon started after your session registered (the first daemon of a new worktree, a restart)".** As built, it is also left out for every session that registered before its daemon wrote the marker, which is every session that spawns its daemon. Those sessions registered after the daemon started. Suggested wording: "when the daemon had not finished starting when your session registered, or another daemon started since". This can go with S1 c.
- **N3. Board drift.** Row 001-96's scope still describes the brief's lazy design ("the first hook after the start revision exists records the registration revision"). As built, the revision is taken at registration. Its status says "SessionStart with spawn 100 ms p95"; I measured 146 ms p95 at load 1.2 in the latency test, and 164 to 196 ms per run on real clones. I am reporting this, not repairing the board.
- **N4. `bundles.test.ts` "session-start exits 0 on a corrupt store file" is racy (from before the range).** Without a usable store, SessionStart ensures the daemon with no settle. The stand-in CLI from `quietCli` is detached and writes `ran` after the hook returned, so under load it races the temp-dir cleanup (`ENOTEMPTY`). Fix: wait for `ran` before returning, or retry the `rmSync` in `test/store/helpers.ts`.
- **N5. The latency test's spawn case uses a stand-in that writes only the heartbeat.** The real spawns measured 164 to 196 ms, close to the 200 ms budget at load 2. One PostToolBatch during cezar's start took 399 ms; the p95 was 71. That is plausibly a SQLite busy wait behind a large daemon write, and was not reproduced. Report only.

- **N6. A stale comment in `src/core/daemon/daemon.ts:276`.** It says "Past the start scan: registrations from here on record where an agent's changes start". Since 001-96, every registration records that revision, and the marker only enables "none of your changes". It was outside 001-96's ownership except for removing the marker. Reword it with S1.

## What fits (do not re-check)

- **`changedAfter`.** It reads `(since - 1, revision]` in one query. It counts `since` only when it is a `start` revision, and skips gaps. A path in both sets is unknown, so neither line appears.
- **`attribute`.** It shows "touches your changes" when the closure meets `changed` and misses `unknown`, whatever `scanned` is. It shows "none" only with `seesEveryChange`.
- **`scanned`.** It is recorded only when the header's daemon is alive and the marker equals its `startedAt`. `seesEveryChange` compares it with the recorded daemon, and a `setDaemon(null)` stop makes it false. The daemon writes its record before `loop.start()`, so no result from a new daemon can arrive while the old one is still recorded.
- **`back()`.** It keeps `scanned` only for the same live, scanned daemon (P3b, P3c). A parked registration from 0.1.12 or older has no `scanned` and so never gives "none".
- **The stored slot.** It stays a bare number without `scanned` or gaps. 0.1.12 hooks read the object form, ignoring `scanned`; older hooks read no registration from it, which is silence.
- **Registration.** `register` records a revision at every first registration. `resume` and `compact` keep it (`attribution.test.ts`, the 001-94 cases).
- **SessionStart.** `settle` returns on the heartbeat, and the marker is no longer waited on anywhere (`grep bootstrapped src/harness` is empty).
- **Docs and build.**
  - D6, D9 and the `status.md` line match the code, except the windows in S1 and N2.
  - The type change is additive: `Registration.scanned`. `bootstrapped` was replaced by `scannedDaemon` and `seesEveryChange`.
  - Version 0.1.13 is set in `package.json`, `plugin.json` and `plugins/claude-code/package.json`, and the bundles match the build.
- **Done-when (1) to (6)** each have a test: `attribution.test.ts` cases 1 to 3 and the seeding case, `registered.test.ts` "a start revision" and "none of your changes", and `latency.test.ts` `session-start (spawn)`.

## Inputs for the next wave

- **S1 row** (`src/core/watcher/change-feed.ts` or `src/core/daemon-loop/`, `src/core/delivery/registered.ts`, `test/delivery/registered.test.ts`, a daemon or feed test, D6, `reports.md`).
  - The feed's start reconciliation uses an ordinary trigger.
  - `changedAfter` makes `since` unknown only without `scanned`.
  - Re-measure on a squeal clone: an edit at +300 ms and +1,000 ms after SessionStart should land in a non-`start` revision. Then confirm that "touches your changes" names the file on a failure.
  - Keep `RevisionTrigger` unchanged unless a new value is clearer, and say so in `status.md`.
- **S2 row** (`src/core/delivery/delivery.ts`, `registered.ts`, `src/harness/claude-code/hooks/post-tool-batch.ts`, `test/harness/attribution.test.ts`).
  - Add a `register` option for a registration that follows tool calls, recording `scanned: null`.
  - Test with P5. The P5 setup: a store with a scanned daemon, no registration, a `watch` revision with the agent's edit, PostToolBatch, a failure at a README-only revision, PostToolBatch.
  - It can share a worker with S1: both touch `registered.ts`, so give them to one worker.
- **N4** fits any harness row: wait for `ran` in the corrupt-store case.
- **Still missing:**
  - the attended check from `wave-10c.md` (a real session after a `git pull` and a resume, 001-87's fixture);
  - a `lessons.md` note on N1 for dogfooding.
