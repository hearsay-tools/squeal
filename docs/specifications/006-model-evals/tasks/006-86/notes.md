# 006-86 notes (worker, 2026-10-15)

## Seams

- `stamped(regraded, note)` (`evals/lib/results.mjs`) is the one regrade note merge. It replaces
  a note with the same `by` and `revision` (only the expectations pass sets `revision`), unions
  `changed`, and, where the note has `evidence` (`regrade-cells`), unions it less the cells now in
  `changed`. Callers: `regradeAtomic` (`atomic-measures.mjs`), `regradeFromOut`
  (`regrade-cells.mjs`), and `bin/regrade.mjs`'s claim and expectations passes. The judge note
  (`{ by: "judge", identity, ... }`) still appends: it was never a merge.
- `writeTrendMarkdown(dir, declared)` (`evals/lib/trend.mjs`) reads every `*.json` in `dir`, writes
  `TREND.md` and returns the number of baseline runs. Callers: `bin/trend.mjs`,
  `bin/regrade-cells.mjs`, `bin/regrade.mjs`. All three now print "from N baseline results file(s)".
- `gradeOut(out)` (`evals/lib/regrade-cells.mjs`) is the one reader of `out/`. `bin/grade.mjs` calls
  it, writes `grade.json` and prints its line. It reads `STARTS_FILE` from `retry-knobs.mjs`.

## Decisions the brief did not settle

- `regrade.mjs --by/--note`: required only when the claim pass changed a cell. Without them it
  refuses (exit 2) and writes nothing. An expectations-only regrade (a `tasks.json` change) needs
  neither. `atomic-regrade.mjs` requires both always. The old 006-12 `BY` and `NOTE` are gone.
- A change to the stored `parser` cross-check (D9) counts as a grade change. It is stamped under
  the expectations note, beside expectation changes. `regrade-cells` already counts `parser` as a
  grade. Before this row, `regrade.mjs` refreshed `parser` in memory and kept it only when the file
  was written for another reason.
- `expectationsRevision` is set only when the expectations pass changed a cell. It names the
  revision that last changed the file, not the last revision that read it.
- `regrade.mjs` regenerates `TREND.md` only when it wrote a file. `bin/trend.mjs` still
  regenerates it on demand.
- `gradeOut` returns `null` only without `meta.json`. Before, it also returned `null` without
  `events.jsonl`, while `bin/grade.mjs` graded such a cell on an empty timeline. A session that
  printed nothing has no `events.jsonl`; `nested-evidence.test.ts` pins this. Now both
  grade it on an empty timeline.

## The check on a copy of `evals/results` (outside the repository, no `--judge`)

`regrade.mjs` wrote 5 of 13 baseline and variant files. Each change is the stored `parser`
cross-check of `current-before-claim`, `missed` → `met`, in 12 cells. No claim and no
expectation of record changed. The frozen parser's rule moved since these files were last
written, and the old run never kept a `parser` refresh on its own.

- `2026-10-11-0.1.123…-215639.json` (2 cells)
- `2026-10-11-0.1.124…-d0d96d.json` (3)
- `2026-10-11-0.1.127…-176fc7.skill-file.json` (3): one of the seven
- `2026-10-12-0.1.127…-753e7c.slow-step.json` (2): one of the seven
- `2026-10-12-0.1.127…-90f31d.stop-slow.json` (2): one of the seven

Of the seven files carrying neither old note, `4306cd.skill-desc`, `af5be4`, `5062b3` and `c94221`
were not written. A second run over the copy wrote nothing.

`atomic-regrade.mjs` over all 19 `*.atomic.json` and `*.atomic-variant.json` files wrote none.

The committed results are not regraded here. The coordinator decides whether to run
`regrade.mjs` on the repository to keep these 12 `parser` refreshes, and under which row.

## Left for the next worker

- The default file list of `atomic-regrade.mjs` (now including `.atomic-variant.json`) has no bin
  test: the bin reads `evals/results` itself, and a test there could write the repository. An
  in-memory test pins that the committed atomic-variant files are current.
