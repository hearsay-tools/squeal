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

## Texts before and after (wave 14)

**005-90, registration while the test files are not listed** (also Stop's header, which shares `headerLines`):

- Before: `Revision 0: 0 current, 0 pending, 0 stale, 0 unknown. The daemon has not listed this worktree's test files yet; these counts are not complete. Full-suite checkpoint: none completed at any revision (the counts are for revision 0; `squeal run --all` requests one). A daemon is starting; results are as of revision 0.` then `Known failures: 0; the daemon has not listed this worktree's test files yet`.
- After: `Revision 0: Squeal is still starting in this worktree and has no results yet. `squeal status --wait 60000 <path>...` waits for the files you change. A daemon is starting; results are as of revision 0.` No `Known failures:` line for zero failures; a failure the store holds keeps its line (`Known failures: 1 (1 test); the daemon has not listed this worktree's test files yet`). The checkpoint sentence and the delay sentence are left out while unlisted, since both speak of counts. Install sentences and holds stay.
- News header: `Revision 2 (changed src/a.ts): no check pending, stale or unknown. The daemon has not listed …` becomes `Revision 2 (changed src/a.ts): Squeal is still starting … waits for the files you change.` and the daemon sentence.
- `squeal status`: the `Known failures: 0; …` and `Affected checks: none counted; …` lines become the one sentence, after `Revision:`. The checkpoint line stays (status is read on request). The outstanding line `the daemon is still listing this worktree's test files; `squeal status --wait 60000` waits for it` is unchanged.
- Not changed: Stop's own `Known failures:` line.

**005-91 (d), SessionStart `resume`**: registration and primer before; registration alone after.

**005-91 (a), heartbeat**: `SQUEAL · the daemon's heartbeat is late at revision N` and `SQUEAL · a daemon is validating again at revision N: its heartbeat is current` are no longer sent alone while the heartbeat is under 60 s old. The header sentence `The daemon's heartbeat is late: the last one was 20 s ago, …` stays in any other delivery. Threshold: `LATE_HEARTBEAT_NEWS_MS = 60_000` in `src/core/delivery/liveness.ts`, a fixed time, not a factor of the daemon interval (5 s on every machine; only tests set another). It is the age of the last heartbeat, the number the header prints. The `Not validated:` line after an edit with no daemon reachable is unchanged (`deliver.ts`).

**005-91 (b), group lines**: before, `browser: 4 test files; …` came whenever a count moved; after, the first time for a consumer and when the group's kind changes (all current, waiting, not run). A failure adds no group line (coordinator 4d2ecbfc, option B). The slow-tier line keeps its old rule. The told value stored per consumer changes format, so a consumer registered before the upgrade gets its group lines once more.

**005-91 (c), titles** (`src/core/delivery/content-title.ts`): `SQUEAL · revision 5` becomes, by content, `SQUEAL · your edit queued 2 test files at revision 5`, `… your edit re-keyed 1 test file …` (no group at `edit`), `… your edits' test files are current …` or `… finished …`, `… the counts after the listing …`, `… browser group waiting …`, `… slow tier waiting …`, `… lint config changed …` / `lint summary` / `lint unknown` / `lint off`, `… commit abc1234 …`, joined by `; `. The bare title remains only for a delivery none of these covers (code lines with no change to count).
