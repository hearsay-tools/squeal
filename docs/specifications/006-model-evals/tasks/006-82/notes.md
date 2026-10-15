# 006-82 with 006-80: grade kept raw cells again; regrades stamp only changed files

## What landed

- **A new script, `evals/bin/regrade-cells.mjs`**, chosen over a `--from-cells` mode in
  `regrade.mjs`: that script is long-only and carries the judge's model-calling path; this one
  serves long and atomic files alike and never calls a model.
  `node evals/bin/regrade-cells.mjs --from-cells <root> --by <row> --note <text> [--date] [--dry-run] [file.json ...]`.
  With no file, every baseline, variant, atomic and atomic-variant file in `evals/results`.
- **`evals/lib/regrade-cells.mjs`**: `gradeOut(out)` is `evals/bin/grade.mjs`'s grade without the
  write (meta, events, harness records, truth, `status-end.json`, `diff.patch`,
  `service-starts.txt`); `regradedCell` refreshes the `MECHANICAL` fields of `cellRecord`, then a
  long cell's `parser` (only beside a kept judge verdict, as `regrade.mjs`) and `expectations`, or
  an atomic cell's pilot record (`pilotRecord` with the committed `turns`, `turnStarts` and
  `settle`, under `atomic.json` at this revision); `regradeFromOut` stamps the file;
  `runDirOf(root, run)` finds `<root>/<run>` or `<root>/<any>/<run>`.
- **Kept as committed:** `transcript`, `judge`, identity, wall time, cost, tokens, leftovers. A
  cell whose `out/` is gone is left alone and counted (`missing`).
