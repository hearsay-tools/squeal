# Issue 64: focused checks for daemon-owned red/green feedback

Researcher findings, 2026-10-21, at main `18aff2857`. Documentation only: no design, no implementation. Existing holds stand.

## Verdict

**Reproduced synthetically; the original 387-second incident is not reproduced.** Squeal 0.1.233 and 0.1.234 have no CLI or adapter way to run selected checks within one test file. A new check in a large file gets its first verdict only after the whole file runs, and in the probe after a second whole run too. On a 30-check, 12 s fixture, the daemon's red verdict took 25.4 s from the edit; an unmanaged `vitest -t` gave the same red in 1.2 s.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Can the CLI select checks within one file? | No. `run` takes only `--all`, `--fast` or `--slow`; `status --wait` takes paths; a check name given as a path gets "No verdict: no test file's closure holds ..." | verified by experiment (0.1.233); read in help output (0.1.234) |
| 2 | Can the runner adapter run part of a file? | No. `RunOptions` has `runId`, `logDir`, `timeoutMs`, `signal`, `stop`, `lane`, `childEnv`, `observeIgnored`; no name filter. `testNamePattern` appears nowhere in `src/` | read in source code (`src/core/types/runner.ts:201`, HEAD `18aff2857`) |
| 3 | Is the result unit the whole file? | Yes. Keys are computed per test file (011 C4 steps 2 and 3); a run takes files (013 V4 `run(testFiles)`); C15 promotion changes order only, never which files run | read in spec (011 C4, C15; 013 V4) |
| 4 | Does a new red check cost one or two full-file runs before the verdict? | Two in the probe: 25.4 s for a 12.3 s file. 011 C5 re-runs a worktree's own first-seen fail once before it is trusted | verified by experiment (timing); inferred (cause, from C5 and the 2 x 12.3 s arithmetic; the scratch store was deleted before `squeal why` was read) |
| 5 | Does the synthetic result explain 387 s in cezarion#1269? | Not determined, because the incident's files, durations, tier mates, queue and load are not in the issue | not determined |

## Evidence

**Environment.** Host 24 CPUs. One-minute load before the run: 13.79 (check), 13.64 (in the script, 2026-10-21T01:17:11Z); below the CPU count, so the probe ran. Installed `squeal --version`: 0.1.234 (launcher; Claude Code plugin 0.1.233). Probe Squeal: a copy of `~/.claude/plugins/cache/hearsay/squeal/0.1.233`, the incident's version. Vitest 4.1.10 in the scratch repository.

**Command.** From `docs/specifications/011-core/research/probes/issue-64/`: `timeout 360 sh run.sh | tee output-run1.txt`. The script refuses to run when load is at or above the CPU count, uses a fresh `/tmp/i64-*` with its own `HOME` and `XDG_RUNTIME_DIR`, stops its daemon and deletes the directory. Full output: `probes/issue-64/output-run1.txt`.

**Fixture.** `test/parity.test.ts`: one `describe` with 30 checks of 400 ms each, a stand-in for a large shared parity file. Phase B appends `new 1` (red) and `new 2` (green).

**Results** (verified by experiment, 0.1.233):

| Step | Command | Wall | Outcome |
| --- | --- | --- | --- |
| A, baseline | `squeal run --all --wait` | 13.7 s | 31 passed |
| B, two new checks | `squeal status --wait 120000 test/parity.test.ts` | 25.6 s (Squeal: "after 25.4 s") | FAIL `parity > new 1`, current at revision 1 |
| C, check name as a path | `squeal status --wait 5000 "test/parity.test.ts > parity > new 1"` | n/a | "No verdict: no test file's closure holds ..." (the script recorded the exit of `head`, not of `squeal`) |
| Control, unmanaged focus | `npx vitest run test/parity.test.ts -t "new "` | 1.2 s (Vitest 283 ms) | 1 failed, 1 passed, 30 skipped |
| Control, whole file | `npx vitest run test/parity.test.ts` | 13.2 s (Vitest 12.27 s) | 1 failed, 31 passed |

So the daemon's red took about 21 times the focused run and about 1.9 times one whole-file run.

**Original incident** (issue report, not independently verified): cezarion#1269, Squeal 0.1.233, 2026-10-20. The first tier started at 23:00:19 UTC; the expected failures arrived at 23:06:46 UTC, 387 s. Two new assertions in large shared parity files. Path-based waits could not narrow the run. The final full parity gate stayed required.

## Honest distinction

- The probe proves the mechanism: no selection inside a file, so the daemon runs the whole file, and its new-failure confirmation runs it again before a named wait returns.
- The probe does not prove the 387 s. The fixture is 12 s on an idle-enough host, one file, no tier mates, no backlog, no other worktree's claim. 387 s may include tier sharing, queue order, load and the confirmation re-run of a far larger file; none of these was observed for the incident.
- `vitest -t` in the control is the unmanaged runner the issue's first criterion forbids as a fix. It is used here only to measure what a focused run costs.

## Spec context (read, not designed)

- 011 C4: validity is per check, but keys and runs are per test file; tiers group files by duration.
- 011 C5: a worktree's own new fail is re-run once before it is trusted.
- 011 C6: `status --wait` waits on paths and their closures.
- 011 C14: `RunnerAdapter.run(files, RunOptions)`; no check-level parameter.
- 011 C15: named demand changes order only, "not which files run, their keys, or whether a result is current".
- 013 V4: `run(testFiles)`, check identity `(project, relative path, fullName)`, per-run floor 110 to 350 ms.

A focused result would be a result for part of a file under a file key, which C4's "current" and the issue's third criterion would both have to account for. That is the spec owner's decision.

## Open questions

1. How much of the 387 s was the confirmation re-run, tier sharing or load? Needs the incident's `squeal why` and run logs, or a cezarion-sized replay at low load.
2. Does `squeal status --wait <path>` return at the first delivered fail or after the confirmation run? The probe shows 25.4 s for a 12.3 s file; reading the store's runs for that revision would confirm.

## Sources

- https://github.com/hearsay-tools/squeal/issues/64 (read 2026-10-21 with `gh issue view 64 --json`).
- https://github.com/hearsay-tools/cezarion/issues/1269 (named by the issue; not read).
- `docs/specifications/011-core/spec.md` C4, C5, C6, C14, C15; `docs/specifications/013-vitest-runner/spec.md` V4, at `18aff2857`.
- `src/core/types/runner.ts:201` at `18aff2857`.
- `squeal --help` and `squeal run --help`, 0.1.234 and 0.1.233.
- `probes/issue-64/run.sh`, `probes/issue-64/fixture/`, `probes/issue-64/output-run1.txt`.
