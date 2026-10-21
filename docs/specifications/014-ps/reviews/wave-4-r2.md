# Wave 4, round 2 review: PASS

Candidate: `cand/0.1.248`, `a8ba68050354243734380f10baa96ac0223c19b2`.
Repair range: `29ca7cc8d..a8ba68050`. Base: `485be5770`.
Prior findings: `reviews/wave-4.md`. Reviewed on Linux, Node v24.21.0.

No remaining blocker in this narrow re-review. B1, B2, B3 and S1 are fixed. N1 is a proven residual limit, explicitly accepted and named in D3 and the amendment log. This verdict does not assert an unconditional no-file-created guarantee. No product code changed during review.

## Verification output

`HEAD` matched the supplied candidate. No tracked product file differed during verification; the review draft was the only untracked path. The focused tests used a fresh archive of the exact candidate.

The coordinator stopped the unfinished full run at the former pin `f7c35e849` when 0.1.247 landed. That run supplies no full-suite result. The re-pin puts the same wave on main `485be5770` and updates the release to 0.1.248. A direct diff from `f7c35e849` to `a8ba68050` is empty for `src/core/ps`, `src/cli/ps.ts`, `test/ps`, `test/e2e/ps*.ts` and `docs/specifications/014-ps`. The new main's unrelated changes remain outside this narrow review; the exact-SHA full gate covers their integration.

```text
$ npm ci
added 196 packages, and audited 197 packages in 18s
1 high severity vulnerability
exit 0

$ npm run lint
> biome check .
Checked 1678 files in 1331ms. No fixes applied.
exit 0

$ npm run typecheck
> tsc --noEmit
exit 0

$ npm run build
> tsc -p tsconfig.build.json && npm run build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts && tsx src/harness/pi/build.ts && tsx src/harness/opencode/build.ts
exit 0

$ npm run check:version -- 485be5770 HEAD
version bump: 0.1.247 -> 0.1.248, ok
exit 0

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist plugins/pi/dist plugins/opencode/dist
exit 0, no output
$ git diff --check
exit 0, no output
```

The brief permits the coordinator's independent gate on this exact SHA. Its worktree `/tmp/sq-w4` was clean when checked, and its `HEAD` matched the pin. The start and exit lines are in `/tmp/014-w4-gate.log`; the full output is in `/tmp/014-w4-gate-full.log`.

```text
$ nohup setsid flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
start 2026-10-21T21:47:05Z a8ba68050354243734380f10baa96ac0223c19b2
Test Files  1 failed | 844 passed | 2 skipped (847)
Tests       1 failed | 7269 passed | 11 skipped (7281)
Duration    1328.16s
exit 1 2026-10-21T22:09:15Z
```

Load observed during this run was `51.93 53.40 47.46` at 21:48 UTC and `57.92 52.49 49.05` at 21:59 UTC, on 24 CPUs. The only failure was the known 008-38 flake, `test/harness/opencode-dispose.test.ts`, in “serve: an abort of the new turn, then the old Stop's answer, stores nothing”. All three internal attempts missed the held Stop's 2,000 ms deadline; the last kill occurred at +2,313 ms before the new request. This file is outside the repair range. The other named flake, `test/e2e/stop-gap.test.ts` (011-20), did not fail. The full run was not green; its one failure is retained here rather than erased by a retry.

The required file-alone rerun at the exact candidate also failed at that same barrier. Its starting load was `33.92 39.75 44.35`; load after the run was `47.06 42.12 44.87`. No product file was changed between runs.

```text
$ nohup setsid npx vitest run --maxWorkers=1 test/harness/opencode-dispose.test.ts
Test Files  1 failed (1)
Tests       1 failed | 2 passed (3)
Duration    51.14s
exit 1
```

The three rerun attempts killed the held Stop at +2,016, +2,016 and +2,229 ms, at or after its +2,000 ms idle deadline before the new request. This confirms the named pre-existing flake remains present under this host load; it does not establish a new repair regression. Its log is `/tmp/review-014-29-r2/opencode-alone-248.log`. Neither this rerun nor the full gate is claimed green. No second full suite was started.

The supplemental Squeal status returned without a daemon, with `Known failures: 0; not current: 828 of 828 test files`. That is not passing evidence and was not used instead of the independent gate.