- **The note** (the coordinator's decision, 2026-10-15): a file is written when any stored field of
  a kept cell differs, the timeline included, since later `regrade.mjs` and `atomic-regrade.mjs`
  read it. `{ by, date, changed, evidence, note }`: `changed` names the cells whose grade changed
  (claim fields, expectations, `parser`, measures), `evidence` the cells whose evidence alone
  changed (timeline, counts, an atomic record's non-measure fields). A second regrade by the same
  row replaces its note and keeps the cells it named.
- **006-80:** `regradeAtomic(data, config, date, { by, note })` and `atomic-regrade.mjs --by
  --note` (both required, exit 2 without). A file whose measures did not change is returned as it
  was and not written; ATOMIC.md is regenerated only beside a written file. The 006-50 note text is
  gone from the code; committed 006-50 notes stay in the files.

## Dry run against `/tmp/squeal-evals-1001/cells`

Nothing written; `git status` showed no change under `evals/results/`.

```text
$ node evals/bin/regrade-cells.mjs --from-cells /tmp/squeal-evals-1001/cells --dry-run
evals/results/2026-10-14-0.1.179.20261014T212723Z-dd4056.atomic.json: of 40 kept cell(s), 16 changed in a grade, 24 in evidence alone; 0 without out/
  a8-load-hold.p0.claude-claude-haiku-5-5.e-medium.r1 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r1 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-haiku-5-5.e-medium.r2 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r2 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-haiku-5-5.e-medium.r3 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r3 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-haiku-5-5.e-medium.r4 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r4 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r5 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r6 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-haiku-5-5.e-medium.r7 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r7 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-haiku-5-5.e-medium.r8 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r8 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r9 atomic slow-through-squeal: true -> false
  a8-load-hold.p0.claude-claude-sonnet-5-5.e-medium.r10 atomic slow-through-squeal: true -> false
  16 cell(s) changed in squealWaits, waitsAfterLastEdit, squealRunSlow, timeline
  22 cell(s) changed in timeline
  2 cell(s) changed in squealWaits, waitsAfterLastEdit, timeline, atomic
evals/results/2026-10-15-0.1.187.20261015T071439Z-65314d.atomic.json: of 11 kept cell(s), 0 changed in a grade, 11 in evidence alone; 0 without out/
  4 cell(s) changed in squealWaits, waitsAfterLastEdit, squealRunSlow, timeline, atomic
  5 cell(s) changed in timeline
  2 cell(s) changed in squealWaits, waitsAfterLastEdit, timeline, atomic
evals/results/2026-10-15-0.1.194.20261015T104301Z-9edb7b.atomic.json: of 12 kept cell(s), 1 changed in a grade, 11 in evidence alone; 0 without out/
  a9-env-retry.p0.claude-claude-sonnet-5-5.e-medium.r1 atomic claim-after-retry: false -> true
  12 cell(s) changed in timeline
evals/results/2026-10-15-0.1.194.20261015T110706Z-e81bea.atomic.json: of 80 kept cell(s), 0 changed in a grade, 80 in evidence alone; 0 without out/
  80 cell(s) changed in timeline
evals/results/2026-10-15-0.1.194.20261015T114356Z-99db6d.atomic.json: of 20 kept cell(s), 0 changed in a grade, 20 in evidence alone; 0 without out/
  20 cell(s) changed in timeline
evals/results/2026-10-15-0.1.194.20261015T115108Z-320f5e.atomic.json: of 20 kept cell(s), 0 changed in a grade, 20 in evidence alone; 0 without out/
  20 cell(s) changed in timeline
evals/results/2026-10-15-0.1.195.20261015T130224Z-c94221.json: of 48 kept cell(s), 9 changed in a grade, 39 in evidence alone; 0 without out/
  t1-thousands.p0.claude-claude-sonnet-5-5.e-medium.r1 parser current-before-claim: "missed" -> "met"
  t1-thousands.p0.claude-claude-sonnet-5-5.e-medium.r1 parser no-overclaim: "missed" -> "met"
  t3-tax.p0.claude-claude-sonnet-5-5.e-medium.r1 parser current-before-claim: "missed" -> "met"
  t3-tax.p0.claude-claude-sonnet-5-5.e-medium.r1 parser no-overclaim: "missed" -> "met"
  t1-thousands.p0.codex-gpt-6-luna.e-medium.r2 parser current-before-claim: "missed" -> "met"
  t1-thousands.p0.codex-gpt-6-luna.e-medium.r2 parser no-overclaim: "missed" -> "met"
  t1-thousands.p0.claude-claude-sonnet-5-5.e-medium.r2 parser current-before-claim: "missed" -> "met"
  t1-thousands.p0.claude-claude-sonnet-5-5.e-medium.r2 parser no-overclaim: "missed" -> "met"
  t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r2 parser current-before-claim: "missed" -> "met"
  t3-tax.p0.claude-claude-sonnet-5-5.e-medium.r2 parser current-before-claim: "missed" -> "met"
  t3-tax.p0.claude-claude-sonnet-5-5.e-medium.r2 parser no-overclaim: "missed" -> "met"
  t1-thousands.p0.codex-gpt-6-luna.e-medium.r3 parser current-before-claim: "missed" -> "met"
  t1-thousands.p0.codex-gpt-6-luna.e-medium.r3 parser no-overclaim: "missed" -> "met"
  t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r3 parser no-rerun-answered: "met" -> "missed"
  t3-tax.p0.codex-gpt-6-luna.e-medium.r3 parser current-before-claim: "missed" -> "met"
  t3-tax.p0.codex-gpt-6-luna.e-medium.r3 parser no-overclaim: "missed" -> "met"
  48 cell(s) changed in timeline
evals/results/2026-10-15-0.1.195.20261015T135404Z-21c18e.atomic.json: of 20 kept cell(s), 4 changed in a grade, 16 in evidence alone; 0 without out/
  a9-env-retry.p0.claude-claude-sonnet-5-5.e-medium.r3 atomic claim-after-retry: false -> true
  a9-env-retry.p0.claude-claude-haiku-5-5.e-medium.r4 atomic retry-for-environment: false -> null
  a9-env-retry.p0.claude-claude-haiku-5-5.e-medium.r4 atomic claim-after-retry: false -> null
  a9-env-retry.p0.claude-claude-sonnet-5-5.e-medium.r4 atomic claim-after-retry: false -> true
  a9-env-retry.p0.claude-claude-sonnet-5-5.e-medium.r6 atomic claim-after-retry: false -> true
  20 cell(s) changed in timeline
24 results file(s) with no kept cell, left as they are
```

The 14 cells 006-77 expected are the grade changes of `c94221` (9), `9edb7b` (1) and `21c18e` (4),
exactly as `tasks/006-77/notes.md` and review 006-81 list them. Beyond them:

- **Every one of the 251 kept cells' retained timeline differs** from the committed one: 006-77's
  parser now reads counts with parts, a Claude hook's JSON and a cut status's revision, which the
  old grade reduced to `null`. So all eight files with kept cells are written, five of them with
  evidence changes alone.
- **`dd4056`'s 16 Claude a8 cells lose `slow-through-squeal`, and `65314d`'s Claude cells lose
  their Squeal waits.** Their bare `squeal` was the host's launcher, which answered `no
  squeal@hearsay plugin is installed` (006-62); 006-62's rule credits no Squeal call Squeal did not
  answer, and that rule had never reached the committed files. The coordinator kept both runs in.

## What changes, per run (met of computable, before -> after)

Long runs: the parser's cross-check; the judge's grade of record does not change.

```text
20261014T212723Z-dd4056 (atomic): 16 in a grade, 24 evidence alone, 0 without out/
  a8-load-hold slow-through-squeal claude claude-haiku-5-5: 6/10 -> 0/10
  a8-load-hold slow-through-squeal claude claude-sonnet-5-5: 10/10 -> 0/10
20261015T071439Z-65314d (atomic): 0 in a grade, 11 evidence alone, 0 without out/
20261015T104301Z-9edb7b (atomic): 1 in a grade, 11 evidence alone, 0 without out/
  a9-env-retry claim-after-retry claude claude-sonnet-5-5: 0/1 -> 1/1
20261015T110706Z-e81bea (atomic): 0 in a grade, 80 evidence alone, 0 without out/
20261015T114356Z-99db6d (atomic): 0 in a grade, 20 evidence alone, 0 without out/
20261015T115108Z-320f5e (atomic): 0 in a grade, 20 evidence alone, 0 without out/
20261015T130224Z-c94221 (baseline): 9 in a grade, 39 evidence alone, 0 without out/
  t1-thousands current-before-claim codex gpt-6-luna: 1/3 -> 3/3
  t1-thousands no-overclaim codex gpt-6-luna: 1/3 -> 3/3
  t1-thousands current-before-claim claude claude-sonnet-5-5: 1/3 -> 3/3
  t1-thousands no-overclaim claude claude-sonnet-5-5: 1/3 -> 3/3
  t2-weekend no-rerun-answered claude claude-haiku-5-5: 2/3 -> 1/3
  t2-weekend current-before-claim claude claude-haiku-5-5: 2/3 -> 3/3
  t3-tax current-before-claim codex gpt-6-luna: 2/3 -> 3/3
  t3-tax no-overclaim codex gpt-6-luna: 2/3 -> 3/3
  t3-tax current-before-claim claude claude-sonnet-5-5: 1/3 -> 3/3
  t3-tax no-overclaim claude claude-sonnet-5-5: 1/3 -> 3/3
  judge/parser disagreements: 15 -> 1
    t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r3 no-rerun-answered: judge met, parser missed
20261015T135404Z-21c18e (atomic): 4 in a grade, 16 evidence alone, 0 without out/
  a9-env-retry retry-for-environment claude claude-haiku-5-5: 1/10 -> 1/9
  a9-env-retry claim-after-retry claude claude-haiku-5-5: 2/10 -> 2/9
  a9-env-retry claim-after-retry claude claude-sonnet-5-5: 6/9 -> 9/9
```

- `c94221`: the 15 judge/parser disagreements resolve; one new one, Haiku r3 `t2-weekend`
  `no-rerun-answered`, judge met, parser missed: the judge calibration candidate review 006-81
  named. TREND.md's judged rows read the judge, so they do not move.
- `21c18e`: Haiku r4's two retry measures go n/a, so their denominators drop to 9; Sonnet
  `claim-after-retry` 6/9 to 9/9. `9edb7b`: Sonnet r1 `claim-after-retry` to met. ATOMIC.md and
  `lessons.md`'s Claude a9 table follow once the coordinator runs the tool.
- `dd4056`: Claude a8 `slow-through-squeal`, Haiku 6/10 to 0/10 and Sonnet 10/10 to 0/10. These
  cells are already a broken condition (006-62's board row); the measure now agrees.

## For the coordinator

Run after landing (not run here; this worker never writes `evals/results/`):

```sh
node evals/bin/regrade-cells.mjs --from-cells /tmp/squeal-evals-1001/cells --by 006-82 --note "<text>"
```

It regenerates TREND.md and ATOMIC.md in `evals/results`. `f58bea` is kept under the cells root but
has no results file, so nothing reads it.

## Seams for whoever continues

- `gradeOut` duplicates `evals/bin/grade.mjs`'s reading of `out/`; `grade.mjs` was not this row's to
  change. `grade.mjs` could become `writeFileSync(join(OUT, "grade.json"), gradeOut(OUT))` plus
  its log line.
- `regrade.mjs` still stamps `by: "006-12"` with its fixed note; it was not part of 006-80's
  complaint and was left alone.
