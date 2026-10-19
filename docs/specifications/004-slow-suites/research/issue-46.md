# Issue 46: a manual browser run and the slow tier's environment

Researcher, 2026-10-19, brief `issue-46-brief.md`. Squeal at `0b980f85` (0.1.223, the installed plugin `hearsay/squeal/0.1.223` for the probe), cezarion read at `2a5e7a7` (`~/projects/cezar`, read only), Vitest 4.1.10, Node 24.21.0. Load at the probe runs: 6.9 to 14.3 one-minute against 24 CPUs, below the brief's skip line. Nothing in a live cezarion environment was started, stopped or attached to.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Can a manual browser run tear down the environment a Squeal slow run is using? | Yes. Not in Squeal: the project's own bootstrap kills the server it judges stale. Squeal neither owns nor holds the environment. | verified by experiment (synthetic fixture); read in source code (cezarion) |
| 2 | What does status report? | While the file runs: `Slow tier: … running <file> since HH:MM`, with no environment and no single-file rerun command. After: a counted, `current` known failure, `fetch failed; cause: connect ECONNREFUSED 127.0.0.1:<port>`, `no retry asked at these inputs`, queue empty. | verified by experiment |
| 3 | Is connection refused classified as an environment failure? | No, by design. A slow file's test failure is not re-run either. Only the agent's `squeal retry --reason environment` reruns it; that retry passed. | verified by experiment; read in official docs (spec 011 C5) and source code |

## 1. The teardown seam

**It is cezarion's `test-env-up.sh`, not its teardown** (read in source code, cezarion `2a5e7a7`). `packages/web/e2e/environment.ts` is the e2e project's `globalSetup`. It runs `.ai/scripts/test-env-up.sh` for Squeal and for `npm run test:e2e` (`.ai/scripts/e2e.sh` also runs it first). Its teardown only restores `TMPDIR`. No e2e path calls `test-env-down.sh`. The script's `main` is `acquire_lock; if try_reuse … exit 0; teardown_stale; … start_app`. `try_reuse` refuses a running server in these cases:

- the descriptor is older than `TEST_ENV_CACHE_TTL_SECONDS` (600);
- a build input is newer than `startedAt`;
- `--force` was passed, or the `--server-env` set differs;
- the served clone cannot sync because HEAD moved.

`teardown_stale` then `kill`s the recorded pid, and `kill -9`s it one second later. The lock (`.ai/qa/test-env.lock`) covers the bootstrap only, not the use of the server. So a manual run started 10 minutes after the slow pass's boot, or after any edit to `BUILD_INPUT_PATHS`, kills the server under a spec that is still running. The issue says the manual run "reused and then stopped" the environment. The script either reuses or stops, never both. Its log, `.ai/qa/test-env*.log` in the incident's worktree, would show which. **Not determined** which branch fired in the original incident, because that worktree and its log were out of bounds.

**Squeal runs the setup once per slow pass, not once per file** (read in source code). Spec 004 D2 / `src/core/daemon/daemon.ts:452` says: "the slow tier's own Vitest instance, made per slow pass". In Vitest 4.1.10 `_initializeGlobalSetup` returns early once `_globalSetups` is set (`dist/chunks/cli-api.*.js:10742`). So the bootstrap runs once per instance, and later files of the same pass never revalidate the server. Inferred from those two: the reverse also holds. A new slow pass's setup can kill a server that a manual run is using.

**Squeal's isolation does not reach it** (read in official docs, spec 004 D10). A slow run gets its own temp directory and process group. "Shared caches remain the project's". cezarion's server is started with `setsid nohup`, so it leaves both. A grep of `src/` for `EADDRINUSE` finds only fingerprint tests, so D10's first-`EADDRINUSE` note may not exist in code (inferred). It would not cover `ECONNREFUSED` either.

## 2. Experiment

Fixture `probes/issue-46/` (throwaway; README there). `fixture/env-up.sh` copies only the reuse-or-kill rule above. The TTL is 2 s in `stale` mode and 600 s in `fresh` mode. The globalSetup calls it and its teardown stops nothing. The slow file `e2e/held.e2e.ts` reads the descriptor and fetches the server every 250 ms for 8 s. `run.sh` works in a `mktemp -d` git repository with `HOME` set to a temp directory. It runs `squeal start`, then `squeal run --all --wait` in the background. Once the slow file starts, it waits 3 s and then runs `npx vitest run e2e/held.e2e.ts` by hand. Afterwards it prints status, `status --json`, `why` and `retry`, then `squeal remove --config` and deletes the directory. Full output: `probes/issue-46/output-stale.txt` and `output-fresh.txt`.

Commands: `sh docs/specifications/004-slow-suites/research/probes/issue-46/run.sh stale`, then `… run.sh fresh`.

| Mode | env log | Manual run | Squeal's slow file | `run --all --wait` |
|---|---|---|---|---|
| stale (2 s) | `not reusing (age 5s > 2s); stopping stale instance pid 2821162` → `booted … port 36197` | exit 0, 1 passed (new server) | FAIL `fetch failed; cause: connect ECONNREFUSED 127.0.0.1:39587` | exit 1, `1 known failure` |
| fresh (600 s) | `reusing pid 2846182 (age 4s)` | exit 0 | PASS | exit 0, `no known failures` |

Status in the stale run (verified by experiment):

```
Known failures: 1 (1 test)
  FAIL  e2e/held.e2e.ts > uses the shared env for 8 s
        fetch failed; cause: connect ECONNREFUSED 127.0.0.1:39587
        at e2e/held.e2e.ts:7:1, observed at revision 0, current
        recorded just now in this worktree at revision 0, load 0.52 per CPU when it ran; no retry asked at these inputs
Affected checks: 3 passed (1 test, 2 test files loaded), 0 running, 0 queued
```

