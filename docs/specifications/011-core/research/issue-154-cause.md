# Issue 154: what held the lint request, and why a docs commit left 2,466 lint checks unlinted

**Verdict.** Daemon startup did not hold the request. A freshly restarted
daemon re-keyed every lint check five times in under five minutes. During the third
re-keying its main thread wrote no heartbeat for at least 21 s. The request
was sent inside a 111 s window in which the daemon stored no lint result. The
docs commit moved no lint key. The first full re-keying came with the
restarted daemon; then each lint part that read a new rule file moved every
key again. Make a pending request name a
stalled main thread, not only the scheduler lock. Keep lint keys stable over a
closure that grows during linting.

Row 011-303, wave 71, W2. Source examined: Squeal **0.1.407**
(`squeal--v0.1.407`, `7fd4a39c9`; `src/` is the same at this branch's base).
Incident runtime: 0.1.407 (Codex plugin `versions/0.1.407`). All times UTC.

## Questions and answers

| Question | Answer and evidence tag |
| --- | --- |
| Q1. What kept request `e147e93c` from being taken within 60 s? | Not startup. **read in source code + transcript, 0.1.407:** `status --wait` returned "on quiet" at revision 4 at 04:26:06; quiet needs the daemon's `sync` answer, and `#requestSync` awaits `#starting` and the scheduler. The request (04:26:58–04:27:58) fell in a stall: **verified by store and transcript records:** last heartbeat 04:26:31.758 (interval 5 s), reported 21 s late at 04:26:53; no lint result stored from 04:26:32.0 to 04:28:23.8. **inferred:** the main thread, which takes the request from the front desk and also runs the heartbeat, was blocked or queued behind work of the third lint re-keying. Which function held it: **not determined**, because the daemon's log goes nowhere and the incident's notes were deleted with its worktree. |
| Q2. Why did a docs-only commit leave 2,466 lint checks unlinted at Stop? | **verified by store records + read in source code:** the commit changed only `.ai/specs/TEMPLATE.md`, `AGENTS.md`, `CODE_REVIEW.md`, `docs/sdlc/ci.md`; none is a lint key input. The worker had stopped the daemon at 04:02; the 04:25 edit started a new one. Its lint pass found the key environment moved and re-keyed every check (`config` mode), five times at revision 4. Stop (04:26:06–04:26:53) saw the first two: 2,466 = 2,882 checks − 416 linted in the second burst. |
| Q3. What moves the lint key environment here? | **read in source code, 0.1.407:** (a) a lint report naming a file outside the snapshot's closure sets `grew`; the pass ends and the next keying, with the larger closure, is `config` mode for every file (`lint-part.ts` `grown`, `rekey.ts` `planOf`). (b) `findConfigs` walks every directory but `node_modules` and `.git`, gitignored ones included, so the e2e served clone `.ai/qa/served/<task>/.oxlintrc.json` and its `plugin.ts` join every key. Which of (a), (b) or a shrunken closure after the restart moved the first revision-4 keying: **not determined**, because the store keeps only the newest inputs record. |
| Q4. Is it issue #138 (busy store)? | **Rejected, inferred from store records:** the neighbour daemon in the same store wrote heartbeats through the window and noted busy waits of 0.2–0.6 s only, all before 04:26:00. A write lock held for 21 s would have produced its note. |

## Timeline (incident worktree `3bbb4966e4ddfdfd`)

From the Cezar transcript of task `54350441` and the cezarion store, read only:

| UTC | Event | Source |
| --- | --- | --- |
| 03:51–04:00 | Squeal runs e2e files at revision 3; `test-env-up.sh` clones the served project into `.ai/qa/served/54350441…` | runs table |
| 04:02:34 | Worker runs `squeal stop`; baseline checkpoint abandoned | transcript, checkpoints |
| 04:25:11–21 | Worker edits and commits `e7fb3339c`; a hook starts a new daemon | transcript |
| 04:25:50 | Baseline checkpoint at revision 4 starts (8 test files) | checkpoints |
| 04:25:59–04:26:13 | 3 runs, 6 test files; 2 slow e2e files wait for the slot | runs, status |
| 04:26:06 | `status --wait` returns on quiet at revision 4: startup is done | transcript |
| 04:26:06 | Stop hook starts; lint is held for `stop` and released | transcript, `lint-held` |
| 04:26:12–16 | Lint burst 1: 112 results | lint results |
| 04:26:21–32 | Lint burst 2: 416 results, new keys | lint results |
| 04:26:31.758 | Last heartbeat before the stall | Stop's status text |
| 04:26:53 | Stop gives up: 2,466 not linted; heartbeat 21 s late | transcript |
| 04:26:58 | `squeal run lint --wait 60000` sent | transcript |
| 04:27:58 | Exit 3: "the deadline passed before the daemon took request e147e93c…" | transcript |
| 04:28:23–04:29:22 | Lint burst 3: 1,632 results | lint results |
| 04:29:27–04:30:38 | Lint burst 4: 2,064 results, new keys | lint results |
| 04:30:39 | Keying record `seq 9, mode config, revision 4` | `lint-keying` |
| 04:30:43–04:32:20 | Lint burst 5: all 2,882 checks, final keys, 0 findings | lint results |
| 04:30:50 | Baseline completes when the neighbour finishes `task-thread.e2e.ts` | checkpoints, neighbour runs |

7,106 lint results were stored for this worktree's checks in the window; the
neighbour linted nothing then. 818 checks were linted once, 16 twice, 1,936
three times, 112 four times. The same file at the same bytes was linted again
only because its key moved.

## Findings

**F1. The front desk answers; the main thread takes.** *read in source code,
0.1.407.* `front-desk.ts` answers the socket from its own memory in a worker
thread and posts `run-group` to the main thread. `#requestGroup` awaits
`#starting`, then `scheduler.requestGroup` takes `#lock`. While the main thread
is blocked, `run-group-status` keeps answering `requested: null`, so the CLI
prints the incident's line. The CLI also prints that line when a status poll is
unanswered before the deadline (`run-lint-group.ts:104`).

**F2. Startup was over.** *read in source code + transcript.*
`status-wait.ts:425` decides quiet only once the daemon's sync answered at the
revision. `#requestSync` awaits `#starting`, then `loop.reconcile()`. The wait
at 04:26:06 returned on quiet at revision 4.

**F3. The stall was on the main thread, cause open.** *verified by records;
interpretation inferred.* Heartbeats come from `setInterval` in the daemon's
main thread (`lifecycle.ts:415`). The store was not write-locked for long (Q4).
Keyings 1, 2, 4 and 5 each took 5–6 s from the release or the end of one
burst to the next burst; the third took 111 s. Excluded by measurement: the oxlint config walk
(`configwalk.mjs`: 2,016 directories, 31,809 entries, 133–307 ms on a current
cezarion worktree with a served clone, at load 59/24) and coverage records
(last one stored 04:26:15).

**F4. Re-key cascade after a restart.** *read in source code; counts verified
by store records.* The keying record counter reached 9. *inferred:* five
bursts with moved keys mean five keyings at revision 4, so four came before. Each `grew` part stores nothing for its moved files and starts a
full `config` keying, so every lazily read rule input (baselines, JSON lists,
`.env.example`, `styles/index.css` are in the final closure) can cost one full
re-lint. The final inputs record holds 32 files.

**F5. The served clone is a lint key input.** *verified by store records +
read in source code.* 27 of 230 `lint-inputs` records in the cezarion lint
store name `.ai/qa/served/…/.oxlintrc.json`; three name configs inside served
clones of nested worktrees. The directory is gitignored (`.ai/qa/**`). A cold
`test-env-up.sh` boot clones it again.

## Recommendation for Squeal

1. W1 (row 011-302): name the holder from the front desk, which still answers
   during a stall. Report "the daemon's main thread has not answered for N s"
   when it has posted nothing back, beside the scheduler-lock label. A label
   kept only inside the main thread cannot be read while that thread is blocked.
2. A new row: a pass whose report grew the closure should add the new inputs
   without moving every key, or key once more only the files that read them.
3. A new row: oxlint config discovery should skip gitignored directories, as
   the pass already skips gitignored files.

## Open questions

- Which main-thread work ran 04:26:32–04:28:23. Decides between a lint-pass
  fix and a scheduler fix. Needs a CPU profile of a restarted daemon on a
  cezarion-sized copy, at load at or below 24. Not run: load was 31–59 for
  this whole session.
- Whether the request was taken before 04:30:50. No record of acceptance.
- What moved the first revision-4 keying (Q3).

## Commands and load

Read-only, at one-minute load 31–59 on 24 CPUs; no daemon started, no test run.
`gh pr view 2755 --repo hearsay-tools/cezarion`; `gh issue view 154`; the
transcript `~/projects/cezar/.ai/cezar/runs/54350441-….ndjson.br`; SELECTs with
`node:sqlite` `readOnly: true` on `~/projects/cezar/.git/squeal/{store,lint,code}.sqlite`;
`configwalk.mjs` once on worktree `01e9423c`. Probes and commands:
[FORENSICS.md](probes/issue-154/FORENSICS.md), `forensics.mjs`,
`transcript.mjs`, `configwalk.mjs`.

## Sources

- Issue: <https://github.com/hearsay-tools/squeal/issues/154>; PR:
  <https://github.com/hearsay-tools/cezarion/pull/2755> (head `e7fb3339c`).
- Squeal 0.1.407: `src/core/daemon/{daemon.ts,front-desk.ts,lifecycle.ts}`,
  `src/core/scheduler/scheduler.ts`, `src/core/daemon-loop/index.ts`,
  `src/cli/{run-lint-group.ts,status-wait.ts}`,
  `src/core/lint/pass/{index.ts,run.ts,rekey.ts,keys.ts,lint-part.ts,records.ts}`,
  `src/core/lint/provider/oxlint/{configs.ts,config-set.ts,provider.ts}`.
- cezarion `origin/main`: `.gitignore`, `.oxlintrc.json`,
  `.ai/scripts/test-env-up.sh` (served clone), `squeal.config.json`.
- Prior findings: `issue-154.md` (startup-gate reproduction), `issue-138.md`.
