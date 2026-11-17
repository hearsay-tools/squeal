# Research brief: the Pi idle wake is not armed in time (board row ci-43987606521)

Use /researcher. Shape: research. Coordinator: session 4d2ecbfc, 2026-11-17. Outcome: `idle-wake-not-armed.md` in this folder, naming why the Pi idle wake's waiter lock was not held in time in three CI runs, and what to change.

## Sightings (all passed on a re-run of the job)

| Run | Commit | Job | Test | Message |
|---|---|---|---|---|
| [43946095378](https://github.com/hearsay-tools/squeal/actions/runs/43946095378) attempt 1 | cand/0.1.526 | Node 26 (2/3) | `test/e2e/pi.test.ts:190` | timed out after 20000 ms waiting for the idle wake (`test/e2e/support.ts:43`) |
| [43987606521](https://github.com/hearsay-tools/squeal/actions/runs/43987606521) attempt 1 | cand/0.1.534 `bb8c83bbe` | Node 22 (1/3) | `test/integration/pi-wake.test.ts` "rpc: a failing result landing after the run settled starts exactly one run carrying it" | the idle wake was never armed (`:66`, 10 s) |
| [43992379130](https://github.com/hearsay-tools/squeal/actions/runs/43992379130) attempt 1 | main `3478e3e7f` (0.1.534) | Node 22 (2/3) | `test/e2e/pi.test.ts:190` | timed out after 20000 ms waiting for the idle wake |

Three sightings in one day, in two test files, on two Node versions; none on the board before 2026-11-16.

## Questions, each tagged verified by experiment, read in source code, inferred, or "not determined, because"

1. What arms the idle wake under Pi (the extension's settle path to the waiter process and its lock), step by step, and which step each test waits for (`lockState`, `support.ts:43`).
2. From the three failed jobs' logs (`gh run view <id> --log-failed`, and the full job log of the failing shard): what did happen between the run settling and the deadline? Was a waiter started and late, started and exited, or never started? Name the evidence line.
3. When did it start? Search CI history (`gh run list --workflow ci.yml --limit 200 --json ...`, then failed jobs' logs by test name) for earlier sightings of either message. Name the first run and the commits between the last clean stretch and it. Candidates to check against, not assume: 0.1.525 to 0.1.534 (hook texts only, rows 005-89 to 005-93), 0.1.524 and 0.1.526 to 0.1.531 (scheduler waits and steps, rows 011-371, 011-377, 011-382, 011-386, 011-389), a change of Pi's version or of the CI runner image.
4. Is it a product race (an agent's idle wake can really be lost or late) or a test bound too tight for a loaded runner? If a race: the smallest reproduction you can make without real Pi, or with Pi as the `squeal-e2e` user only.
5. The change you recommend (product fix, or the test waiting for the condition it asserts), its owner spec, and what would prove it.

## Limits

Read-only on the repository except your findings file and a `probes/idle-wake/` folder. No full suite. Real Pi runs only as the `squeal-e2e` user, never with the real `HOME`. Never run a script under `evals/bin`. The host is loaded by other sessions: make no CPU load on purpose, run at most one test file at a time with `timeout 600`, and state the load beside any timing. Write `~`, never a `/home/<user>/` path.

Final message: the cause or "not determined, because", the first sighting, and the recommended row.
