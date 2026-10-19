# Research: issue 43, a timed-out file stays UNKNOWN with no retry

Researcher, 2026-10-19. Question from the brief: reproduce hearsay-tools/squeal#43 (timeout to
`unknown`, no automatic retry, recovery through `squeal retry --reason load`, the named wait's
guidance) cheaply, without spending 600 s. Squeal **0.1.223** (`squeal --version`; worktree at
`27f11ea3`, `squeal--v0.1.223-3`, docs-only commits after the tag). Host: 24 CPUs (`nproc`),
one-minute load 2.19 to 3.18 during the probe (`/proc/loadavg`), so the brief's "load above CPU
count" stop did not apply. Product read-only; no implementation proposed beyond options.

**What was and was not rerun.** The original incident (cezarion's `waits-parity.test.ts`, 319
tests, 539 s quiet, over 600 s at load 20 to 50) was **not** rerun. Everything tagged "verified by
experiment" below is a synthetic one-file fixture with `runner.timeoutMs` 5000, which drives the
same code path (`report.end === "timed-out"` in `src/core/scheduler/tiers.ts:583-588`; the cap is
the only difference, `timedOutReason` prints it). The load-gated half of `--reason load` could not
be exercised at load 3 on 24 CPUs and is source/spec reading only.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a file over the cap go `PASS/never-run -> UNKNOWN` "timed out after N s"? | Yes, reproduced at a 5 s cap: `test/slow.test.ts: no result: timed out after 5 s`. | verified by experiment, 0.1.223 |
| 2 | Is there an automatic retry? | No. 20 s idle after the timeout: "1 test file without a result, none queued". This is the specified behaviour, not a defect: C4/C13 say a file timed out in a tier of its own "is not run again at that key", and C5 says Squeal "never decides it alone and never on a timer". | verified by experiment; read in spec 011 C4, C5, C13 |
| 3 | Does `squeal retry <file> --reason load` recover it? | Yes, at once: the reply says "It runs once now at its normal priority, whatever the reason"; the named wait then passed in 0.5 s. At these inputs it is the file's one run; it spends no session retry (011-16 / gh-36 amendment). It does not wait for load, because the file has no result (C5 amendment 2026-10-18). | verified by experiment (low load only); read in source `src/cli/retry.ts:191-197` |
| 4 | Does the named wait say the verdict will never come, and name a command? | Partly. It returns at once (not at its deadline) with `Unknown (1): ... timed out after 5 s` and `Named test files have no verdict: 1 test file without a current result at revision 0 (1 unknown)`, exit 3, and names **no** command. Only the general status block above it names one, and it names `squeal run --all --wait`, not `squeal retry <file>`. | verified by experiment |
| 5 | Does `squeal run --all --wait` re-run a timed-out file? | Yes: it ran the file again (6 s wall, timed out again, exit 3). So "not run again at that key" holds for the scheduler's own queue, not for an explicit checkpoint. | verified by experiment |
| 6 | Is there a per-file or per-glob timeout, or load scaling? | No. Policy has one `runner.timeoutMs` (default 600000, `null` for none), per run, for every lane. Raising it is repository-wide. | read in source `src/core/types/policy.ts:73-77,272`; read in spec 011 C10 |
| 7 | Does the incident's timing fit the 600 s cap? | Plausibly: 539 s on a quiet host leaves 10% headroom; at load 20 to 50 on this 24-CPU host the run can pass 600 s. Not measured here. | inferred |

## Findings

**1. Timeout path (verified by experiment).** Fixture from `probes/issue-43/setup.sh`, delay 8000 ms,
cap 5000 ms, Vitest 5.0.5 (Vitest 3 fails to start under 0.1.223: `vitest.standalone is not a
function`, noted only because a first fixture used it).

```
$ squeal start            # 19:43:57, load 2.19
$ timeout 170 squeal run --all --wait        # 19:43:57 -> 19:44:02, exit=3
Checkpoint 78f9a5b2-... has no verdict: it was abandoned before every test file had a result (...
  a tier crashed or timed out, ...). Without a result: test/slow.test.ts: no result: timed out after 5 s
...
Idle: nothing is running and no run is open; 1 test file without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)
Test files without checks: 0 pending, 1 unknown
  test/slow.test.ts: no result: timed out after 5 s
```

The single file was its own tier, so no split (C4 step 5) applied; it became `unknown` with the
reason from `timedOutReason` (`src/core/scheduler/timeout-split.ts:38-41`) via `ledger.markUnknown`
(`tiers.ts:583-588`), and its retry ledger entry ended with no result (`endRetry(..., null, ...)`).

**2. No automatic retry (verified by experiment; specified).** After `sleep 20` (delay then set to
100 ms, so a rerun would have passed), status at 19:44:27 still read "1 test file without a result,
none queued". The spec forbids the automatic rerun the issue asks for: C13 "a file that timed out in
a tier of its own becomes `unknown`", C4 "is not run again at that key (D12), so one file that hangs
costs at most about log2 of the tier's size further timeouts", C5 "No signal Squeal sees tells ... a
load timeout from a slow test, so Squeal never decides it alone and never on a timer". The 001-179
rationale is a genuinely hanging file; automatic rerun would cost another full cap (600 s) each time.