In `status --json` the failure has `validity: "current"` and `knownFailureCounts.current: 1`. Its fingerprint is `TypeError: fetch failed @ e2e/held.e2e.ts:7:1`, and the fingerprint has no cause, as C5 says. It has no field for the class of the failure. `squeal retry e2e/held.e2e.ts --reason environment` answered `runs once more now`. Its run passed against the manual run's new server: the spec rereads the descriptor and the instance does not rerun setup. Afterwards `Known failures: 0`.

The `Slow tier:` line while the file ran (verified by experiment):

```
Slow tier: 1 test file; running e2e/held.e2e.ts since 22:01 (no earlier run). Squeal runs them after the fast tests; `squeal run --slow --wait 60000` waits for its result.
```

The line names the file and the waiting command. It does not name an environment, and it does not warn against a concurrent manual run. Its only command waits for the whole tier, not for one spec.

Limits of the fixture:

- It is synthetic. A 2 s TTL stands in for cezarion's 600 s TTL or source-newer check, and an HTTP fetch stands in for agent-browser and Chrome.
- It has one fast file in the e2e project, so the fast instance ran the setup too. That is the first `reusing … age 0s` line in the log. cezarion's e2e project holds only slow files, so this does not happen there.
- n = 1 per mode. The timing is deterministic by construction, since the kill happens 3 s into an 8 s spec.

## 3. Classification

Spec 011 C5 (read in official docs; amended by the human, 2026-10-14, task 001-348): "No signal Squeal sees tells a server nobody started from one the agent broke … so Squeal never decides it alone and never on a timer: such a failure stays a counted FAIL." The source matches (read in source code):

- `src/core/scheduler/retries.ts`: `environment` exists only as a `squeal retry` reason, which runs "at once".
- No code reads `ECONNREFUSED` from a test failure. Every hit in `src/` belongs to the daemon's own socket client (`src/core/daemon/ensure.ts`, `client.ts`).
- The fingerprint code (`src/core/state/fingerprint.ts:253`) only keeps the cause in the summary.

C5 also limits automatic re-runs: "a slow file's new failure is not re-run". gh-20's amendment widens that only for a file-level error stored after every test passed. A refused connection inside a test is not that case, and the probe confirmed it: `0 queued` after the failure. The primer tells the agent `For a failure from load or a stopped service: squeal retry <file> --reason load|environment` (`src/harness/shared/primer.ts:139`). That is the path the issue's reporter took.

Issue 46's second criterion asks for automatic classification "or flagged as such". The first half contradicts C5's human decision as it stands. Squeal does have one fact it could act on: the refusal started while the run was in flight, against a port the same file had reached earlier in that run. The probe shows the fact is real. It does not show that it separates this case from a server the code under test crashed. Only the human can amend C5.

## Recommendation for Squeal

The cause is a project-level race: the bootstrap kills a server another run is still using. Squeal can only narrow it. The tradeoff:

- Telling, the issue's first criterion, costs one clause on the `Slow tier:` line while a file runs. It needs no C5 change. It cannot name "the held environment", because Squeal does not know there is one. At most it can say that the running file's project setup is shared, and offer `squeal retry <file>` for one spec. For a file whose result is current, `retry` reruns it only with a reason, once per key per session (C5 and gh-36).
- Classifying, the second criterion, needs a C5 amendment by the human. It would turn a fact into a judgement, against the reasoning of task 001-348.
- The durable fix is the project's: a lease or reference count on the shared server, so `teardown_stale` waits for or skips a server in use. That is cezarion's change, outside Squeal.

The cheapest step that helps the next agent is a cezarion change plus a primer or `Slow tier:` wording row. Classification waits for the human's call on C5.

## Open questions

1. Which `try_reuse` branch fired in cezarion#1235? Its worktree's `.ai/qa/test-env.log` (or the app log) decides it. Not read.
2. Should a refusal from a port the same file reached earlier in the run count as a cause outside the keyed inputs? That is the human's call on C5. No measurement here separates it from a crash the code caused.
3. Is spec 004 D10's `EADDRINUSE` note implemented? The grep suggests not. Check before any wording row builds on it.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/46 (read 2026-10-19 with `gh issue view 46 --json`)
- Spec 004 `spec.md` D2, D4, D8, D10 and `status.md`; spec 011 `spec.md` C5 (including the gh-20 and gh-36 amendments) and C6, at `0b980f85`
- Squeal source at `0b980f85`: `src/core/daemon/daemon.ts:452`, `src/runners/vitest/adapter.ts` (`#start`, `close`), `src/runners/vitest/run.ts:218`, `src/core/scheduler/retries.ts`, `src/core/retry/records.ts`, `src/core/state/fingerprint.ts:253`, `src/harness/shared/primer.ts:139`
- cezarion at `2a5e7a7` (https://github.com/hearsay-tools/cezarion): `.ai/scripts/e2e.sh`, `.ai/scripts/test-env-up.sh` (`try_reuse`, `teardown_stale`, main), `.ai/scripts/test-env-down.sh`, `packages/web/e2e/environment.ts`, `packages/web/e2e/vitest.config.ts`, `packages/web/e2e/agent-browser.ts` (`readTestEnv`), `squeal.config.json`
- Vitest 4.1.10 `dist/chunks/cli-api.*.js` lines 10742 to 10758 (`_initializeGlobalSetup`, `_teardownGlobalSetup`)
- Probe: `probes/issue-46/` (`run.sh`, `fixture/`, `output-stale.txt`, `output-fresh.txt`)
