# Issue 163: idle exit and the reason shown by status

Recommend surfacing the recorded exit note in default status, while leaving the original daemon exit cause undetermined.

The tradeoff is a more useful down-state explanation versus C6's deliberate rule that default status shows notes only by count. The probe proves a visibility gap, not a missing write or a two-minute default timeout. Changing consumer ownership needs separate evidence and a policy decision.

## Scope and verdict

Examined on 2026-11-07: Squeal **0.1.414**, commit `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`, Node **v24.22.1**, Linux, 24 available CPUs. Ran the committed `plugins/claude-code/dist/cli/squeal.mjs` directly. The issue names 0.1.412 as current when filed but does not record the incident's version. Source comparison also examined tag `squeal--v0.1.412`, commit `578f5bb2aba9e6f74e391fc1366a8d529837da10`; that release was not run.

| Question from the brief | Answer and evidence tag |
| --- | --- |
| 1. Does an unchanged worktree daemon disappear between status reads about two minutes apart? | **Not reproduced**, `verified by experiment`, 0.1.414: a fresh daemon with default lifecycle settings stayed alive across 130 seconds. No fixture edits or Squeal calls occurred in that interval. |
| 2. Is the exit reason missing? | **Hidden in default status, present in stored notes**, `verified by experiment`, 0.1.414: a separate artificial idle timeout produced a note that JSON and `--full` showed. Plain status omitted its text. |
| 3. Can CLI-only `PI_SESSION_ID` explain an exit? | **Conditionally, not from this evidence alone**, `inferred` from 0.1.414 experiments and source: CLI reads register no consumer. A sufficiently old daemon can reach its idle limit while the Pi session is alive. A fresh daemon does not reach the default 60-minute limit in two minutes. |
| 4. What caused the reported incident? | **Not determined, because** the issue supplies no exact output, daemon age, effective policy, consumer history, exit note, PID, signal record or incident version. Host load alone does not identify an exit cause. |

## 1. Default lifecycle probe

**Verified by experiment, 0.1.414.** The probe created a new Git repository, a linked worktree and a one-file node:test fixture. Baseline was `lookup-only`; coverage and complexity were off. No daemon timeout was overridden. It set `PI_SESSION_ID=issue-163-cli-only` without loading a Pi extension. It used a private store and user config. Runtime paths were configured privately; long socket paths fell back to `/tmp/squeal-1001/` with distinct fixture worktree hashes. It changed no shared daemon or hold.

Load before spawn was **17.739 / 24 CPUs**, below the required gate. At the end of the quiet interval it was **16.180**. Exact commands and full output are in [output.jsonl](../../../../research/probes/issue-163/output.jsonl). The relevant observations, with timestamps kept in UTC as in the log:

```text
21:41:31.823  quiet interval starts; child still running
21:43:41.825  quiet interval ends; child still running
status --json before: daemon.state = "alive"
status --json after:  daemon.state = "alive"
consumers table before/after: []
git status --porcelain after: empty
```

Both plain status reads said no Squeal consumer was registered for the Pi session. The two JSON results had different current heartbeats. After the observation, the probe sent SIGTERM **only to its own child** for cleanup. It exited 0 and persisted a note naming `SIGTERM` and `cezar.service`. That deliberate cleanup is not an unexplained exit.

## 2. Exit-note visibility probe

**Verified by experiment, 0.1.414.** A separate fixture set `daemon.idleExitMinutes: 0.05` before spawn. This is an **artificial three-second timeout**, not a reproduction of the incident's timing. Load was **16.180 / 24**; a repeat that added `status --full` started at **17.335 / 24**. Both daemons exited 0 during an eight-second quiet interval, without a stop request or signal.

The compact response said:

```text
Outstanding:
  no daemon has validated since ...; results are as of revision 0; ... start ...
More: ... status --full ... adds ... 2 notes
```

It did **not** show the reason. JSON contained:

```json
{"text":"daemon stopped: idle for 3 s with no registered consumers"}
```