**3. Named wait (verified by experiment).**

```
$ squeal status --wait 10000 test/slow.test.ts    # 19:44:27 -> 19:44:28, exit=3
Selected: test/slow.test.ts
Unknown (1): test/slow.test.ts: no result: timed out after 5 s
Named test files have no verdict: 1 test file without a current result at revision 0 (1 unknown). Worktree: known failures 0; checks 0 running, 0 queued
```

It ended in about 1 s, not at 10 s: the wait already recognises that nothing is pending. That differs
from the issue's "on every poll", which describes an agent re-issuing the wait; each call returns
at once with the same text. The line says no verdict but not that none will come without action,
and names no command. The issue's third request is accurate for 0.1.223. The `timeout` branch of
`namedLine` (`src/cli/status-wait-lines.ts:173-200`) builds reason groups with commands
(`reasonGroups(holding, command)`); the settled-unknown line seen here carries none (read in source,
the settled branch not traced further).

**4. `run --all --wait` re-runs it (verified by experiment).** Delay back to 8000: `squeal run --all
--wait` at 19:44:32 ended 19:44:38, exit 3, "Without a result: test/slow.test.ts: no result: timed out
after 5 s" again. So the Idle line's advice is true but, for a file that needs more than the cap, it
spends one more full cap and changes nothing.

**5. Explicit retry recovers (verified by experiment at load 3.05 / 24 CPUs).**

```
$ squeal retry test/slow.test.ts --reason load    # 19:44:42, exit=0
Run queued: test/slow.test.ts has no result at its inputs (unknown: timed out after 5 s). It runs once now at its normal priority, whatever the reason; that is its one run at these inputs, and it spends no retry of this session. squeal status --wait 60000 test/slow.test.ts waits for its result and moves it ahead in the queue.
$ squeal status --wait 60000 test/slow.test.ts    # exit=0
Named test files at revision 0: no known failures; 1 test file, each with a current result, after 0.5 s.
```

Recovery works because the second run fit the cap. In the incident it would have worked only once
load fell enough for the file to finish under 600 s; "whatever the reason" means `--reason load`
does **not** wait for low load on an `unknown` file (C5 amendment, gh-36), so at load 20 to 50 the
retry would likely have timed out again and the one run at these inputs would be spent (read in spec
011 C5; not tested, load could not be raised safely on a shared host).

## Reproduce verdict

**Reproduced (synthetic), not rerun (original).** At 0.1.223 the three frictions of #43 hold as
observable behaviour: a file over the cap becomes `unknown` "timed out after N s"; nothing reruns it
by itself; the named wait reports no verdict without saying it is final or naming `squeal retry`.
Two parts of the issue are by design (no automatic timed retry: C4, C5, C13) or already partly met
(`squeal retry` on an unknown runs it at once and its reply names the wait). The gap is in
guidance and in the cap's granularity, not in the state machine.

## Recommendation for Squeal

The decision is the coordinator's and the human's; existing holds stand. The tradeoff is the cost
of one more cap per rerun (600 s of a lane, the reason 001-179 stopped reruns) against a verdict
the agent otherwise produces by hand.

1. Cheapest, no state change: on a selected file `unknown` for a timeout, the named line says no
   verdict will come at these inputs without a run and names `squeal retry <file> --reason load`
   (and, when the one-minute load is at or above the CPU count, that the run will likely time out
   again). Fits C15's "names the command that advances each".
2. Make `--reason load` on a timed-out `unknown` actually wait for load below CPU count, as it does
   for a counted FAIL; today the reason is ignored for unknown files. Changes the gh-36 amendment.
3. A per-glob cap (`runner.timeoutMs` keyed like `slow`, or a slow group's own cap). New policy
   surface; vision's decision filter applies. Load-scaled caps are not recommended: they make a
   result's acceptance depend on host state Squeal does not key.

## Open questions

- Whether an automatic single rerun when the run's recorded load was at or above the CPU count would
  be acceptable against C5's "never decides it alone"; that is a human decision.
- The load-waiting path of `retry --reason load` on a timed-out file at high load: not determined,
  because raising host load is barred on this shared host (memory: host load is our own).
- The original 319-test file's runtime at load 20 to 50: not determined, not rerun.

## Sources

- hearsay-tools/squeal#43 (`gh issue view 43`, 2026-10-19).
- `docs/specifications/011-core/spec.md` C4 (line 126), C5 (169, 177), C10 (250), C13 (299), C15 (322-354), at `27f11ea3`.
- `docs/specifications/013-vitest-runner/spec.md` V4, V8, V9 (no timeout rule of their own; V8 defers to C4 and C13; line 19 covers a run rejecting during a timeout's cancellation).
- Source at `27f11ea3`: `src/core/scheduler/timeout-split.ts`, `src/core/scheduler/tiers.ts:583-588`,
  `src/cli/retry.ts:191-197`, `src/cli/status-wait-lines.ts:173-200`, `src/core/types/policy.ts:73-77,272`.
- Probe: `docs/specifications/011-core/research/probes/issue-43/` (setup script and README; the fixture lives in `/tmp`).
