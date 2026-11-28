# The five intermittent CI rows left after 0.1.664 (wave 132 research)

Researcher, 2026-11-28, wave 132. Brief: `../tasks/wave-132.md`, section "Research". Squeal at `0e5223ca8` (0.1.665). Research only. Probes and data: [`probes/ci-flake-remaining/`](probes/ci-flake-remaining/README.md). Background: `ci-flake-census.md` (row 011-428), `ci-shard-workers.md` (row 011-435).

**Recommendation.**

- **011-440:** a product repair. The gate treats a code store that another process is still creating as unreadable, and then keeps nothing and gives no reason. It should count such a store as missing.
- **011-439:** a product repair. A hook goes silent in two ways, and the slow sandbox showed both: the daemon's answer to one status poll comes later than 250 ms, though the write already landed; or a lease request whose answer came late leaves a lease no one uses or releases. A busy store was not seen there.
- **011-442:** honour `VITEST_MAX_WORKERS` as a ceiling.
- **011-438:** keep the gate's silence on a miss, and stop the miss from cascading.
- **011-436:** a test repair: one atomic write, and a call log that names any second writer. Its second writer is not determined.

## Answers

| Row | Question | Answer | Tag |
|---|---|---|---|
| 011-440 | Source of the proof red `stored: false` | The red side's run child opens `code.sqlite` while the green side's commit daemon is creating it. It reads schema version 0, or "database is locked" at once. `readStores` then returns `null`, so the gate runs every file, keeps none, and tells no reason | verified by experiment (slow boat.dev sandbox, 3 of 3 runs; deterministic local probe; the candidate repair removed it in 2 runs) |
| 011-440 | Gate or test wrong? | The product gate. The test asks for what the product promises: a completed red run is kept | verified by experiment |
| 011-442 | Does `VITEST_MAX_WORKERS` override the adapter's count? | Yes. It replaces every project's own `maxWorkers`: a grant of 3 runs at 2, and a project that set 1 runs at 2. Vitest 5.0.3 has no `VITEST_MIN_WORKERS` | verified by experiment (`width.test.ts`, 8 of 12 fail); read in source code (Vitest 5.0.3) |
| 011-439 | Is the silent hook a store busy past 1 s? | Not in the sandbox reproduction. 12 of 30 runs had a silent hook. In 6, a session-start's `write-status` poll got no answer in 250 ms, though the daemon had written the batch within 1 ms. In 6, a post-tool-batch met a lease that the daemon granted after its requester had given up waiting. A busy store also silences a hook (local probe), but no run showed it | verified by experiment |
| 011-438 | What happens when the `tool_call` gate misses its 2,000 ms | The edit is applied, the worker is discarded, and the failure stays owed: the next boundary tells it. A main-thread stall alone does not cause a miss | read in source code; existing tests run; stall verified by experiment |
| 011-436 | Why a second newline after `36c776cdf` | Not determined: no reproduction in 26 isolated runs and 3 shard runs with a logging shim and `fatrace`. One claim per test case, and only the test and the claimed shim wrote `src/mod.js` | verified by experiment (no reproduction) |

## 011-440: proof red `stored: false` (flake-0.1.597-storage)

**Reproduction.** Sandbox `bx_jm36fy8g` (boat.dev default, 4 vCPU, 3.79 GHz, Node 22.19.0). The five named files run alone failed one test in each file on the first run. Later runs of two of them (`proof-kept-key`, `proof-not-kept`) failed in 1 of 22 runs. All 26 `test/cli/proof*.test.ts` files at once (load 4.9 to 6.2) failed 11 tests in each of 3 runs. In every failure, the red side read `"notStored": "the gate did not keep it and gave no reason"`; `proof-not-kept` expects its gate's own reason and got this one as well. In the failing pair run, the run child told no keeper note at all, where a passing run tells whether it kept the file (`data/bx_jm36fy8g/loopA-*`). **verified by experiment**

