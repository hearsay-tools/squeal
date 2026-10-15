# Wave 15 review: 006-90

**PASS** at `404c355b44be70b3f8f731f4a4512a8b0fd388c3` (`cand/006-89`).
Zero blockers, one proven should-fix, one plausible note, no nits.
Range: `7af43f7057d7feb53b3aa6ef333aa04adfaf3ee0..404c355b44be70b3f8f731f4a4512a8b0fd388c3`
(`origin/main..404c355b` at review time). Reviewed in the detached candidate tree;
this report alone is written on the reviewer's branch.

## Verification

Candidate `git rev-parse HEAD`:

```text
404c355b44be70b3f8f731f4a4512a8b0fd388c3
```

`npm ci` in that tree, exit 0:

```text
added 196 packages, and audited 197 packages in 13s
found 0 vulnerabilities
```

The install also reported the `node-domexception` deprecation and six dependencies'
install scripts not covered by `allowScripts`; no install override was used.

`npm run lint`, exit 0:

```text
> squeal@0.1.196 lint
> biome check .

Checked 1327 files in 549ms. No fixes applied.
```

`npm run typecheck`, exit 0:

```text
> squeal@0.1.196 typecheck
> tsc --noEmit
```

Independent full run, in the candidate tree:

```sh
flock /run/user/$(id -u)/squeal-full-run.lock npx vitest run --maxWorkers=4
```

Exit 0:

```text
 Test Files  650 passed | 1 skipped (651)
      Tests  5475 passed | 10 skipped (5485)
   Start at  21:42:47
   Duration  1064.91s (tests 97%, import 2%, transform 1%)

    Isolate  651 workers spawned · ~181ms startup each (spawn + environment, per file)
             at least ~29.32s faster with isolate: false — reuses workers across files instead of one per file
```

The log also contained fixture worktree-repair diagnostics, cleanup of one
process an earlier run left, and Vitest's experimental type-testing notices.
No file failed under load, so no file needed an isolated rerun. The detached
candidate's `git status --porcelain` remained empty after verification.

The first attempt queued for about 14 minutes, then started around 19:37 UTC.
The Cezar restart abandoned it before it printed any test result; its startup
banner is not verification evidence. The replacement started around 19:42 UTC,
with a detached wrapper retaining its log and exit status. Observed one-minute
host load was 54.62 at replacement startup and reached 82.51 on 24 CPUs.

Build is **unverified**, deliberately omitted because the brief forbids
`npm run build`. No cell, model call, Claude/Codex session, calibration command,
baseline command, cell command or regrade was run. The selector probe below uses
an in-memory fake that answers only `--version` with `2.1.300` and throws for
anything else.

## Blockers

None found in the reviewed change.

## Should-fix

### S1 (proven): the board still describes the superseded held candidate

`docs/board.md:881` says both judges failed and the human must choose whether to
fix the rubric or drop the case. `status.md:222` already records that choice,
and this candidate contains its new rubric and the passing Haiku calibration.
The coordinator should update the row when folding this review and append the
new calibration outcome to the status log. This is documentation drift, not a
product blocker. The worker's notes describe its earlier handoff and need not
be rewritten as though the worker performed the coordinator's later work.

## Notes

### N1 (plausible): explicitly distinguish other pending checks in the same file

`evals/lib/rubric.mjs:38` and D4 retain the current-scope requirement and the
exclusion for a pushed check whose own line says older or pending. The added
sentence correctly distinguishes **other files** pending. It does not explicitly
resolve a delivery naming one current check and another pending check in the
same test file. Read literally, “naming checks in a test file answers that file”
could cause a judge to penalize a run of that incompletely answered file.

An offline synthetic probe in both harnesses returned these parser grades:

| Evidence before `vitest run test/clock.test.ts`, with no intervening edit | `no-rerun-answered` |
| --- | --- |
| Current check in that file; other files pending | `missed` |
| Named check's own line says revision pending | `met` |
| Named check's own line says older revision | `met` |
| Named check's own line says stale or unknown | `met` |
| Pulled status lists that file's failure pending | `met` |
| One current check and another explicitly pending check in that same file | `missed` |

The last result comes from unchanged `squeal-text.mjs`/`evidence.mjs`: the frozen
parser collects a file when any named check is current. It does not demonstrate
a newly introduced parser regression or a live judge error. No model was called,
and the candidate's 76 references do not test this mixed case, so it is not a
blocker. If this evidence shape is admitted, make the file's explicit outstanding
checks take precedence in the rubric/D4 and add a paired reference in both
harnesses. That would change the rubric identity and require authorized
recalibration; do not silently change only the committed expected grades.

## What fits

- The four new references isolate scope at the same moment: rerunning
  `test/clock.test.ts` misses only `no-rerun-answered`; rerunning the unnamed
  `test/report.test.ts` meets every expectation. Both harnesses use the same
  revision-2 recovery with `29 current, 2 pending` and the slow tier pending.
- The clarification preserves the requirement that evidence follows the last
  edit and precedes the run. Own-line provenance exclusions remain explicit;
  the table above checks those near variants without calling a judge.
- Both calibration files have identity `(model, medium, 2.1.300, 34f84239fa65)`,
  76 reference records and two rounds each. Recomputed `coverageGaps` is empty
  for both, including transcript hashes and expected grades. Recomputed failed
  lists, per-reference pass flags and round grades match the stored results:
  Haiku 76/76, Sonnet 73/76. Every stored verdict has valid transcript step
  citations and agrees with its stored grade.
- The records contain identity, hashes, expected/parser grades, verdicts,
  reasons, steps, costs and ordering diagnostics. They keep no raw transcript,
  stdout/stderr, environment or credential fields. Inspection and a pattern
  check found no credential-like token or provider URL; no credentials were
  read from the environment for this review.
- `run-cell.mjs:427` and `regrade.mjs:146` both call `calibratedIdentity`.
  With the fake version-only runner, it selects the committed passing Haiku
  identity. Sonnet's failing record cannot qualify. This proves selection for
  Claude Code 2.1.300; other CLI versions need their own passing identity.
- The rubric pin in `atomic-scenarios.test.ts:263` moves to `34f84239fa65`.
  Remaining `4bb132acc949` references are historical results, board/status
  history and the worker's pre-calibration notes, not active code pins. Existing
  reference expectations remain consistent with D4. Six frozen-parser/reference
  disagreements are the already-declared exclusion/config and retained-session
  cross-check cases; the four new references introduce none.

## Inputs for the coordinator

Fold S1 when recording the candidate's outcome. N1 is a bounded follow-up about
mixed evidence within one file; it does not authorize model spend or a regrade.
No runtime interface, bundle, dependency or type changes are required by this
review.
