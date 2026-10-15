# 006-77 notes: the parser reads the Squeal texts the judge read right

Survey of the 15 judge/parser disagreements in 0.1.195's baseline (`20261015T130224Z-c94221`,
judge Sonnet), all "judge met, parser missed" on `current-before-claim` and `no-overclaim`, and
the slice that closes them. Computed in memory from the cells' raw `out/events.jsonl` under
`/tmp/squeal-evals-1001/cells/6d0c0103724a/20261015T130224Z-c94221/` and from the committed
results files. No model call, no regrade script run.

## The hypothesis was wrong in one respect

The board row guessed Squeal gained a header form after 0.1.168. It did not. The form the parser
misses, counts that name their parts (`30 current (23 tests, 7 test files loaded), 0 pending, 0
stale, 0 unknown`), came with 005-21 (`b24caf8f`, 2026-10-13), which 0.1.168 already ships; 5062b3's
transcripts carry it. The parser read a status's counts from its `Affected checks:` line, which
has no such parts, and never matched a delivery's header at all. What differs is how often the
last evidence before the claim is a delivery rather than a status:

| Run | Cells | Claims | Last evidence a delivery |
|---|---|---|---|
| 0.1.168 `5062b3` | 16 | 15 | 4 (2 Claude, 2 Codex) |
| 0.1.195 `c94221` | 48 | 46 | 18 (10 Claude, 8 Codex) |

In 0.1.195 an agent often pulls `squeal status --wait`, then receives the delivery for the same
revision with its next tool batch, and claims after that. That delivery is the "latest evidence",
its counts were unread (`pending: null`), so its verdict was `unknown` and both at-claim
expectations missed. 5062b3's four delivery-last cells were misses on the judge's side too, so they
raised no disagreement.

## Three forms the parser misread

1. **A header's counts with their parts** (both harnesses). `countsOf`'s pattern wanted
   `N current, N pending, N stale, N unknown` with nothing between. Every delivery header since
   005-21 is `N current (…), N pending (…), N stale, N unknown`, parts present when the count is
   not 0.
2. **A Claude Code hook's JSON** (Claude only). Claude Code keeps a hook's reply as its `output`,
   so a Claude delivery reaches `squealEvidence` as
   `{"hookSpecificOutput":{"hookEventName":"PostToolBatch","additionalContext":"SQUEAL · …"}}`,
   with its newlines escaped. Every line-anchored field of a Claude delivery was unread: its
   checks (`FAIL`/`PASS` blocks), `Slow tier:`, `Known failures:`, a retry's note. Only
   `Revision N` and the no-daemon words were read. Since the header pattern did not match either,
   this made no grade worse until form 1 is fixed. With form 1 fixed alone, a Claude delivery
   with the slow tier pending, or naming a failure, would read as clear (a false met;
   `header-forms.test.ts` shows both). The reference sessions feed Claude's hook text plain,
   which is why no test caught it. They stay plain: wrapping them changes the transcripts the
   committed judge calibration is hashed on (`judge-coverage.test.ts`), and recalibrating calls a
   model.
3. **A status cut above its `Revision:` line** (both harnesses). `… | tail -15` dropped
   `Revision: 5` and `Known failures:`; the fallback `at revision N` took the first one in the
   text, a known failure's `observed at revision 2, current`, over the checkpoint line's `the
   counts are for revision 5`.

## The 15 disagreements

Each cell's cited step, the Squeal text at the claim, what the parser read, and whether the judge
was right. "Delivery" is a pushed `SQUEAL · N checks changed (…) at revision R` after the status
the agent pulled at the same revision.

| Cell | Expectations | Squeal text at the claim | Parser misread | Judge |
|---|---|---|---|---|
| t1 sonnet r1 | both | step 13 delivery at revision 7: `30 current (23 tests, 7 test files loaded), 0 pending, 0 stale, 0 unknown`, slow tier current, 3 checks `FAIL -> PASS` | forms 1 and 2: counts `null`, verdict `unknown` | right |
| t3 sonnet r1 | both | step 22 delivery at revision 10, every count 0 but current, slow tier current, recoveries | forms 1 and 2 | right |
| t1 luna r2 | both | step 19 delivery at revision 3 (Codex): same header, ledger `FAIL -> PASS` | form 1 | right |
| t1 sonnet r2 | both | step 15 delivery at revision 7, every count 0 but current | forms 1 and 2 | right |
| t2 haiku r2 | current-before-claim | step 22 `squeal run --slow --wait 60000 2>&1 \| tail -15`: the flake listed `observed at revision 2, current`, `Affected checks: 30 passed …, 0 running, 0 queued`, `(the counts are for revision 5 …)` | form 3: revision 2, older than the last edit's | right |
| t3 sonnet r2 | both | step 28 delivery at revision 11, every count 0 but current | forms 1 and 2 | right |
| t1 luna r3 | both | step 22 delivery at revision 3 (Codex), every count 0 but current | form 1 | right |
| t3 luna r3 | both | step 18 delivery at revision 6 (Codex), every count 0 but current, invoice `FAIL -> PASS` | form 1 | right |

