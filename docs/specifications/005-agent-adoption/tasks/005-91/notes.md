# 005-91 worker notes

Wave 14, worker session bacce449. Rows 005-90 and 005-91 in one branch.

## (d) Registrations at a tool boundary

Question: why did 187 tool-boundary (`PostToolBatch`) deliveries carry a registration with the whole primer (research finding 11)?

### Resume: fixed

`src/harness/shared/session.ts` handled SessionStart source `resume` as `startup`: it swept, registered and sent the whole primer. A resumed session keeps its context, so the primer was there already. Now a `resume` on a main agent with a store sweeps and registers as before, and sends the registration with no primer. `compact` (primer alone, or registration and primer when not registered) and `clear` (registration and primer) are unchanged. Codex shares `startSession`, so a Codex `resume` also gets no primer; Codex `clear` still maps to `startup`.

In the scan below, `SessionStart:resume` ran 276 times; each of those sent the whole primer before this change.

### Tool-boundary registrations: not a resume; not changed

`deliver.ts` registers a consumer that is not registered (`!isRegistered`), with the primer (`withPrimer`). A resume does not cause these: the resume registers at SessionStart.

Scan (2026-11-16, script in the worker's scratch directory, not kept): Claude Code transcripts under `~/.claude/projects/` for this repository and cezar, modified in the 4 days before, 5,788 files. 177 `PostToolBatch` messages start `SQUEAL · registered at revision`; all 177 carry the primer.

| Case | Count | Cause |
|---|---|---|
| No Squeal message earlier in the transcript, main agent | 45 | SessionStart sent no registration: no store yet, or Squeal not in use at start. The primer is needed. |
| No Squeal message earlier, subagent transcript | 27 | A subagent whose first Squeal message is at a tool boundary. The primer is needed. |
| An earlier registration in the same transcript, last Squeal message 10 min or more before | 87 | The consumer expired while the session ran: the 10-minute waiterless rule (`WAITERLESS_EXPIRY_MS`, a free waiter lock) or the 12-hour rule (`expireConsumers`). |
| An earlier registration, last Squeal message under 10 min before | 17 | Not determined. Candidates: `dropGoneHarnesses` (the recorded harness process gone) or `dropLeft`. |
| An earlier registration, a SessionStart `compact` in between | 1 | Compaction. |

No boundary registration that followed an earlier one had a SessionStart `resume` between them, and in each of those 105 the transcript had a record less than one minute before: the same process went on.

Proposal for a later row (not done here, since it is not a resume): when a consumer that was registered earlier in the same session registers again at a tool boundary, send the registration with no primer, unless a compaction came between. 105 of 177 (59%) are of this kind. It needs a record that the session already heard the primer that survives expiry (the parked view, `park` in `registered.ts`, is a candidate). The 17 under 10 minutes need their cause before that row.