**Mechanism.** Patches that log each `openReadOnly` call and each run child's answer (`sandbox/patch-stores.sh`). In the three all-proof runs, 33 to 36 opens per run returned `null` for `code.sqlite`: 97 read `user_version` 0, and 7 got "database is locked". Each such run child then answered with `kept=0 notKept=0`. Ten of the 11 failed tests in run 1 trace to such an unstored side: `stored: false`, a second call that ran again instead of reading the store, no stored rows, or two projects that cannot be told apart without a stored result. The eleventh (`proof-repeat`) read "its commit daemon … did not answer before the deadline", another cause. **verified by experiment**

The window is in `openCodeStore` (`src/core/code/store/open.ts:72-88`). `new DatabaseSync(path)` creates the file at once with schema version 0. The WAL switch (exclusive) and `migrate`, which sets the version, come after. `openReadOnly` (`src/core/store/open.ts:276-288`) returns `null` for any version other than the expected one and for any error. `readStores` (`src/core/code/gate/stored.ts:260-275`) returns `null` when either store is `null`. `openStored` then returns `null` (`:115-117`): no keeper. `notKeptWhy` (`src/cli/status-at-run-outcome.ts:182-198`) finds no reason and says "gave no reason". **read in source code**

The local probe `store-window/` shows it deterministically (Node 26.13.0): with `code.sqlite` created but not yet migrated, `readStores` returns `null` in 0 ms. With another process inside a creating transaction, it returns `null` after 1,002 ms. Once migrated, it opens. **verified by experiment**

The creator is **inferred** to be the green side's commit daemon, which runs in the test's process and is asked before the red side runs (row 023-42). In passing runs the parent saw `code.sqlite` missing, and the red child found it whole about 4 s later.

**Repair (product), S.**

1. `readStores` treats a code store (and the main store) that reads schema version 0, or is locked at open, as missing, not unreadable. The keeper already opens with create, waits for the creator under the lock, and migrates (a no-op for an already migrated store).
2. When the stores are not read, the reason is told and reaches `notStored`, never "gave no reason".

Candidate check on the same sandbox: `sandbox/patch-fix.sh` applies step 1 as a probe. In two complete all-proof runs, 35 and 32 opens met the creation window and counted as missing. Run 1 passed 125 of 125 tests. Run 2 failed only `proof-repeat`, the commit-daemon deadline above. The baseline failed 11 in each of 3 runs. A third run was cut short when the sandbox was deleted. **verified by experiment**

