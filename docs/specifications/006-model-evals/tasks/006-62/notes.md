# 006-62: worker notes

Worker, 2026-10-15. Brief: `tasks/wave-13.md`, "006-62 the pilot's findings". Evidence read: pilot `20261015T071439Z-65314d`'s retained cells (read only). No cell, session or regrade CLI ran.

## 1. A cell's bare `squeal` is the pinned plugin's

**Cause.** `cellEnv` keeps the host's `PATH`, which starts with `/home/agent/.local/bin`; its `squeal` (spec 005 D3's launcher) reads `installed_plugins.json` under the cell's empty `HOME`. Claude Code's `--plugin-dir` registers nothing there, so it answered `squeal: no squeal@hearsay plugin is installed …` in every pilot Claude cell (a9 to a11, both models). Claude Code appends the plugin's `bin/` after the inherited `PATH`, so the launcher won. Codex cells worked only because the launcher finds the pinned plugin in the cell's `CODEX_HOME`.

**Fix.** `squealBin(harness, cell, pin)` names the directory a cell's bare `squeal` comes from, and run-cell puts it first on the cell's `PATH` (`pathFirst`) right after the pin is built, before the fixture, the daemon or the session:
- Claude Code: the pinned plugin's own `bin/` (`plugins/claude-code/bin/squeal`, spec 001 D9).
- Codex: Codex puts no plugin `bin/` on the `PATH` (its README), so a real Codex user's `squeal` is the launcher `install.sh` copies. The pinned plugin's `bin/squeal-launcher` is copied to `<cell>/home/.local/bin/squeal`, where `install.sh` would put it, and that directory goes first. It resolves the same pinned CLI as before (from the cell's `CODEX_HOME`), without depending on the host's file or its format, so Codex cells' condition does not change. It goes with the scratch `home`.
- No-plugin variants: unchanged. Their bare `squeal` is still whatever the host's `PATH` holds (today the launcher, which says no plugin is installed: true for that cell).

The host's `~/.local/bin` stays on the `PATH` (it holds `claude` and other tools); it is only shadowed for `squeal`.

**Regressions.** `test/evals/cell-squeal.test.ts`: in a temp fixture whose host `PATH` starts with a launcher of its own, a cell's `sh -c "squeal --version"` answers from the host before the fix and from the pinned CLI after, in both harnesses (the Codex half runs the real launcher against a cell `CODEX_HOME`). `test/evals/run-cell.test.ts`: a fake Claude session's bare `squeal` reaches the pin's fake CLI through run-cell (red with run-cell's line removed: `host launcher`).

**First run must confirm:** that Claude Code's Bash tool keeps the inherited `PATH` order (no login-shell snapshot that re-sorts it); the cell's `HOME` has no profile, so none should.

## 2. Only a Squeal command Squeal answered is a Squeal action

**Cause.** `gradeCell` made every executed `squeal` command a pull, whatever answered it. The a8 run's Claude cells' `squeal status --wait 60000; squeal run --slow --wait 60000` got the launcher's reply twice (exit 1), and `slow-through-squeal`, `squealWaits` and `squealRunSlow` credited it.

**Rule (`unanswered` in `squeal-text.mjs`).** Of a call's executed Squeal commands, none was answered when the call exited non-zero with no Squeal text in its output; otherwise one per foreign reply: the launcher's `squeal: no squeal@hearsay plugin is installed` (formats 3 and 4), the shell's `squeal: command not found`, Node's `Cannot find module '…squeal.mjs'`. The unanswered ones are the call's first (one binary answers every bare `squeal` of a call alike, so in practice it is all or none). An unanswered command is no pull (so no wait, no `why`, no `run --slow` count, no `waitsAfterLastEdit`, no `slowBeforeClaim` entry) and leaves no `from: "pull"` evidence step. Its `squeal-run` step stays (R1: a failed attempt still voids a retry's window), and a `retry` step stays with no reply, so nothing is queued.

