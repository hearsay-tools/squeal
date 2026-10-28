# Issue 119: slow request acceptance ends the wait early

Recommend correcting the wait contract at request acceptance; retain the existing scheduling rules.

The receipt and exit 1 are reproduced with the **0.1.370 bundled CLI** and a
scripted daemon. They occur after **10.22 s**, before the result wait starts.
Ordinary fast work did not reproduce this failure in a real two-file daemon.
The reported **0.1.369** incident was not executed or timed here.

## Questions and answers

| Question | Answer and evidence tag |
| --- | --- |
| 1. Can the reported receipt and exit be reproduced? | **verified by experiment, 0.1.370:** delayed scheduler acceptance gives the exact receipt, exit 1, and two pending files after 10,221 ms despite `--wait 3000000`. |
| 2. Does it wait for requested slow results? | **verified by experiment, 0.1.370:** yes after prompt acceptance in the passing controls; no when acceptance remains pending past the separate 10 s limit. **read in source code, 0.1.369/0.1.370:** the result wait can also end on news, so it is not an unconditional all-results barrier. |
| 3. What does fast backlog change? | **verified by experiment, 0.1.370:** an explicit slow request runs beside baseline fast work. With edit-caused fast work it waits through the fast run and then the slow run. Neither real-daemon control exited 1. |
| 4. Why did named status wait work? | **verified by experiment, 0.1.370:** it read pending state and waited another 6,185 ms for the slow result. **read in source code, 0.1.370:** it does not pass through the slow-request acceptance timeout. |
| 5. What blocked acceptance in the incident? | **not determined:** issue 119 supplies no timed command, scheduler trace or store snapshot. **inferred, 0.1.369/0.1.370:** a scheduler-lock delay can cause this path; ordinary fast execution alone does not prove such a delay. |

## Experiments

Initial host reading at **2026-10-28 11:44:23 UTC**: one-minute load
**19.9653**, **24 CPUs**. Probes were permitted. Loads at their starts were
8.59, 10.60 and 14.05. Node was **v24.22.1** on Linux. Checkout:
`9e4206a2d72738d6964b955aa0dc7073796f4d15`, version **0.1.370**.

All commands below use `node --disable-warning=ExperimentalWarning
<checkout>/plugins/claude-code/dist/cli/squeal.mjs` as `CLI`. Full absolute argv
and outputs are in the [probe logs](probes/issue-119/README.md).

| Fixture | Exact CLI arguments | Elapsed | Exit | Result |
| --- | --- | ---: | ---: | --- |
| Scripted acceptance after 12 s, fast/slow results after 14/16 s | `run --slow --wait 3000000` | 10,221 ms | 1 | Receipt only; both files pending. |
| Same fixture, next command | `status --wait 3000000 test/slow.test.mjs` | 6,185 ms | 0 | Slow file current; both files finished. |
| Scripted immediate acceptance, results after 2/4 s | `run --slow --wait 3000000` | 4,177 ms | 0 | Returned on quiet; slow result present. |
| Real node:test baseline, fast file sleeps 12 s | `status --json` | 132 ms | 0 | Fast running, slow queued, slow tier waiting for fast. |
| Same real baseline | `run --slow --wait 3000000` | 1,528 ms | 0 | Slow result current; baseline fast file still running. |
| Real edit control, initial baseline | `status --wait 20000 fast.test.mjs slow.test.mjs` | 1,418 ms | 0 | Both initial results current. |
| After editing both files | `status --json` | 137 ms | 0 | Revision 1: fast running, slow queued. |
| Same edit | `run --slow --wait 3000000` | 13,543 ms | 0 | Waited through fast work and slow result; both current. |

**verified by experiment, 0.1.370:** the protocol reproduction prints:

```text
Slow tier requested (request probe-request); the daemon takes it once its current work allows
```

There is no status output and stderr is empty. The socket received one `run-slow`
and 100 `run-slow-status` requests. It received no `sync` until the separate named
wait. This proves the result wait was not entered. The scripted store changes
model results; only the two real-daemon controls execute node:test files.

