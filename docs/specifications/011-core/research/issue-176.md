# Issue 176: revision-zero startup stalls

Keep the issue open for a startup-blocker investigation; the heartbeat and request symptoms reproduce, but the reported lock-to-permanent-stall chain does not.

The deciding tradeoff is diagnostic certainty: a socket reply and an unlisted
revision do not identify the main thread's current operation. The probes show
the same outward failure during configuration loading without any store lock.
Increasing a lock timeout is therefore not supported by this evidence.

## Scope and versions

Research on 2026-11-11, within the assigned 15-minute limit. Issue
[176](https://github.com/hearsay-tools/squeal/issues/176) reports **0.1.427**,
revision 0, host load 31–58 on 24 CPUs. It contains no status JSON or lock stack.
This is the reporter's account, not an independently verified incident trace.

Experiments used the committed CLI bundle at **0.1.430**, checkout
`1ac649d408c9043997fd4eeb0c0ed3a079b1da4c`, Node **24.22.1**, Vitest **5.0.3**.
Initial load was **16.39 / 24 CPUs**. Per-probe loads were **13.94, 15.79,
16.56 and 14.61**; none required skipping. Each fixture had an isolated store,
an empty test selection and a lookup-only baseline. No product files, existing
holds, other daemons or other stores were changed. No suite or build ran.

## Questions and verdicts

The brief's questions are numbered here for traceability. Experiment claims
below are for 0.1.430; source claims also apply to the examined 0.1.427 paths,
which have no diff against this checkout.

| Question | Answer | Evidence tag |
| --- | --- | --- |
| Q1. Does a startup store lock reproduce the incident? | A four-second lock before registration deferred the request, then recovered. No `database is locked` error or permanent stall. | verified by experiment, 0.1.430 |
| Q2. Does “not listed” locate the stall in test listing? | No. Both config-loading probes report revision 0, `testFilesListed: false`, `refinedRevision: null`. | verified by experiment, 0.1.430 |
| Q3. Does slow startup stop heartbeats? | An asynchronous delay does not; a synchronous main-thread delay does. | verified by experiment, 0.1.430 |
| Q4. Can the socket answer while requests remain untaken? | Yes. Both delayed starts return a request ID and an exit-3 deadline message. | verified by experiment, 0.1.430 |
| Q5. Can stop wait for startup? | Yes. Stop did not finish within the probe's eight-second bound; the daemon exited normally after config loading ended. | verified by experiment, 0.1.430 |
| Q6. What caused the reported permanent stall? | Not determined: no incident stack, exact failing write, store snapshot or status JSON is available in the issue. | inferred, reported 0.1.427 |

## Findings

**Q1, startup lock.** **Verified by experiment, 0.1.430.** A child held
`BEGIN IMMEDIATE` on the private store for four seconds at `store-open`, before
registration. Status returned in 205 ms with no registered worktree and no
listed files. `run tests --wait 1000` returned exit 3 in 1,194 ms: the main thread
had not read the request. After release, status showed a live daemon and listed
revision 0. A new request reached the scheduler in 295 ms, with no verdict
because the group was empty. No lock error appeared. This tests recovery from
a short lock, not exhaustion of the shipped 120-second timeout.

**Read in source code, 0.1.427/0.1.430.** `open.ts:54,221` sets the startup
connection timeout to 120 seconds. `daemon.ts:290–314` binds the desk, registers,
then starts timers. Registration is a `BEGIN IMMEDIATE` transaction
(`daemon.ts:443`, `store/connection.ts:49`). It is not wrapped in the short-slice
retry path. A registration error enters `start-failed` shutdown. After
`loop.start()`, `daemon.ts:854` lowers the connection timeout to five seconds.
This matches C7's explicit startup exception; a new startup retry rule would
need a decision, not an assumption that the existing serving-daemon rule covers it.

**Q2–Q4, listing, heartbeat and acceptance.** **Verified by experiment,
0.1.430.** A config awaiting a 14-second timer kept the heartbeat alive at the
ten-second observation. Its one-second request ended in 1,170 ms with:

> it waits for the daemon's startup, which has run for 11 s

The equivalent synchronous `Atomics.wait` gave status `state: "down"` with
`heartbeatLate.ageMs: 10352`, while the socket still answered. Its request ended
in 1,164 ms with:

> the daemon's main thread has sent no heartbeat for 11 s and has not read the request for 0 s

Both recovered at revision 0 with `testFilesListed: true` after the delay.
The subsecond unread interval is printed as zero seconds. Neither experiment
uses a lock or runs tests. Thus the heartbeat/request symptom is reproduced;
the incident's complete causal sequence is not.

**Read in source code, 0.1.427/0.1.430.** The shipped desk uses a worker thread
(`desk.ts:95–107`, `front-desk.ts:78`), but lifecycle heartbeat uses a main-thread
`setInterval` (`lifecycle.ts:376,434`). Timer writes have 250-ms slices and retry
through `SlicedWrites`; that cannot make a timer run while another synchronous
operation blocks its thread. `#requestGroup` reports generic startup and awaits
`#starting` (`daemon.ts:1002`). Initial runner opening is awaited before
`createDaemonLoop` (`daemon.ts:678`); later baseline listing has a runner bound
(`scheduler/bootstrap.ts:133–138`). The initial `vitestRunner.open()` call has
no such wrapper. The observed “not listed” state covers both phases. Existing
main-step messages name lint keying and shared imports, but these startup calls
send no specific config/list/store step (`daemon.ts:773,842`).

**Q5, shutdown.** **Verified by experiment, 0.1.430.** With the asynchronous
14-second config delay, the private `stop` caller produced no output before
the probe killed that caller after 8,011 ms. The daemon later exited **0**;
status showed it down with its stop note. This is not a reproduction of a
60-second stop timeout. **Read in source code, 0.1.427/0.1.430:** shutdown stops
timers and writes the exit note, then awaits `#starting` before closing the
runner, store, socket and lock (`daemon.ts:1103–1135`). An unresolved startup
promise can therefore hold shutdown; the probe only verifies a finite delay.

## Recommendation and limits

**Inferred from the probes and source, 0.1.430:** preserve a separate startup
investigation. Capture the exact failing write/stack, startup phase, heartbeat
age, request holder and eventual exit before choosing between a store fix and
a runner-opening fix. C6/C15 require honest incomplete state; C7 explicitly
permits the longer startup wait; C9's socket response alone proves no progress;
C13's error path must be assessed at the actual failed write.

Open: which operation emitted the incident's SQLite error; whether config
loading, test listing, hashing or store work occupied the missing-heartbeat
interval; whether requests eventually ran; whether stop remained blocked after
the lock cleared. Large Cezar stores, concurrent worktrees, lint requests,
`squeal code`, timeout exhaustion and load above CPU count were not tested.
The symlinked dependencies produced a manifest-key fallback note, recorded in
the raw output. These tiny fixtures do not reproduce Cezar's scale.

## Sources and exact commands

- Issue fetched with `gh issue view 176 --repo hearsay-tools/squeal --json title,body,comments,url`.
- Version: `node plugins/claude-code/dist/cli/squeal.mjs --version` → `0.1.430`;
  `node -p 'require("vitest/package.json").version'` → `5.0.3`.
- Load: `uptime`, `nproc`, `getconf _NPROCESSORS_ONLN`; each live probe also reads
  `os.loadavg()[0]` and `os.cpus().length` before creating a fixture.
- [Probe commands and method](probes/issue-176/README.md),
  [script](probes/issue-176/probe.mjs), [lock preload](probes/issue-176/preload.mjs),
  [raw commands, outputs and exit codes](probes/issue-176/output.jsonl).
- [Spec C6/C7/C9/C13/C15](../spec.md), [amendment log](../status.md).
- [Source at examined commit](https://github.com/hearsay-tools/squeal/tree/1ac649d408c9043997fd4eeb0c0ed3a079b1da4c/src/core):
  paths above are relative to `src/core/`; deadline text is in
  `src/cli/group-pending.ts:49–104`.
- `git rev-parse squeal--v0.1.427` → `92fdb03d63c07954bb22fefef032c15cce61c06b`.
  `git diff squeal--v0.1.427..HEAD --name-only -- src/core/daemon src/core/store src/core/daemon-loop src/core/scheduler src/runners/vitest src/cli/group-pending.ts`
  → no output. This checks those source paths, not equality of the two releases.