Squeal text, for that test: Squeal's evidence (`squealEvidence`), or a line starting as Squeal's replies do, including its own refusals: `squeal: no daemon running for …`, `squeal run: unknown argument …`, `No verdict: …` (exit 3), `Run requested (…)` (exit 1), `Not retried: …` (exit 1), `status --json`'s `"knownFailures"`. **Decision:** a usage error is Squeal's own answer and stays a pull as before; it changes no committed grade. Whether a refused `squeal run --slow --wait` (no milliseconds) should count toward `slow-through-squeal` is a metric question outside this finding (6eec71's a2 Haiku r11 is one such cell).

**Regressions** (`test/evals/unanswered-squeal.test.ts`, both harnesses, each red before): the a8 call verbatim, format 4's text, `command not found` (127), exit 1 with no Squeal header, each followed by an own run and a `fail` claim: no pull, wait or slow run, `slow-through-squeal` missed, the `squeal-run` step kept. An answered `run --slow` beside an unanswered one counts once. An unanswered `squeal run --all --force` between a11's retry and a clean status still voids the window (`claim-after-retry` missed).

**Committed files.** `regradeAtomic` reads each cell's stored pilot record, so all 14 committed `.atomic*.json` files (the 13 earlier and the pilot) regrade identically: 0 cells changed in each. Graded afresh from the retained events (both trees' `gradeCell` and `pilotRecord` over `/tmp/squeal-evals-1001/cells/*/{dd4056,65314d}/*/out`, read only; no regrade CLI):
- a8 `20261014T212723Z-dd4056`: **`slow-through-squeal` true → false in 16 Claude cells** (Haiku r1–r4, r7, r8; Sonnet r1–r10). Haiku r5, r6 were false already; pulls and waits drop to 0 in all 18 cells the launcher answered. No Codex cell moves.
- Pilot `65314d`: the 6 Claude cells' pull, wait and `run --slow` counts drop to 0; no measure moves.
- The transcripts of the 13 earlier files hold 2 more cells with an unanswered call (ae0c65's a2-slow Luna r6 and r9, a wrong `squeal.mjs` path); their calls were status reads whose text carried no evidence, so no measure would move.
The committed results files are not edited (not this row's); finding 3 marks the a8 Claude cells broken.

## 3. The host launcher's runs are a broken condition

**Rule.** `atomic-trend.mjs`: `HOST_LAUNCHER_FROM = "20261014T154710Z"` (the launcher's install, 15:47Z). A run's Claude cells, per model, are `broken: "host launcher"` when the run id (a timestamp) sorts from it on and a cell does not record `squealPath: "pinned"`. `brokenCondition` returns `"old root"`, `"host launcher"` or `null`; flags and the scoreboard count only runs with `broken === null` (they read `oldRoot` before), and the tables mark the run `(host launcher)` as they mark `(old root)`. Codex cells are never marked. `oldRoot` stays on each run as before.

**Decision: "until this row lands" as a record, not a date.** The landing time is unknown here and a run id bound would need a later edit. run-cell now writes `squealPath: "pinned"` into `meta.json` for every cell with the plugin (finding 1's `PATH`), `grade.json` carries it, and `cellRecord` keeps it (additive; older cells name none). So a run made with this row's code counts, and every Claude run from 15:47Z before it is marked. A synthetic id that is not a timestamp (`A`, `r1`) is never marked, as no real run has one.

Marked among the committed files: Claude cells of `20261014T164503Z-b3bbc5` (0.1.131's re-run; its transcripts show no launcher reply, as that pin's skill named the CLI path, but it ran in the window and the brief marks the window), `20261014T212723Z-dd4056` (a8) and `20261015T071439Z-65314d` (the pilot). The committed-results test (flags and alarms beyond the accepted ones) still passes. `evals/results/ATOMIC.md` is not regenerated here (not this row's file): the coordinator's `node evals/bin/atomic-trend.mjs` will show the marks.

**Regressions** (`test/evals/host-launcher.test.ts`): a Claude run in the window marked and counted by no flag or scoreboard while its Codex cells flag; a later run recording `squealPath` counts; the old root's mark before; `cellRecord` keeps the field; the committed runs above marked, Claude only. `run-cell.test.ts`'s bare-squeal cell asserts `grade.json`'s `squealPath`.

**Type changes (additive):** `AtomicRun.broken`, `BrokenCondition`, `HOST_LAUNCHER_FROM`, `hostLauncher`, `brokenCondition`; cell records and `meta.json` gain `squealPath`.

## 4. a11: the FAIL stored at 2.40, and a retry that passes at the same inputs

Both causes reproduced with the committed 0.1.187 CLI (`plugins/claude-code/dist`) on a `buildFixture` copy of ledgerline in `/tmp/squeal-62-repro-*`, its `HOME`, `TMPDIR` and `XDG_RUNTIME_DIR` inside it, the pinned-load preload as `retryEnv` sets it, no harness; each fixture and daemon removed after. The scripts are in the task's tmp directory (`repro.mjs`, `probe-order.mjs`), not committed.

**Cause A, the FAIL at 0.20 (luna).** `stageInherited` dropped the load after `squeal status --wait 300000`, which returns "on quiet" as soon as the edits since revision 0 re-keyed nothing (0.8 s in the pilot's log): the baseline checkpoint, which this wait does not hold for, had not run the calendar test yet. It ran at 0.20, and S1's check failed the cell. Reproduced: `stored loads: [0.2]`, `not staged by the warm-up … ran at 0.20 per CPU, not 2.40`.

**Cause B, the retry timing out again (sol).** The calendar's cold counter lives in `os.tmpdir()/ledgerline-calendar/<key>`, and under Squeal `os.tmpdir()` is the daemon's temp directory, which a daemon empties at start (`prepareScratch`) and removes at stop (`removeScratch`). Staging stopped the warm-up's daemon and started a fresh one "without the cold cache", but that also threw the cache away: the fresh daemon's first calendar load, the retry's, was cold again (600 ms against 250). Reproduced with the order fixed and the old restart kept: the retry ran and `test/clock.test.ts` failed again, `observed at revision 1`.

**Fix (`stageInherited`, no fixture change).** Start at 2.40 with two cold loads; `status --wait 300000` to list the files, then `status --wait 300000 test/clock.test.ts`, the named wait, which returns once the calendar test has its result (both runs timed out, stored at 2.40, 6 of 7 files done); only then the load drops to 0.20 and `run --all --wait` runs the slow tier. The daemon is kept: its cache now counts two loads, so the session's retry at the same inputs runs warm. Reproduced: `stored loads: [2.4]`, the retry `Retry queued (reason: load) …`, then `Known failures: 0`. S1's check runs once, after the warm-up; the after-restart check went with the restart.

Probed and rejected: `run --all --wait` at 2.40 waits for the slow file, which the load guard holds at 2.40 (`maxLoadPerCpu` 1), and ran out after 120 s; though the FAIL was stored at 2.40, it would cost every cell the slow tier's `maxDeferMs`.

**Decisions.** `calendar-cache.ts` is unchanged: moving its cache out of `os.tmpdir()` would change the fixture commit of every scenario and task (the baseline's trend lines), and the staging alone fixes a11. The daemon that ran the warm-up keeps `LEDGERLINE_CALENDAR_COLD_RUNS=2` in its environment for its life; with the counter at 2 that changes nothing until `src/clock.ts` changes (a new key, two cold loads instead of one), which a11's edit does not touch. `stageInherited`'s `stop` dependency is no longer called; it stays optional in the type (additive), and run-cell no longer passes it.

**Regressions** (each red against the old staging): `retry-staging.test.ts` pins the order, each call with the load it met and the cold flag, and no stop or second start; `retry-cell.test.ts` runs a dry a11 cell through run-cell with the fake Squeal now storing the FAIL with the load of the first command that runs the calendar test (a wait naming it, or `run --all`), as the real daemon did: 2.4 after the fix, 0.2 before (the cell failed setup). The staging precedes the session and is the same in both harnesses; the fake Codex cannot install a plugin, so the run-cell half runs as Claude.

**First run must confirm:** the named wait on a loaded host (it held here at a real load near 5 on 24 CPUs) and that the session's registration reads the FAIL "recorded under load 2.40".