## Source evidence and contract

**read in source code, 0.1.369/0.1.370:** `src/cli/run-slow.ts:11` sets
`RECORD_WAIT_MS = 10_000`. `taken()` uses that deadline without the requested
wait duration. Lines 83–87 print the receipt and return `null`; line 45 returns
1. Only line 52 calls `statusWaitCommand(wait.waitMs, false, io, queued > 0)`.
Thus a 3,000,000 ms result budget cannot extend request acceptance.

**read in source code, 0.1.369/0.1.370:**
`src/core/daemon/handlers.ts:229` returns a request ID while the scheduler promise
is unresolved. `src/core/scheduler/scheduler.ts:622` accepts the request under
`#lock.run`, then pumps. The mutex runs calls in order; scheduler start also holds
it across asynchronous work. This supplies a possible delay mechanism, not proof
of the incident's cause.

**read in source code, 0.1.369/0.1.370:** after acceptance,
`src/cli/status-wait.ts:269` captures pending slow files. Quiet requires those
files to finish, but lines 360 onward can return on a transition first.
`slowWaitCode` at line 450 returns 0 on news, even if other slow files remain
pending. `test/cli/run-slow-wait.test.ts` explicitly covers news from one of two
slow files. Those tests were read, not run. Exit 0 alone is not an all-pass verdict.

**read in source code, 0.1.370:** `slow-tier.ts:279` keeps edit-caused fast work
ahead of slow work but exempts an explicit request from waiting for the fast
backlog. This matches **004 D2** and explains the real baseline control. D3 also
lets an explicit request bypass the load guard. **011 C4/C6/C15** distinguish
scheduling, edit-window status and named-file waits. **004 D8/D9** advertise the
slow wait and specify exit 3 for no verdict, 1 for unavailable status. A pending
acceptance with a live daemon falls outside that advertised explanation.

The source comparison against tag `squeal--v0.1.369`
(`10077082aa9c182b61ce06184eb6a7359bba324e`) shows no changes in `run-slow.ts`,
`status-wait.ts`, `status-wait-slow.ts`, `handlers.ts` or `scheduler.ts`.
`slow-tier.ts` adds `runtimePolicy` to a run record; its fast-first rule is
unchanged. This supports applicability to 0.1.369, but is not a run of that version.

## Recommendation and limits

**inferred, 0.1.370:** treat this as a request-wait contract defect, not evidence
that slow scheduling fails. The deciding tradeoff is a short acceptance deadline
versus the explicit caller's longer wait. The current command drops the latter
without a result verdict. The coordinator should settle that contract before a
fix. No implementation or scheduling change is proposed here.

The incident's precise acceptance delay remains unknown. No Vitest/browser suite,
harness session, daemon restart, load-guard delay or failing slow result was
reproduced. The protocol probe reproduced the failure mechanism, not the original
worktree. Research used only isolated stores and sockets and stopped only its own
daemons. Existing holds stand. No repository suite, build or product tests ran.
All three probe drivers exited 0; the failing child exit 1 is the expected evidence.
The final affected check exited 3 because no covered test reads the probes;
1290 repository test files were unknown. Its exact command and output are in the
probe README. No repository-suite pass is claimed.

## Sources

- [Issue 119](https://github.com/hearsay-tools/squeal/issues/119), fetched with `gh issue view 119 --repo hearsay-tools/squeal --json title,body,url,comments` on 2026-10-28; reported version 0.1.369, no elapsed timing.
- [CLI source at tested commit](https://github.com/hearsay-tools/squeal/blob/9e4206a2d72738d6964b955aa0dc7073796f4d15/src/cli/run-slow.ts), and the local source paths above; inspected through `sed`, `nl`, `rg` and `git diff squeal--v0.1.369 HEAD -- <paths>`.
- [011 spec](../spec.md), C4/C6/C15, and [amendments](../status.md); [004 spec](../../004-slow-suites/spec.md), D2/D3/D8/D9, at the tested commit.
- [Probe scripts and raw results](probes/issue-119/README.md).
