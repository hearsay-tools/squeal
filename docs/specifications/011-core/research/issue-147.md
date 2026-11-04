# Issue 147: daemon still serves after the stop wait

## Fit and owner

Inferred: this passes the vision decision filter. Reliable stop state and actionable timeout evidence reduce blocking and preserve uncertainty across harnesses. Spec 011 C9 owns daemon shutdown and the worktree-local `--until-start` mark. C6 owns status; C14 owns runner cancellation and cleanup at the adapter boundary.

## Evidence and reproduction

Read in the issue: [#147](https://github.com/hearsay-tools/squeal/issues/147) reports Squeal 0.1.390 through the Codex launcher in a cezarion worker. The first command printed `Stop requested; the daemon for <worktree> (pid 2816594) still serves after 60 s.` A second stop succeeded. Later JSON said `daemon.state: down`, `stopped: true`, `untilStart: true`. The first exit code, active run, lock holder, incident host load and timing of the second command are not recorded. This is reported evidence, not a local reproduction or proof of a cause.

Commands reported by the issue, in order:

```sh
squeal stop --until-start
squeal stop --until-start
squeal status --json
```

Verified by experiment (host observation only): triage ran `cat /proc/loadavg` and `getconf _NPROCESSORS_ONLN`. Output was `36.46 22.02 20.13 41/2723 3979087` and `24`. Not reproduced, because the one-minute load 36.46 exceeded 24 CPUs. No researcher, daemon stop, live probe or test was started. The session pin is 0.1.390; checkout `package.json` is 0.1.401. The incident was not tested on either version.

Read in spec 011 C9: stop cancels active tiers, starts no further tier, waits up to 60 s for the socket, then up to 30 s for lock release, and must not claim success without shutdown evidence. The until-start mark prevents automatic restart within the worktree. A bounded failure alone does not establish a contract violation; why this daemon still served is unknown.

## Duplicate check

Read in origin/main's board and open GitHub issues, including `triaged`: no #147 row or exact duplicate. Searches covered `#147`, `gh-147`, `until-start`, `stop-mark`, `still serves`, stop timeouts and `stop.ts`. The issue names no source file.

Related open #108 / gh-108 concerns a busy stop-mark write during **start**, not a daemon still serving after **stop**. Its human deferral remains in force. Existing 001-436 concerns stop returning success after socket/lock release while its process still exits; #147 instead reports an answering daemon at the 60 s bound. It is not the same symptom. Closed #104 / 011-254 delivered the hold mode, not this timeout diagnosis.

## Human decision

Approve a bounded investigation of stop cancellation and timeout diagnostics, or defer until shutdown evidence can be captured. Decide whether the existing bounded wait should remain with an actionable explanation, or whether its wait policy should change. Any repair must distinguish a requested stop from a completed stop, state whether the request remains pending, and give a safe next action. Regressions should cover an active tier, an answering daemon at timeout, later shutdown, and preservation of the until-start mark. Existing holds stand. No implementation is authorized.
