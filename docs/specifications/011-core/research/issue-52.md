# Research: issue 52, no load retry for a failure recorded above the load threshold

Researcher, 2026-10-20. Brief: reproduce hearsay-tools/squeal#52 cheaply. In the report, a failure
recorded at 3.33 load per CPU stays a known failure with "no retry asked at these inputs" until the
agent runs `squeal retry <file> --reason load` by hand. Documentation only. Existing holds stand.

**Versions and host.** The checkout is `ea76593b` on `cez/25b3b056`, `package.json` 0.1.228, and
`squeal --version` reports 0.1.228. The incident ran 0.1.226 (the issue's comment).
`git diff --stat squeal--v0.1.226 HEAD -- src/core/retry src/core/scheduler/retries.ts
src/cli/retry.ts src/core/delivery` is empty, so the retry and delivery code is the code of the
incident. The host has 24 CPUs (`nproc`). The one-minute load was 14.00 at the start and 17.78
when the probe ran (`uptime`, `/proc/loadavg`), 0.58 to 0.74 per CPU. That is below the CPU count,
so the brief's stop did not apply. A live reproduction still needs load above the CPU count, which
the brief forbids creating, so the load was injected instead.

**Verdict: reproduced, deterministically.** The behaviour is the specified one, not a defect.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a failure stored at 3.33 load per CPU get a load retry with no command? | No. No retry record is written, and three reconciliation passes queue nothing. This holds with and without the 001-171 same-key re-run. | verified by experiment, 0.1.228 code |
| 2 | What does the session-start report say? | `Known failures: 1 (1 test)`, then `Recorded just now in this worktree at revision 0, load 3.33 per CPU when it ran; no retry asked at these inputs`. This is the issue's line apart from the age. | verified by experiment |
| 3 | Does a failure recorded below the threshold read differently? | Only in the number (`load 0.50 per CPU`). Nothing else separates the two cases today. | verified by experiment |
| 4 | Does a manual `--reason load` request wait, and how is it reported? | Yes. At 3.33 per CPU the request stays unclaimed and is not queued. Registration reads `retry asked (load) at these inputs, pending`, and `Known failures: 1` still counts it. Once the load drops to 0.50 per CPU, the next pass claims the request and runs the file, and the run ends the request `passed`. | verified by experiment |
| 5 | Is the absence of an automatic retry a defect? | No. C5 (001-348, decided by the human 2026-10-14) says such a failure "is retried only when the agent asks". It also says: "Squeal never decides it alone and never on a timer: such a failure stays a counted FAIL", and "A request clears nothing". | read in spec 011 C5 |
| 6 | Does the 011-15 (#34) "pending rerun" count cover a waiting load retry? | No. 011-15 counts a failure as `pending` only while its file is queued or running. A load request that is still waiting is neither, so the failure stays `current` and counted. This is consistent with C5's "the FAIL stays counted in `Known failures` until a retry's run passes". | verified by experiment; read in spec 011 C6 (011-15 amendment) |
| 7 | Is #52 a duplicate of #43? | No. #43 is a timed-out file left `unknown` (no result). Its load-waiting retry is held (board row gh-43). A file with no result already runs at once on any `retry` (011-16). #52 is a current FAIL with a result, recorded under load. The two sit on the same mechanism, C5's load-gated retry. | read in board, spec 011 C5, `research/issue-43.md` |

## Findings

**1–3. No automatic queueing (verified by experiment).** The only writer of a retry request is
`askRetry` (`src/core/retry/records.ts:128`). Its only caller is `src/cli/retry.ts:200`. The
scheduler's `takeRetries` (`src/core/scheduler/retries.ts:41-82`) only claims requests that already
exist. A tier's start load is read in `tierLoad` (`retries.ts:136-138`). `recordFailedLoad` keeps it
only for display (`failed-run-loads`, `src/core/retry/load.ts:36`), and `withRecorded`
(`src/core/retry/recorded.ts`) shows it. No code compares the recorded load with `loadAllows`.
The probe confirms the reading. With the default `rerunCap` (001-171's one re-run of a new failure),
the run that re-runs the file ignores load and does not count as a retry. The report still says
"no retry asked". The probe did not count runs, so that this re-run happened is read in spec C5, not
measured.

**4. Manual retry (verified by experiment).** These are the order and states the reporter
described: the request is pending, the failure is still counted, it runs once the load is below the
CPU count, and a pass recovers the check. The `Pending retries:` section of `squeal status` was not
exercised here. It is covered by `test/status/pending-retries.test.ts`.

**What the issue asks would change the spec, not fix a bug.** The first acceptance criterion
reverses C5's human decision that Squeal never queues such a retry alone. The second contradicts
C5's "A request clears nothing" and 011-15's count. C5 also explains why Squeal does not judge
alone: "No signal Squeal sees tells … a load timeout from a slow test". The issue's "a timeout
failure" would need exactly such a signal, from the failure text or fingerprint, which the spec
deliberately does not read. The tradeoff that decides it:

- Queuing automatically saves the agent one command.
- Under load, it can hide a real regression. A real failure recorded at high load would be retried
  once, and reporting it as "pending" instead of counting it would understate known failures.
- The once-per-key limit bounds the loop but not the hiding.

Only the human can decide this (a C5 amendment). The `--reason load` path the reporter used works
as specified.

## Recommendation for Squeal

Triage #52 as a request for a C5 change, with the human deciding. The code is not defective. If the
human wants anything, the narrowest change that keeps real failures counted is a wording change. A
failure recorded at or above 1.00 load per CPU, with no retry asked, could name
`squeal retry <file> --reason load` next to its recorded facts. It would stay counted, and nothing
would be queued. That belongs with 011-24's status guidance, and like #43's load-waiting retry it
stays held until the human rules. No implementation here.

## Limitations versus the cezarion incident

- The failure is synthetic. The 001-368 fixture's test fails while a marker outside the worktree
  exists. The incident had a `waitFor timed out` in cezarion's `harness-autosave-settlement.test.ts`
  (`[server]` project, three harness cells). Squeal does not inspect the failure's text in this
  path, so the outcome is the same, but the incident's file was not run.
- The load was injected through `SchedulerOptions.hostLoad` (8 CPUs, 26.64 for 3.33 per CPU, 4 for
  0.50), not reached on the host. The real `os.loadavg()` read (`hostLoad`, `load.ts:18-23`) was not
  exercised above the CPU count.
- The probe uses the in-process scheduler and delivery from `test/scheduler/helpers.ts`, not a
  daemon, a hook or the installed CLI. `formatRegistration` is the formatter the hook header uses.
  The revision is 0, not the incident's 3.

## Open questions

- Whether the human wants any change to C5 (automatic queueing, or only a hint). Not determined,
  because only the human can decide it.
- Whether cezarion's three cells would pass a load retry. Not determined, because the incident was
  not rerun and its load cannot be recreated here.

## Commands

```
uptime; nproc                       # 14.00 on 24 CPUs at start
git diff --stat squeal--v0.1.226 HEAD -- src/core/retry src/core/scheduler/retries.ts src/cli/retry.ts src/core/delivery   # empty
npm ci --no-audit --no-fund         # worktree had no node_modules (gitignored)
cat /proc/loadavg                   # 17.78 at the run
npx vitest run --config docs/specifications/011-core/research/probes/issue-52/vitest.config.ts --reporter=verbose --silent=false
#   4 passed (4), 7.09 s
```

## Sources

- hearsay-tools/squeal#52 and its comment ("Squeal version: 0.1.226"), read with `gh issue view 52 -R hearsay-tools/squeal`, 2026-10-20.
- `docs/specifications/011-core/spec.md` C5 (001-348/001-368 retry paragraph, consumer-view recorded facts, 011-15 and 011-16 amendments), C6; `docs/board.md` rows gh-43, gh-49.
- Source at `ea76593b`: `src/core/retry/{load,recorded,pending,records}.ts`, `src/core/scheduler/retries.ts`, `src/core/scheduler/tiers.ts:364,614`, `src/cli/retry.ts:200`.
- Tests read as leads: `test/scheduler/retry-delivery.test.ts`, `test/scheduler/retry-fixture.ts`, `test/status/pending-retries.test.ts`.
- Probe: `research/probes/issue-52/` (throwaway).
