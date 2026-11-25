# Issue 281: upgrade handover stops and failed recovery

2026-11-25. Documentation-only triage for [hearsay-tools/squeal#281](https://github.com/hearsay-tools/squeal/issues/281).

**Verdict:** the original upgrade loop is not reproduced. A bounded synthetic
probe verifies that handover recovery waits its full deadline even when spawning
is unavailable, and cannot observe an exited successor as ordinary startup does.
This gap predates the reported upgrade. Investigate the failed successor and
preserve its diagnostic before choosing a forced-shutdown policy.

| Question | Answer and evidence |
| --- | --- |
| Can the 0.1.606 → 0.1.627 → 0.1.630 incident be reproduced here? | Not determined. The original daemon log, process/lock timeline and failing command's raw streams were not supplied. No live upgrade attempted. |
| Can a free lock still end in the reported 90 s start error? | Yes, in a synthetic source probe, when no successor answers. Finding 1. |
| Does this show that old-daemon shutdown caused the loop? | No. A marked shutdown can remain stopping while a lock is held, but the free-lock error also covers failure to launch or retain a successor. Findings 1–3. |
| Does handover alone explain unreadable status exit 1 and blocked turns? | Not established. Normal status-wait handling already prints a payload; raw output and the harness policy are missing. Finding 4. |

## 1. Recovery loses spawn evidence

**Verified by experiment**, versions 0.1.606, 0.1.627, 0.1.630 and current 0.1.633.
The [probe](probes/issue-281/probe.mjs) extracts `finishHandoff`, `stillHeld`,
`served`, `registered`, `spawnedFailed` and related helpers from each Git ref.
Only the clock and I/O dependencies are synthetic. It creates no daemon, socket
or store and does not touch a real daemon.

| Injected condition | Virtual time | Exit and output |
| --- | ---: | --- |
| Handover claim succeeds; spawn returns `unavailable`; no socket answers; lock free | 90,050 ms | 1; stderr says the old daemon let go of its lock but none of this version or later answered after 90 s |
| Same, but spawn returns `spawned` and successor remains absent | 90,050 ms | Identical; one spawn attempt, 1,802 probes |
| Ordinary startup; its child's `ended()` is already true; no socket answers | 0 ms | 1; stderr says the spawned daemon exited without answering |

All assertions passed. These are **virtual deadlines, not wall-clock upgrade
measurements**. The second case is consistent with an immediate successor exit;
no actual child was spawned or killed. The full output, commit pins and load are
in [results.jsonl](probes/issue-281/results.jsonl).

**Read in source code**, same four versions: `src/cli/start.ts:finishHandoff`
awaits `ensureDaemon` but discards its result. Its call to `served` supplies no
child-liveness observer; `src/cli/start-ready.ts:served` defaults `lives` to true.
`stillHeld` selects the free-lock diagnostic at the end. Ordinary startup instead
uses `ensureDaemonProcess` and passes the child's exit/error observer through
`spawnedFailed`. The 90 s bound is `STOP_BOUNDS.socketMs + lockMs`, 60 s + 30 s.
`ensureDaemonProcess` can return `unavailable` for a missing CLI path or failed
spawn; it retains only a Boolean child-ended observation, not the child's error
text or exit code. Its normal child stdout/stderr go to `daemonLogFor`.

**Inferred**, 0.1.630: this is a useful repair target for `squeal start` recovery,
but does not establish which failure happened in #281. The unchanged behavior in
0.1.606 means the probe does not identify a regression introduced by .627 or .630.

## 2. “Stopping” does not itself identify a stuck shutdown step

**Verified by experiment**, the same versions: `stoppingOf` with a recorded,
marked shutdown, expired heartbeat, no start mark and held lock returns an
overdue stopping state; changing only the lock to free returns null. The separate
live-handoff-claim path can still report handover after a record was cleared.

**Read in source code**, 0.1.630: `src/core/presence/findings.ts:stoppingOf` derives
the displayed state from the shutdown mark, heartbeat, start marks, handoff claim
and lock. `src/core/daemon/daemon.ts:#shutdown` marks stopping before awaiting
startup completion, loop cancellation, code/lint/coverage/relay/runner close,
escaped-child cleanup, scratch cleanup, store/socket close and lock release.
`#step` catches a rejection and logs it; it supplies no overall timeout for a
promise that never settles. Individual operations may have their own bounds.

**Inferred**, 0.1.630: a nonsettling operation could retain the stopping state and
lock. Nothing here proves one did. A short forced kill would not, by itself,
explain or repair a successor absent after the lock is already free.

## 3. Existing contract and prior work

**Read in official docs**, current 0.1.633 `spec.md` C6/C8/C9 and `status.md`:
C6 requires status to distinguish unvalidated results and explain why a wait
ended; C8 keeps hook work bounded; C9 already defines handoff claims, cancellation
and stopping/starting presence. The 2026-10-20 handover decision became rows
011-31–34; later amendments include 011-110 (one successor), 011-111 (registration
before a successful start report), 011-214 (child startup/exit diagnosis), and
011-293/294 (shared daemon presence). The 2026-10-22 amendment explicitly accepts
that a successor dying before acquiring its lock can leave handover visible for
up to 130 s. #281 needs evidence about recovery across repeated starts, not a
claim that these mechanisms never existed.

## 4. Unreadable status and turn blocking remain separate unknowns

**Read in source code**, 0.1.633: `src/cli/status-wait.ts:statusWaitCommand` prints
an unavailable result before returning 1. Its ordinary pathless no-daemon and
timeout outcomes print the snapshot and wait reason, returning 0; JSON includes
the `wait` outcome and writes the human reason to stderr. Named waits have their
own verdicts. `src/cli/index.ts` has no enclosing exception handler around `main`.

**Inferred**, incident version 0.1.630: the report's “exited 1 without a readable
result” is insufficient to distinguish an uncaught error, runtime/launcher
failure, wrapper parsing, a named wait, or store unavailability. Nor do repeated
turn holds establish which hook policy held them. No status CLI or hook behavior
was exercised by this probe. Obtain the exact command, exit/signal, stdout and
stderr and the daemon log around the three reported times before assigning a
shared cause. Do not copy private session transcripts into this repository.

## Run record and next decision

One bounded investigation, about six minutes including source reading; one probe
invocation, under one second wall time, exit 0. Node v26.13.0; 16 CPUs; initial
load 0.72/0.23/0.09, at probe 0.91/0.56/0.24. The one-minute load was below the CPU
count. No install, live upgrade, benchmark or product test suite ran. Boat was
unneeded for this tiny VM computation; an isolated install or live upgrade probe
belongs on boat.dev. Background Squeal emitted unrelated revision-0 baseline
failures before these docs; they were not retried and this report claims no suite
pass. Squeal reports that no test reads the throwaway probe.

Exact reproduction command from the repository root:

```sh
node --disable-warning=ExperimentalWarning docs/specifications/011-core/research/probes/issue-281/probe.mjs > docs/specifications/011-core/research/probes/issue-281/results.jsonl
```

Source retrieval: `gh issue view 281 --repo hearsay-tools/squeal --json title,body,comments`;
the probe uses `git show <ref>:<source-path>` and `git rev-parse <ref>^{commit}`.
Pins are .606 `dcb470ec8cb40a27fdf2a218ed8cc7426ca22720`, .627
`3c6bd44aac143c9b84dfd29263de3bbea164e946`, .630
`3d4f203534dda5a2ce1544d807098c0da8d5d5d4`, and .633
`26e64f04aefbd869fe61e3dd2df1080df905c26a`.

**Recommendation, inferred:** approve a narrow investigation/repair of handover
recovery that retains spawn/exit evidence and reports the failed successor,
alongside collecting the original failure diagnostics. Keep forced shutdown and
hook-policy changes contingent on that evidence. Original loop reproduction,
the actual shutdown step, successor failure reason and status parser failure
remain open. No product, spec, status, skill or board change is authorized here.