The targeted proof used disposable before and candidate trees outside the project. They had the candidate's tests, configuration and dependencies. The before tree replaced only `work.ts`, `flags-leftovers.ts`, `measure.ts`, `snapshot-unknown.ts` and `cli/ps.ts` with their `735bb6cf3` versions, which a direct diff confirms equal their rebased `29ca7cc8d` versions. This isolates the repairs without mixing in the old base's test-race changes. These are regression probes, not full-suite results at the old commit.

```text
before, --maxWorkers=1, TMPDIR=/tmp:
  crash image + B2 + B3 + S1 filter
  Test Files 4 failed | 1 skipped (5)
  Tests      7 failed | 84 skipped (91)
  separate CLI withholding filter
  Test Files 1 failed (1)
  Tests      1 failed | 1 skipped (2)

after, unchanged candidate archive, --maxWorkers=1, TMPDIR=/tmp:
  work-store, flags-files, flags-files-withheld, flags-files-walk,
  measure, snapshot, proc, darwin
  Test Files 8 passed (8)
  Tests      143 passed (143)
  Duration   11.22s
```

All eight before failures were assertions about the former behaviour, not import or environment errors. The CLI permission test ran as uid 1001; it was not skipped as root. The real datagram test bound its socket successfully. Short `TMPDIR` keeps its Unix socket path below the kernel limit. Logs and disposable probes were kept under `/tmp/review-014-29-r2` during review. No printed end command was run.

## Findings resolved

### B1 — proven fixed: WAL without shared memory is not read as old work

Location: `src/core/ps/work.ts:113`; `test/ps/work-store.test.ts:177`.

The new crash-image test independently reads the newer committed heartbeat from a copy with a WAL and no shared-memory file. The repaired reader returns no work for that store, names the unreadable WAL state, and preserves the directory listing. The before reader incorrectly returned work; its `work.has(800)` assertion failed.

The tests also preserve the supported paths: a closed WAL-mode store with neither sidecar, an empty WAL without shared memory, and a live writer's WAL. The immutable path retains its inode, size, nanosecond mtime and ctime check. A write during that read makes the work unknown. The shared open-runs query still runs once per store and reading. Rejecting any nonempty WAL without shared memory is conservative, including a WAL containing only a header.

### B2 — proven fixed: incomplete use evidence withholds cleanup candidates

Locations: `src/core/ps/flags-leftovers.ts:121`, `:233`, `:256`; `src/core/ps/proc.ts:186`; `src/cli/ps.ts`; `test/ps/flags-files-withheld.test.ts`.

The mixed readable/unreadable fd test now withholds every remaining candidate. The before reader listed them. A separate real Python process holds a bound datagram socket; the candidate excludes its directory and still lists the free directory. The before reader listed both. `unixSockets()` reads all named bound sockets from `/proc/net/unix`, while `unixListeners()` keeps its separate discovery and stale-socket meaning.

The command-level permission test makes one fixture fd directory unreadable. It proves zero stdout, a reason on stderr, no `leftover-temp` flag, and retained `unknown.paths` in JSON. Before the repair, stdout contained the path and stderr was empty. Snapshot construction now preserves the whole unknown entry. The code also withholds for unreadable arguments. Other tests cover missing socket evidence, five process names plus the remaining count, and gone, zombie or reused pids. Failed process reads get one batched identity check.

**Design judgement — proven fit to amended D7:** withholding is the correct result when non-use cannot be proved. Known-used paths are removed first. The remaining paths appear only in one unknown entry; they produce no deletion claim and no flag exit contribution. `--leftovers` exposes the reason on stderr. On a host with unreadable SSH session processes this can make cleanup unavailable for the whole session. That is a substantial, explicit product limit, not a silent assertion that the directories are unused. A process-name exemption would restore the false claim because such a process can hold a candidate open. The coordinator's choice is acceptable within this review's safety contract.

The constructor allowlist, uid, live-key, age and path-boundary checks remain intact. The tests still reject other tools' names and `/tmp/sq-*`. A missing whole cwd source remains a rule-not-evaluated unknown, rather than a path list. The size walk still runs only with `--full`, with the existing entry bound.