The repeat's `status --full` printed that same note under `Notes:`, with time, revision and the down daemon line. See [full-output.jsonl](../../../../research/probes/issue-163/full-output.jsonl). Thus the ordinary idle exit already records its reason; default text suppresses it. No lost note was reproduced.

## 3. What the source establishes

**Read in source code, 0.1.414; the listed lifecycle, Pi-status and formatting bodies also match 0.1.412.** `startTimers` uses 60 minutes for a daemon that never had a consumer. The three-second departure rule requires `presence.lastPresentAt` or a departure stamp from this daemon's lifetime. Registered-but-unused consumers have a separate default 30-minute bound. These are distinct paths, with explicit shutdown texts.

C6 states: “A status read writes nothing.” Plain CLI status reads the store; `piStatusLine` only checks registration and prints advice. `PI_SESSION_ID` is not registration. Consequently, CLI-only reads cannot keep a daemon alive through a lifecycle boundary. A daemon already near its idle limit, a project override, or another consumer leaving could fit a short gap between reads. None is established for the incident.

`Daemon.#shutdown` writes an incarnation-linked exit note before closing resources. `writeNote` catches a failed store write and logs the failure; this was read, not reproduced. Default formatting calls `detailLines` only for `--full`/`--notes`; the JSON snapshot retains `daemonNotes`. C6's 2026-10-20 amendment explicitly requires “the notes by their count only.” C5's delivery contract and later liveness amendments do not make the CLI a consumer. The proposed visibility change therefore needs a spec decision, not a claim that current formatting violates C6.

## Open questions and verification limits

Recover the original `status --json` or `--full` output, effective `daemon` policy, daemon start time, prior consumer departures and service/kernel exit evidence if available. Capture these before restarting on recurrence. Those facts can distinguish expected idle/departure from a signal, abrupt death, failed persistence or a different lifecycle path.

No product code, spec, status, board, skills or existing holds changed. No full suite ran. The tiny fixture remained one unknown test file under lookup-only; no test pass is claimed. Both probe processes completed and all three temporary repositories were removed. `git diff --check`, Python syntax, JSONL parsing and local report links passed. `squeal status --wait 60000 research/probes/issue-163/probe.py docs/specifications/011-core/research/issue-163.md` returned no verdict because neither path has a test reader; it reported 0 known failures and 529 unknown test files in this worktree. See [verification.txt](../../../../research/probes/issue-163/verification.txt). Squeal flagged the throwaway Python functions as untested, with `case` CRAP 210; those research-only diagnostics remain, and are not product regressions.

## Sources and repeat commands

- [Issue 163](https://github.com/hearsay-tools/squeal/issues/163), fetched with `gh issue view 163 --repo hearsay-tools/squeal --json title,body,comments,url,createdAt`; preserved as [issue.json](../../../../research/probes/issue-163/issue.json).
- [Probe and commands](../../../../research/probes/issue-163/README.md): `python3 research/probes/issue-163/probe.py`, then `python3 research/probes/issue-163/probe.py --short-only`. JSONL records exact Node/CLI argv, times, status outputs, store observations and cleanup.
- Local [spec C5/C6/C9](../spec.md) and [amendments](../status.md), especially 011-24/29 (compact notes), 011-113 (read-only status), 011-250 (signal note), 011-295 (liveness delivery).
- [Lifecycle source at examined commit](https://github.com/hearsay-tools/squeal/blob/d3f363054fbe5d30e6e11bf8f212e1ac74d567e1/src/core/daemon/lifecycle.ts), `startTimers`; `src/core/types/policy.ts`, `DEFAULT_POLICY`; `src/cli/main.ts`, status handler; `src/cli/pi/status.ts`, `piStatusLine`; `src/core/daemon/daemon.ts`, `#shutdown`; `src/core/daemon/notes.ts`, `writeNote`; `src/core/status/format-status.ts` and `status-detail.ts`. Version comparison: `git diff squeal--v0.1.412 HEAD -- <these paths>`; lifecycle and formatting changes in the compared bodies were imports/exports only.
