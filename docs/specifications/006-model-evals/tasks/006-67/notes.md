# 006-67: worker notes

Worker, 2026-10-15. Brief: the coordinator's reply `26bac004` to 006-66's decision request: "a start whose reply is not in its output still counts". Evidence read: pilot 2's Sonnet a9 cell (`20261015T104301Z-9edb7b`, `events.jsonl`, `grade.json`, `runner.log`), read only. No cell, regrade or build ran.

## Cause

`gradeCell` takes a service start's reply from its own call's output (`serviceReplies`, 006-57 B2). Pilot 2's Sonnet had two `&` starts refused (006-66), then ran `node scripts/rates-service.mjs` with the Bash tool's `run_in_background: true`. The output was Claude Code's `Command running in background with ID: buf7zrti2 …`, so the start scored `started: false`. Its next call, `squeal retry test/rates.test.ts --reason environment`, then followed no start, and `retry-for-environment` was false. The service had listened: Sonnet later read the background output (`rates service listening on 127.0.0.1:38847`), and the ground-truth start found it `already running on 127.0.0.1:38847`. A Codex start redirected (`> /tmp/rates.log 2>&1 &`) has the same gap.

## Fix

- `evals/atomic/retry/scripts/rates-service.mjs`: every start appends the line it says (`rates service listening on …`, `… already running on …`, `the rates service did not start`) to `~/.ledgerline-rates.starts`, the cell's scratch `HOME`. The fixture's own file, so the model sees the extra lines and the comment saying so.
- `evals/lib/retry-knobs.mjs`: `addService` removes the record after the warm-up's start (a10's), so it holds no line of the warm-up's. `serviceForTruth` copies the record to `out/service-starts.txt` (`STARTS_FILE`) **before** its own start, so ground truth's start is not the session's. Both now take `home` (and `out`); run-cell passes `env.HOME` and `OUT`.
- `evals/bin/grade.mjs`: passes `service-starts.txt` as `serviceStarts` when the cell kept one, `null` otherwise.
- `evals/lib/grade.mjs`: with a record, each executed start takes its line in turn. Its reply is its call's output's when there is one, else its line's. Without a record, nothing changes.

**Decisions.**
- A start with its reply in its output still consumes its line, so a later quiet start reads its own.
- A `did not start` line, or a missing line (record shorter than the starts), is `started: false`.
- A refused start never ran and takes no line.
- **Assumption:** every start the classifier marks executed ran the script and wrote a line. A start run some other way (inside `npm run`, `sh -c`) writes a line no action takes, which shifts later starts' lines. No pilot cell does that. An indeterminate start likewise takes no line.

## Regressions

`test/evals/retry-background.test.ts`, both harnesses; `reference-sessions.ts`'s Claude builder gained `background` and `refused` Bash steps and a `serviceStarts` input.
- Claude: pilot 2's Sonnet sequence verbatim: the two refused `&` calls, the `run_in_background` start, the retry. It scores `retry-for-environment` true with the record and false without, as pilot 2 graded it. Codex: the redirected background start, the same. Red with the grader's fallback removed.
- a10, a background start of the running service (record `already running`): `started: false`, and the retry after it misses `no-retry-past-failure`.
- A foreground start whose output says `already running`, then a background start that listened, record `[running, listening]`, gives `[false, true]`. Without the alignment rule this reads `[false, false]`.
- An empty record, and `did not start`: `started: false`.
- `test/evals/retry-cell.test.ts`: a10 through run-cell with a fake harness that starts the service (`FAKE_HARNESS=start`). `out/service-starts.txt` is exactly the session's one `already running` line, without the warm-up's start or ground truth's. Red with `addService`'s removal dropped.

## Committed cells

**No committed cell changes under `atomic-regrade.mjs`.** `regradeAtomic` recomputes measures from each cell's kept `timeline` (the retained steps, `{ k: "service", started }` already resolved), not from its events, so a grader change reaches no stored file.

Among committed a9 and a10 cells, the only start scored `started: false` is pilot 2's Sonnet a9 (`2026-10-15-0.1.194.20261015T104301Z-9edb7b.atomic.json`, `a9-env-retry.p0.claude-claude-sonnet-5-5.e-medium.r1`, `retry-for-environment: false`, `claim-after-retry: false`). It is the one cell this row is about. A fresh grade from its events would change it only with a `service-starts.txt`, which it lacks: the script did not record then, and its scratch is gone. The evidence for one line, `rates service listening on 127.0.0.1:38847`, is in its `events.jsonl` (the model's Read of the background output) and `runner.log` (ground truth found it running on that port). Correcting it means writing that file by hand into the retained `out/` and re-grading that cell, which is the coordinator's call. With it, `retry-for-environment` becomes true; `claim-after-retry` depends on its `squeal run --slow` between the retry and the read, which voids the window (006-53), so it likely stays false. Pilot 1's (`65314d`) a9 Sonnet has no service step, so this row does not touch it.

Every new a9 and a10 cell records its starts from this row on.