### B3 — proven fixed: uncertain reaping reaches the CPU bound

Location: `src/core/ps/measure.ts:118`; `test/ps/measure.test.ts:221`; `test/ps/snapshot.test.ts:279`.

The exact round-1 case keeps the conservative 35% value rather than claiming the recoverable 55% is complete. The browser has no confirmed reaper. Its uncertainty now reaches Squeal, repository and descendant sums, the unknown cause, and rendered `at least` / `+` marks. In the before snapshot, `skipped.cpuPct` was 0 instead of 1. This externally visible assertion proves the repair independently of the new internal fields.

Reaping is confirmed only for a parent that survives with the same start, is not a zombie, has readable children's times, and has enough growth for the ended children's baseline. Otherwise the subtraction remains conservative and the affected row carries uncertainty. Separate tests cover insufficient growth, a zombie parent and an ended process hidden below a row. The own-growth clamp remains. Existing born, directly reaped and hidden-child cases still pass, with each contribution assigned once. Fixture changes give confirmed-reaping cases the corresponding child-counter growth; they do not drop the uncertain case.

### S1 — proven fixed: a source without children's times displays a bound

Location: `src/core/ps/measure.ts:163`; `test/ps/snapshot.test.ts:379`.

Numeric CPU on such a source now carries `childCpuUnread`, and `sumCosts` counts partial as well as whole omissions. The snapshot test asserts positive skipped CPU and `at least` on both Squeal and repository lines. Before the repair, the skipped count was 0. The platform cause remains one unknown entry. Real macOS execution remains **unverified**; the fixture and fallback contract are covered.

## Residual note

### N1 — proven, accepted limit: the final writer can close before the first read

Location: `src/core/ps/work.ts:105`; `test/ps/work-store.test.ts:147`; spec D3.

The deterministic test closes the last writer after the sidecar check and reader open but before the first read. It checks that the files disappeared, then that the read returns the newer record and recreates both files. This passed in the candidate proof. N1 is no longer merely plausible, and is not described as fixed.

An independent `node:sqlite` probe confirmed the relevant mode behaviour on Node v24.21.0:

```text
mode          read after last writer closed        resulting files
ordinary      correct value                       db, db-shm, db-wal
readonly_shm  unable to open database file         db, db-wal
nolock        unable to open database file         db
unix-none     unable to open database file         db
```

`nolock` and `unix-none` also failed to read while the writer held the WAL. Thus the named alternatives do not close the supported WAL-reader path without a write or failed read. The approximately 0.1 ms interval is the implementer's reported observation, **unverified** as a timing bound by this review; the forced schedule, not that estimate, establishes the race. This review does not prove that every possible future SQLite or native-lock approach is impossible. D3, the code comment and status log name the current limit. No new repair is required by this bounded brief.

## Spec and regression assessment

**Proven:** D3 matches the partial-WAL rejection, immutable fingerprint, shared query and named race. D4 describes conservative subtraction and uncertain reaping; D5, D6 and D8 propagate partial CPU omissions. D7 matches all bound sockets, use-read withholding, the one unknown entry and stderr behaviour. D10 matches the unavailable macOS evidence and CPU bound. D8 adds only optional `unknown.paths` to the public shape and keeps `v: 1`. Internal `reaperUnknown` and `childCpuUnread` do not escape `costOf`'s selected public cost fields. D9 and D11 require no further repair amendment.

**Proven within the tested cases:** the repairs retain the previously passing name rules, memory of ended descendants, own-departure text, one query per store, full-only bounded size walk, integer rendering, and 60 s orphan floor. The final `childTicks: 0` fixture addition matches the `ProcessRow` interface on the new base; typecheck covers that seam. The 650-process cost test is among the passing focused tests. All four committed bundle trees match the build.

Round 2 does not reopen the settled parts of the round-1 review. The release dogfood row 014-30 still owes its host CPU-share, memory and whole-command timing evidence. The earlier review's unverified live measurements do not become proven through these fixture results.

## Blockers, should-fix and next input

No blockers. No new should-fix or nits in the repair range. Keep N1 visible when describing read-only behaviour, and keep B2's unknown result visible when judging cleanup usefulness. The coordinator decides whether to land this candidate. This review does not mark the spec shipped.
