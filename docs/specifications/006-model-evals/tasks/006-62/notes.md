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