A test can hold `code.sqlite` at version 0 (the probe's step 1) while a proof side runs, and expect `stored: true`. Without the guard it reads `stored: false`.

## 011-442: `VITEST_MAX_WORKERS` in a user's environment

Vitest 5.0.3 reads the variable in `resolveConfig`, for every config it resolves, root and project alike: `if (process.env.VITEST_MAX_WORKERS) resolved.maxWorkers = Number.parseInt(...)` (`node_modules/vitest/dist/chunks/index.DpLw24bj.js:14592`). At run time, `resolveMaxWorkers` takes the project's value, then the root's, then the CPU default (`:11849-11855`). No `VITEST_MIN_WORKERS` or `minWorkers` exists in 5.0.3. **read in source code**

Squeal does not filter the variable. The runner host gets the daemon's whole environment (`src/core/runner-host/channel.ts:51-64`, `env = process.env`), and no `src/` file names `VITEST_MAX_WORKERS`. The adapter reads each project's resolved `maxWorkers` as that project's own ceiling (`widthTable`, `src/runners/vitest/width.ts:65-75`) and writes `tierWidth(want, ceiling, floor)` before each run (`apply`, `:146-155`). So the variable becomes the ceiling of every project, and it replaces a value the project set itself. **read in source code**

`VITEST_MAX_WORKERS=2 timeout 600 pnpm exec vitest run test/runners/vitest/width.test.ts` on this host: 8 of 12 tests fail. A grant of 3 runs at 2 ("expected 2 to be 3"). A project with `maxWorkers: 1` runs at 2 ("expected 2 to be 1", twice). The slow tier's instance of width 4 runs at 2. The backlog width answer is 2 for an offer of 4. **verified by experiment**

Options for the decision card:

| Option | What the user sees | Example | How often | Cost |
|---|---|---|---|---|
| A. Clear it: Squeal removes the variable from every Vitest it starts | Squeal's background runs use Squeal's own grant (at most 75 % of CPUs) and the project's config. The user's variable applies only to their own `vitest` runs | A user exports `VITEST_MAX_WORKERS=2` to keep a laptop cool. Squeal still runs up to its grant, for example 6 workers on 8 cores | Every run of a user who sets it. Squeal has no telemetry, and our CI does not set it | XS: delete it in the runner host's environment and in the daemon's own `process.env` at start |
| B. Honour it fully (today) | The variable caps every run, and it also raises a project's own `maxWorkers: 1` | A project that sets `maxWorkers: 1` because its tests share a database: with the variable at 4, Squeal runs 4 of its files at once, and they fail where `vitest` with the same variable fails too | As A | None. It matches plain `vitest` with the same variable |
| C. Honour it as a ceiling: Squeal reads it, removes it from Vitest's environment, and caps each width at it | Squeal never runs more workers than the variable allows, and never more than a project's own value: a 1 stays 1 | `VITEST_MAX_WORKERS=2`: a grant of 6 runs at 2, a project with `maxWorkers: 1` runs at 1 | As A | S: one parse, `min(own, variable)` in `widthTable`, the variable removed from the environment, a test of each case |

Recommended: C. It keeps the user's "no more than N" and never breaks a project's serial setting. Either way the daemon reads the variable once, at its start, so a later change needs a restart (`squeal stop`, then the next hook starts it).

## 011-439: `integration/node-test.test.ts:209,286` read an empty hook

**CI sightings.** 5 in 9 days (2026-11-19 to 11-27): three at `:209`, where session-start is `''`, and two at `:286`, where post-tool-batch is `''` (`probes/ci-flake-census/census.csv`). That is 0.4 per 100 completed runs over the census window. **read from CI annotations**

**Reproduction.** Sandbox `bx_4tg4uuwd` (3.79 GHz, Node 22.19.0), the test patched so its hooks run with `SQUEAL_HOOK_DEBUG=1` and log their stderr (`sandbox/patch-nodetest.sh`). In later runs, the hook's `DaemonWriter` and the daemon's write desk also log leases, writes, settles and releases (`patch-writer.sh`, `patch-desk.sh`). Load 6 to 12 during the runs. 30 runs; 12 had a silent hook and failed as on CI. **verified by experiment**

- **Session-start, 6 times:** `Error: no answer from <daemon socket> in 250 ms`, the CI line `expected '' to match /^SQUEAL · registered at revision \d+/`. While a daemon serves, a hook sends its writes to it (`DaemonWriter`, spec 021 D15). The desk log shows that the daemon took and wrote both of the hook's batches within 1 ms (`data/bx_4tg4uuwd/nodetestD-2/desk.log`). But the hook's next `write-status` poll got no answer from the daemon's socket in 250 ms. That poll is `requestDaemon(…, SMALL_REQUEST_TIMEOUT_MS)` (`src/core/delivery/daemon-writer.ts:113-117`). Unlike the lease and release requests, it is not wrapped in `#ask`, so the first missed answer throws. `runHandler` turns every error into empty output (`src/harness/claude-code/run.ts:54-62`). The registration was stored; only its text was not printed. **verified by experiment; read in source code**
- **Post-tool-batch, 6 times:** `database is locked: the worktree's write lease is held by <pid> <the test's Vitest worker>`, the CI line `expected '' to contain 'PASS -> FAIL'`. In run D-7 the desk granted a lease to the test's process 374 ms *after* the session-start hook had returned (`nodetestD-7/desk.log`). The hook's own lease request waits 250 ms. With no answer, `#ask` returns `null`, and the hook writes the store itself (`daemon-writer.ts:148-158`, `#notTaken`) without knowing the late token. So the granted lease has no write and no release. The desk keeps a lease with no pending write while its holder's process lives (`src/core/daemon/write-desk.ts:198-215`). This test runs its hooks inside its own long-lived process, so 13 s later the post-tool-batch was refused 23 times over its 1 s bound (`pending=0 releasing=false`) and threw. **verified by experiment**

**What the user sees.** A silent hook is not lost news. The local probe `hook-busy/` (a store whose write lock is held for 3 s) shows: the busy session-start and post-tool-batch print nothing after 1,004 ms. The next post-tool-batch prints the PASS -> FAIL. A session whose only session-start was silent is registered by its first post-tool-batch, which prints "SQUEAL · registered …". **verified by experiment.** For a write that the daemon took before the poll failed, the next hook says the registration text it owes (`sayOwed`, `src/harness/shared/owed.ts:79-89`, row 005-98). **read in source code.** So today the user sees Squeal one tool call late: the session's first tool calls run without its header and primer, or one transition comes one call later.

An orphaned lease matters beyond tests. A Claude Code or Codex hook is its own process: when it exits, the desk drops its lease at the next ask (`lives === false`). In Pi and OpenCode, Squeal's writer lives in the harness's process (Pi's delivery worker thread, OpenCode's plugin). One late lease answer there would hold the worktree's lease until that harness exits. Every later Squeal write in that worktree, from any session, would wait its bound and fail. **inferred** from `write-desk.ts:198-215` and `daemon-writer.ts:148-158`; not run in Pi or OpenCode.

Options for the decision card:

| Option | What the user sees | Example | How often | Cost |
|---|---|---|---|---|
| A. Test only: the test retries a hook that printed nothing | Nothing changes for users: a slow daemon answer still delays Squeal's text by one tool call | — | 0.4 per 100 CI runs stop failing | XS |
| B. A missed status answer is asked again within the hook's existing 1 s bound, as a busy answer is | The hook prints on time when the daemon answers within the hook's bound, and goes silent only after it | At session start on a loaded laptop, the daemon's answer comes after 300 ms: today nothing is printed, with B the header is printed at once | 6 of 30 sandbox runs at load 6 to 12; the CI `:209` sightings, **inferred** | XS: `daemon-writer.ts` `send` loop; a test with a daemon stub that drops one status answer |
| C. No orphaned lease: the lease request carries an id the client makes, and a client that gave up waiting releases by that id (as keep requests are reconciled by id); or the desk ends a lease that saw no write within `LEASE_TTL_MS` | A long-lived Squeal client (Pi, OpenCode, a test) never meets a lease that no one holds | A Pi session where one lease answer came late: today every later Squeal write in that worktree waits 1 s and fails until Pi restarts; with C the next write proceeds | 6 of 30 sandbox runs (in-process hooks); in Pi and OpenCode not measured | S: `daemon-writer.ts` and `write-desk.ts`; a test with a desk that answers a lease late. The TTL variant must keep review 0.1.442 B3: a paused client keeps a lease it wrote under |
| D. A busy or slow store prints one line, for example "SQUEAL · results follow at your next tool call" | The agent learns that Squeal is there but late | — | As A | XS, but the line gives the agent nothing to act on (the human, 2026-11-16: hook text only what the agent can act on) |

Recommended: B and C together. They remove both causes seen, keep goal 6's bound, and do not touch the busy-store case: that case is already silent by design and still told one call later.

## 011-438: Pi's `tool_call` gate misses its 2,000 ms deadline

**What happens.** `tool_call` asks the worker about `edit`, `write` and `bash` with `EVENT_DEADLINE_MS` = 2,000 (`src/harness/pi/extension.ts:8,247-260`). On `null` the call goes through. On a miss, the host settles the call `null`, abandons the worker's held answer, and terminates the worker: "One stalled request means the worker is wedged" (`src/harness/pi/host.ts:122-127`). The next event starts a fresh worker. An abandoned denial is not committed, so the regression stays owed and the next boundary tells it. `test/harness/pi/held.test.ts:120` asserts exactly this for a boundary; `held.test.ts` and `host.test.ts` pass at this commit. **read in source code; existing tests run**

**What the user sees.** An `edit` or `write` that Squeal would deny once, because a PASS -> FAIL is not yet told, is applied. The agent hears the failure in the entry after that tool batch (`turn_end`), if the fresh worker answers within its own 2 s. The gate is on by default (`interrupt.onRegression: true`, `src/core/types/policy.ts:510`).

**How often.** Two CI sightings of the gate test in 30 days: `pi-events.test.ts` "blocked once" let the write through on candidate runs 43528167215 (2026-11-13) and 44925509519 (2026-11-21), both Node 22. That is 0.17 per 100 completed runs. One more local sighting at load 43, in row 014-04's gate (board row ci-43528167215). On `bx_4tg4uuwd` at load 1.4 to 2, 8 runs of both cases passed. The gate's ask took 4 to 6 ms (`sandbox/patch-gate.sh`). **verified by experiment**

**What causes a miss.** Not determined. The local probe `pi-stall/` refutes a main-thread stall: with Pi's main thread held 2,100 or 3,000 ms right after the call (`Atomics.wait`, no CPU load), the call still resolves with the worker's answer, and the next call reuses the worker. **verified by experiment.** So a miss needs the worker itself to take over 2 s: a starved worker thread, as at load 43. **inferred.** A worker that meets a busy store answers `null` after its 1 s busy timeout, or after the lease bound of row 011-439 C. That gives the same visible effect without a miss. **read in source code**

Options for the decision card:

| Option | What the user sees | Example | How often | Cost |
|---|---|---|---|---|
| A. Keep: a miss lets the edit through (spec 009 D4: a miss is silence) | One edit lands over a failure Squeal has not yet told. The failure arrives right after that tool batch | The agent breaks `math.test.ts`, then writes `notes.md`. With the gate the write is denied with the FAIL; on a miss the write lands and the FAIL follows | 0.17 per 100 CI runs on 4-vCPU runners; on a user's machine only under heavy load | None |
| B. Keep the worker after a gate miss: drop the call, not the worker | As A, but the FAIL after the batch comes from a warm worker, so a loaded machine does not miss the next deadline too | As A, and on a machine at load 40 the FAIL still arrives at the batch's end | As A | S: `host.ts` keeps the worker unless it misses twice in a row; a test with a stub worker that stalls one `toolCall` |
| C. Deny on a miss: when the gate cannot answer in time, the edit is not applied, with "Squeal could not check in time; re-issue the edit" | No edit ever lands over an untold failure, but a miss also denies an edit when nothing failed | A loaded machine: the agent's write is denied with no failure behind it, and it re-issues it | Every miss, with or without a failure | S, and a wedged worker would deny each write until a re-issue passes |
| D. Answer the gate from memory: the worker keeps "a failure is owed to this session" current and reads the store only when it is set | Misses become rare, because the usual answer needs no store | — | Removes most of A's misses | M; a stale flag could deny once after the failure was already told |

Recommended: A and B. D4's silence stays, a miss no longer cascades into a cold start, and a test forces the miss with a stub worker. To stop the CI re-runs, the e2e case should accept the documented miss path: the write applied and the FAIL told exactly once at the next boundary, beside the denial.

## 011-436: `optimizer-start.test.ts:170` reads a second newline

**Sightings.** Before `36c776cdf` (test-then-create claim): `"old";\n\n\n` on 44092143277 and 44107971129 (2026-11-17). After it: `"old";\n\n` once, main 45806426506 attempt 1 (2026-11-26, `42db95cea`, Node 22 4/6), in "observe false", the second case of the file. The file took 14.5 s in that job. The mkdir claim is present at `42db95cea`. That is one sighting in 434 completed main and candidate runs since the fix (each runs the whole suite on Node 22, `runs.csv`). **read from CI annotations, the job log and git**

**Probe.** `sandbox/patch-shim.sh` makes the shim log every call: time, pid, ppid, arguments, the claim, and `src/mod.js`'s bytes before and after its write. `fatrace -f W` names every process that writes a file called `mod.js`. On `bx_727ehrav`: 26 isolated runs, and 3 runs of shard 5/6 (where the file is now; 415 files, 2,998 tests passed each time, load 5.6 to 6.9). No second newline. In every case (two per run, each with its own shim), exactly one shim call claimed (`config --get …`, within 10 ms of `ls-files` and `status`). Only two processes wrote that case's `src/mod.js`: the test's own Node process (OLD at creation, NEW before the daemon starts) and the claimed `git` (`printf`, then `echo >>`). No product code writes the working tree: no `checkout`, `stash`, `restore`, `apply` or `read-tree` in `src/`. **verified by experiment** (no reproduction), **read in source code**

**Not determined.** With `mkdir` atomic in one shim folder, a second claim is impossible, and the logs show no other writer. The second newline needs a writer these runs never showed. One sighting in 434 runs is too rare to catch in a loop.

**Repair (test), XS.**

1. Write OLD once, whole: `printf '%s\n' … > mod.js.tmp && mv -f mod.js.tmp mod.js`. No reader sees the file half-written (today a reader between `printf` and `echo` reads OLD without its newline), and a repeat writes the same bytes.
2. Keep the call log: the shim appends pid, ppid, arguments and claim to a file in `shims`, and the assertion at `:170` prints it, so a next sighting names its writer.

No product change is indicated.

## Optional item 6

`test/harness/hung-daemon.test.ts:135` (row ci-45710459569): not examined. The time went to the reproductions above.

## Open questions

- 011-436: the second writer. The kept call log names it at the next sighting.
- 011-438: what makes the worker take over 2 s on CI. A probe that logs the worker's own time per request, on a loaded sandbox, would decide it.
- 011-439: whether the CI `:209` sightings are all the 250 ms status poll. The sandbox shows that cause and the lease cause, and no busy store. CI keeps no hook stderr; option B's test and the debug log in the test would show it.
- 011-439 C: whether a late lease answer blocks a real Pi or OpenCode session. Not run.
- 011-440: the creator of `code.sqlite` during the red side (inferred: the commit daemon).

## Sources

- Experiments on boat.dev, 2026-11-27 23:22Z to 2026-11-28 00:06Z: `bx_jm36fy8g` (3.79 GHz; 011-440), `bx_727ehrav` (3.15 GHz, faster in practice; 011-436), `bx_4tg4uuwd` (3.79 GHz; 011-438, 011-439), `bx_2dq4z3ux` (4.29 GHz, deleted at once). All deleted. Spend about $0.064 (`boat usage`: $0.0264, $0.0264, $0.0109, and under $0.001 for the one deleted at once). Scripts: `probes/ci-flake-remaining/sandbox/`. Data: `probes/ci-flake-remaining/data/`.
- Local probes on this host (Node 26.13.0, load about 1 on 16 CPUs, one Vitest run each): `probes/ci-flake-remaining/hook-busy/`, `store-window/`, `pi-stall/`, with their `output.txt`; `VITEST_MAX_WORKERS=2 timeout 600 pnpm exec vitest run test/runners/vitest/width.test.ts`; `timeout 600 pnpm exec vitest run test/harness/pi/host.test.ts test/harness/pi/held.test.ts` (15 passed).
- CI: `probes/ci-flake-census/census.csv`; `gh run view 45806426506 --job 139862817883 --log`; board rows ci-43528167215, ci-45806426506.
- Source at `0e5223ca8`: the files and lines named above; Vitest 5.0.3 `dist/chunks/index.DpLw24bj.js:11849-11855,14592`.
