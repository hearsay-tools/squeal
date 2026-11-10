# Issue 171: repeated failure blocks after an expected-failure commit

Researcher findings, 2026-11-10. Source examined: Squeal 0.1.426 (`package.json`
at `6bb387fec`, the version the issue reports). Issue:
<https://github.com/hearsay-tools/squeal/issues/171>.

Host load: 13.58 / 24 CPUs (one-minute) at 16:09Z, 17.38 before the probe,
28.85 at 16:12Z. The last reading is above the CPU count, so the live
daemon-and-hook reproduction was skipped, as the brief requires. Only the
in-process store probe ran (3.2 s, one Vitest worker).

## Verdict

The hidden tail of a capped block is not delivered again, and a drained view is
quiet. Each later block in the issue was most likely news: checks whose runs
ended after the previous tool call. Identical redelivery was not reproduced.
The cost is real. Squeal has no way to say "these failures are expected at this
revision", and each result batch at one revision opens a new full block. Both
are product decisions for the human, not defects against spec 011 as written.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Are the repeated blocks distinct pages of one backlog? | No. A delivery writes every entry to the view, the hidden ones too. The cut is a 10,000-character text budget, not 15 entries. | verified by experiment; read in source code |
| 2 | Are they identical redelivery? | Not in the store path. Probe A: 6 more boundaries after a 60-entry delivery all return nothing. One redelivery path exists by design (Q5) but is unproven for this issue. | verified by experiment |
| 3 | What produces several blocks at one revision? | Results that land in several batches at the same revision. Probe B: 6 batches of 10 give 6 blocks of 10, 0 repeats. | verified by experiment |
| 4 | Is delivery quiet after drain? | Yes, in probes A and B. A rerun with the same failure and another temp directory name is also quiet (probe C). | verified by experiment |
| 5 | Can a hook deliver the same report twice? | Yes, by design: a hook killed or past its deadline before its stdout write rolls back, and the report stays owed (C8, amended 2026-10-31, row 011-288). Not shown to happen here. | read in official docs (spec 011 C8) |
| 6 | Is there an existing "expected failure" acknowledgement? | No. `src/cli/` at 0.1.426 has no accept command. `squeal hold` pauses test runs; it does not mark failures. Being told once is the only acknowledgement. | read in source code |
| 7 | Live reproduction with a daemon and the real hook? | Not determined, because the one-minute load (28.85) exceeded the 24 CPUs. | not determined |

## Findings

**Q1, the cut.** `formatDelta` (`src/core/delivery/format.ts:296`) adds
failure blocks while they fit in `MESSAGE_CAP_CHARS = 10_000` (line 63), with
`OVERFLOW_RESERVE = 400` (line 66). The rest becomes one `Not shown: N more
changed checks` line (`assemble`, lines 266–286; `overflow`, line 336). The
entry count shown depends on the length of each failure's text. In probe A, with
short messages, 43 of 60 were shown. The issue's longer blocks, with error and
"seen by" lines, showed about 15–19. `createDelivery`
(`src/core/delivery/delivery.ts:180–200`) plans the delta over the whole view and
writes the whole plan. Spec 011 C5: "At delivery time the daemon or hook computes
the delta …, writes the result into the view, and returns the delta." The
format cut does not change what is written.

**Q2–Q3, probe results** (`probes/issue-171/output.txt`):

```text
A: entries=60 FAIL lines shown=43 chars=9666
A boundary 2..7 (no change): (null: nothing delivered)
B boundary 1..6: entries=10 repeats=0
B after drain: null (quiet)
C rerun same failure, other tmp name: null (quiet)
C rerun changed text: 60 entries: fail-changed
```

The issue's numbers fit probe B, not probe A. The first block named 35 changed
checks, and about 60 entries came over 6 batches. A file-by-file run of a
monorepo after one commit ends files over minutes. Each tool boundary delivers
the files that ended since the previous one. This is inferred: the issue gives
no names to compare across blocks. A transcript with the check names of each
block would decide it.

**Q4, a changed first error line reads as news.** Probe C's second rerun
changed each failure's first error line, and 60 `fail-changed` entries came
again. The fingerprint normalisation (C5) removes a temp root and the one
directory below it, so `/tmp/cez-vitest-tmp-<random>/config.json` is stable
(verified by probe C's first rerun). A message with other run-varying text
would come back as `fail-changed` on each rerun. It is not shown that this
happened in the issue.

**Q5, redelivery by design.** C8 (row 011-288) keeps the store transaction open
until the hook's stdout write succeeds. A hook killed before that rolls back,
and the next boundary delivers the report again. The spec says "a report handed
over just before a kill may arrive twice." Under high host load a hook can pass
its deadline. This path would give an identical block. It needs a live
reproduction with hook timing to prove or exclude.

**Q6, acknowledgement.** The CLI files at 0.1.426 (`src/cli/*.ts`) have `hold`,
`stop`, `retry`, `status`, `failures` and others, and no accept or expect
command. `src/cli/hold.ts` (row 011-74) holds every test run while a command
runs. The reporter's workaround, `squeal stop --until-start`, stops validation
for the whole worktree.

## Recommendation for Squeal

1. Do not treat this as a redelivery bug without a transcript. Ask the reporter
   for the check names in two consecutive blocks. Same names with the same text
   would point at Q5 (a hook rollback). New names confirm Q3.
2. Two product decisions for the human, both about the issue's suggested fixes:
   - (a) An explicit acknowledgement, such as "accept the known failures at
     revision N". A user-visible effect: later blocks name only failures after
     it. It touches C5's view and the status counts.
   - (b) Collapse at one revision: after the first full block at a revision,
     later result batches at the same revision with no worktree change give
     one count line and the `squeal failures` pointer. This changes C5's
     "delivered once" wording for streamed batches and the regression deny
     (C8), which reads entries.
3. Before deciding (b), count from real sessions how often a revision's results
   come in more than one block. This probe does not measure it.

## Open questions

- Q7: the live daemon-and-hook reproduction, at a host load below the CPU count.
- Whether any hook in the reporter's session passed its deadline (Q5). The
  daemon log of that worktree would show it, if it still exists.
- Whether the issue's failure messages contain run-varying text that the
  fingerprint keeps (Q4).

## Sources

- Issue 171, read with `gh issue view 171 -R hearsay-tools/squeal`.
- `docs/specifications/011-core/spec.md` C5 (lines 162–201), C8 (258–274),
  C9 (275–313), at `6bb387fec`.
- `src/core/delivery/format.ts` (lines 63, 66, 266–286, 296–336),
  `src/core/delivery/delivery.ts` (180–200), `src/core/delivery/delta.ts`
  (`planDelta`, line 154), `src/cli/hold.ts`, file list of `src/cli/`.
- Probe: `probes/issue-171/pages.probe.ts`, run with
  `node_modules/.bin/vitest run --config docs/specifications/011-core/research/probes/issue-171/vitest.config.ts --silent=false --disableConsoleIntercept`.
  It uses `freshStore`, `createStateSink` and `createDelivery` from the test
  helpers. No daemon, no hook process, no HOME access. The probe's header says
  "revision 0" because it writes no revision record; the counts are not
  affected.
