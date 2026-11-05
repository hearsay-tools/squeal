# Daemon presence: one module for what is known about a worktree's daemon

Design brief from the architecture review of 2026-11-04 (main at 5d5dfa899, 0.1.402; Cezar task 4fac6c7f, report artifact e7f3508b). Rows 011-293, 011-294 and 011-295. Terms: `GLOSSARY.md` (Daemon presence, Presence view, Presence state, Presence event, Resting, Stopped by request, Gone). The decisions below are the human's, taken one at a time on 2026-11-04.

## Problem

No single module owns the rule "what is this worktree's daemon doing now". The facts are written in 11 files by three kinds of process (daemon, hook, CLI) and read again by about 15 files:

- Each reader stacks its own layers over the raw heartbeat:
  - status: `withDaemonFacts(asStopped(raw))`
  - header: `withDaemonFacts(asRested(asStopped(raw)))`
  - news: `withStopping(asStopped(asTold(raw)))`
  - wait: its own alive/lapsed/down model over lock marks and a socket probe
- The raw heartbeat check is written 7 times. `delivery/liveness.ts:37` and `status/snapshot.ts:284` are word for word the same.
- The writers and the keys sit in `types/daemon.ts` and `types/store.ts`. What a value means is decided again by each reader. Two different functions are both named `marksOf`. `ps/flags.ts:258` re-derives `lifecycle.ts`'s exit rules.
- Since 2026-10-15 the files involved have 98 commits, 54 of them fixes. The repeated subject is that a new fact reached some readers and a review found the others, for example:
  - b605644af "every reader tells a starting daemon from a stopped one"
  - 474f18f1a "a current start wins over a stop in every reader"
  - 8d2895485 "a wait reads the handoff as the status it prints"
  - d6050f4e5 "a wait reads a stale record's replacement start as status does"

## Decisions (the human, 2026-11-04)

1. **Named views inside the module.** The module reads every fact once and decides one presence state. Each audience asks for its view by name: status, delivered header, news, wait, the JSON payload, ps, and hook spawn. A difference that is deliberate is one visible rule beside the others in the module. Examples:
   - status says gone while the daemon rests;
   - news ignores a late change feed.

   A new fact is decided once for every view.
2. **The module owns the writes as well as the reads.** Daemon, hooks and CLI report presence events: registered, beat, exiting, rested, spawned, stopped by request, handoff claimed or ended. Only the module knows the stored keys and formats, both meta rows and lock-file marks. The work lands in two slices:
   - slice 1 moves the readers (row 011-293);
   - slice 2 moves the writers (row 011-294), so `daemon.ts` is touched once in a small diff.
3. **Presence states.** Seven main states, highest priority first: validating, stopping, starting, stopped by request, resting, heartbeat late, gone. Three notes can combine with them: last one died (with starting or gone), handoff ended short (with validating), and change feed late (with validating). The priority order replaces the scattered "a start wins over a stop" rules. The human, 2026-11-05 ("Keep the note"): last one died also comes with stopped by request. A daemon is killed, then `squeal stop` runs before its record is cleared. The death says how the last daemon ended; the stop says why none runs now. Status keeps naming both, as it does today.
4. **The status payload keeps its shape byte for byte.** `daemon: { state: "alive" | "down", …flags }` becomes one more view derived from the presence state. The evals (`evals/lib/grade.mjs:417`) and users' scripts see no change.

## Coordinator's calls (repo-local; the human may overturn)

- **Behaviour is preserved in rows 011-293 and 011-294.** Every view prints today's text and payload. The accidental differences are fixed only in row 011-295, so a review can tell the move from the change.
- **The wait keeps its I/O outside.** The socket probe and the time since the socket was first found dead stay in `cli/wait-liveness.ts`. Their results enter the module's wait view as inputs, so the wait's priority rules live beside the other views. `DaemonSync` and the socket ping already have a test adapter.
- **Location.** `src/core/presence/`. The presence types move out of `types/status.ts:457-540` and `types/daemon.ts:520-546`. The status payload type keeps re-exporting the JSON view's shape. Hook bundles under `plugins/*/dist` are rebuilt; CI fails on drift.
- **Tests: replace, don't layer.** The new test surface is one table test at the module's interface: presence events and a clock in, each view's output out, over a scratch store and lock directory. Then:
  - the per-reader agreement tests are deleted once the table covers their cases (`test/cli/start-readers.test.ts`, `until-start-readers.test.ts`, and the cross-reader parts of `died*.test.ts`, `stopping*.test.ts`, `liveness.test.ts`, `handoff*.test.ts`);
  - the renderer wording tests stay;
  - the real-daemon tests that prove a write happens at the right moment (a SIGKILL death, a handoff across versions) stay.

## Accidental differences: made consistent (the human, 2026-11-04)

The human: "fix the accidental ones - if those are not critical for how things work - let's keep it simple and consistent". Row 011-295, after 011-293:

- **News.** News leaves out "last one died" and "heartbeat late" today. The spec gives a rule only for a late change feed: it starts no delivery of its own (C5). From this row, the news view tells every presence state and note the header tells, except a late change feed. Each change of state or note is told once per consumer, as other news is. Spec 011 C5 and C8 are amended to say so.
- **Other readers.** `squeal ps` (`hung`), hook spawn (`harness/shared/ensure.ts`), `squeal start` and the open-run claim (`status/open-runs.ts`) read the raw heartbeat first, each with its own follow-up: for example, a hook asks the socket before it spawns. From this row they take their heartbeat reading from the module's one rule, and what they print agrees with status.
- **What stays as it is.** A decision that matters for how things work stays exactly as it is: whether a hook spawns a daemon, whether a run claim is held, whether `start` refuses, and `ps`'s two-sample rule for `hung`. If making a reader consistent would change one of these decisions, the worker keeps today's decision and reports the case. The coordinator brings it to the human.

## Not in scope

- The `status --wait` engine (review candidate 4). It builds on this module and comes after slice 1.
- Any change to the store design (ADR 0002) or the delivery model (ADR 0003).

## Process

This is product code in `src/`. Rows 011-293 to 011-295 are approved by the human (2026-11-04, "Land and start coordinator"). A coordinator for spec 011 runs them, with a worker per row and disjoint ownership. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6). Order:

1. 011-293 first.
2. Then 011-294 and 011-295. They may run in parallel if their files do not overlap; the coordinator decides.

This is the kind of single owner `docs/process.md` step 6 asks a coordinator to bring to the human before a third repair.