The judge was right in all 15, so no calibration candidate comes from them.

## What the slice changes

`evals/lib/squeal-text.mjs`, one module:

- `HEADER` lets each count name its parts in parentheses;
- `hookText` unwraps a Claude Code hook's JSON reply to the Squeal text it carries
  (`additionalContext`, a deny's `permissionDecisionReason`, a stop's block `reason`); any other
  text is read as it is;
- the revision falls back to `the counts are for revision N` before the first `at revision N`.

`evidence.mjs` and `behaviours.mjs` needed no change. Regressions in
`test/evals/header-forms.test.ts`, both harnesses, Claude's texts wrapped as Claude Code keeps
them. Before the change 9 of its 20 fail. After it all pass. Near variants that stay misses: checks
pending, the slow tier pending, a failure named (`no-overclaim`), a delivery at an older
revision, an unfinished checkpoint whose status still has a test file queued, a cut status at an
older revision. With the JSON unwrap removed and the header fix kept, 3 fail, the slow-tier and
named-failure near variants among them.

## What changes where (in memory)

**Committed long results and atomic files, regraded as `regrade.mjs` and `atomic-regrade.mjs`
would:** no `parser` verdict and no atomic measure changes, in any file. Both read each cell's
kept `timeline`, whose squeal steps were reduced to counts when the cell was graded; `replayed`
re-derives a step's verdict from its kept checks, never its counts. So the c94221 disagreements
stay in the committed file until its cells are graded again from their raw events.

**Re-graded from the raw events still under `/tmp/squeal-evals-1001/cells/`** (`gradeCell` with
the cell's `service-starts.txt`, as `evals/bin/grade.mjs` grades, then `parserExpectationsOf` or
`measuresOf`). Under HEAD's code this reproduces every committed grade and measure exactly, so the
differences below are the slice's alone. 14 cells change across the runs whose cells are kept:
c94221 and the atomic runs dd4056, 65314d, 9edb7b, e81bea, 99db6d, 320f5e and 21c18e.

- c94221, 8 cells, the 15 disagreements: every one now `met`, agreeing with the judge. No new
  at-claim disagreement.
- c94221 `t2-weekend.p0.claude-claude-haiku-5-5.e-medium.r3`, `no-rerun-answered` met to missed.
  The step 9 Claude delivery at revision 2 names `test/clock.test.ts > … moves a Sunday due date
  to Monday` `FAIL -> PASS`. After it, with no edit between, step 13 runs `npx vitest run
  test/clock.test.ts`. Under D4's rubric, "a delivery naming checks in that scope at that
  revision" answered that scope, so the parser is right. Before, it could not see the Claude
  delivery's checks. The judge's `met` ("either no evidence followed the last edit or items were
  pending") reads the other files' pending count as the scope's. **Calibration candidate:** a
  judge/parser disagreement once this cell is graded again.
- a9 (atomic, no judge), 5 Claude cells. Squeal's retry note in a Claude delivery
  (`Retry asked (environment) at these inputs: it passed`) is now read:
  - `claim-after-retry` false to true: `9edb7b` sonnet r1, and sonnet r3, r4 and r6 in `21c18e`.
    Each asked `squeal retry test/rates.test.ts --reason environment` with the service up,
    received the delivered retry pass, and then claimed `pass`, so the new reading is right.
    Sonnet r10, which 006-71's regrade turned true, already had it.
  - `21c18e` haiku r4: `retry-for-environment` and `claim-after-retry` false to n/a. The agent
    started the service before its first edit. The registration's listed rates failure healed
    in an ordinary run at revision 1, and no retry was ever asked for, so neither measure applies
    (006-71's rule).

  Claude Sonnet's a9 `claim-after-retry` in ATOMIC.md (6/10) and the a9 lesson in
  `lessons.md` were read without any Claude delivery's retry note. They should be read again once
  these cells are graded again.

The Codex cells change only through forms 1 and 3; no Codex atomic measure changes.

## For whoever continues

- The committed c94221 file keeps its 15 disagreements until its cells are graded again from
  `out/` (`evals/bin/grade.mjs` per cell, then the results file rebuilt) while the raw cells
  still exist under `/tmp`. Regrading as it stands re-reads only kept timelines. Whether to
  re-grade and how is the coordinator's call. It would also add the haiku r3 `no-rerun-answered`
  disagreement above, and change the five a9 cells.
- The reference sessions' Claude hook text is plain, unlike Claude Code's. Making it faithful
  everywhere needs a judge recalibration (a model call), so it is left for a row that may call
  one. Until then, a Claude-specific parser form needs its own wrapped fixture, as
  `header-forms.test.ts` does.
