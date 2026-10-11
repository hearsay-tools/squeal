PASS 8153e236

Zero blockers. B1 is closed. S1's two original boundary failures are repaired, but S1 is not fully closed: one proven nonblocking residual loses runner summary lines when the output is classified as Squeal text. No reference transcript or committed result changed. S1 retains the prior review's should-fix severity; these offline controls demonstrate evidence loss, not an incorrect fixture grade.

## Verification

Scope: 006-27, `tasks/wave-3.5.md`, `reviews/wave-3.md` B1/S1, D9, range `8153e236^..8153e236`. Only the brief's three questions were examined.

The writing worktree started clean at `19e77171cf4f63314df56e40b4434873791d23c4`, later than the candidate. This is a provenance mismatch, not candidate execution evidence. All checks used a clean `git archive 8153e236` in a separate scratch repository. Before/after probes also loaded an archive of `8153e236^`. Candidate product files were not edited. Probe scripts were outside both archives. Candidate `git status --short` remained empty after the checks. No judge call, subject session, baseline execution/import, or `npm run build` ran. Build verification is unverified and omitted under the bounded brief. The independent Vitest run is the reviewer gate; Squeal was not substituted.

```text
npm ci
added 56 packages, and audited 57 packages in 1s
found 0 vulnerabilities
(exit 0; two install-script approval warnings)

npm run lint
Checked 873 files in 296ms. No fixes applied.
(exit 0)

npm run typecheck
> tsc --noEmit
(exit 0)

npx vitest run --maxWorkers=2
Interrupted by the Cezar restart; no final counts or exit status available.
Partial output:
  test/harness/starting-daemon.test.ts: 10 tests, 1 failed
  test/e2e/lifecycle.test.ts: 6 tests, 3 failed
(full-suite completion unverified)

npx vitest run test/evals --maxWorkers=2
Test Files  37 passed (37)
     Tests  625 passed (625)
  Duration  14.48s
(exit 0)
```

The full run reported a heartbeat-readiness failure in `test/harness/starting-daemon.test.ts` and three lifecycle failures (replacement-daemon delivery and invalid-config startup in both harnesses). These files are unchanged in the range; attribution to this repair is **unverified**, not a blocking finding. The controller restart terminated the run before final output, so there is no full-suite pass claim. The completed focused independent eval run supplies the bounded review's unit-test evidence.

## B1: closed, proven

The bounded reproduction uses `ensureCalibrated` through the real `claudeRunner`, with a deeply nested root asserted absent before the call. `command: process.execPath` and a Node prefix printing a version replace Claude Code; `parent: {}` prevents credential inheritance. The results directory contains the candidate's committed calibration records. The calibrator is an offline callback that records model names and makes no call.

```text
Before, known 2.1.296: ENOENT at mkdtemp; calibrator calls []
Before, unknown 9.9.9: ENOENT at mkdtemp; calibrator calls []
Candidate, known 2.1.296:
  runner args: [--version]
  found: claude-haiku-5-5, medium, 2.1.296, ecc9d69f64f1
  calibrator calls: []
Candidate, unknown 9.9.9:
  runner args: four [--version] calls
  calibrator calls: [claude-haiku-5-5, claude-sonnet-5-5]
  found: null (the callbacks intentionally write no passing record)
Both candidate roots: no remaining per-call scratch directories
```

`evals/lib/judge.mjs:190` creates the base recursively before `mkdtempSync`. Both paths reach identity discovery; the unknown path reaches calibration and fallback. The pre-fix controls fail before either step, isolating the repair.

## S1: original probes repaired; one proven should-fix remains

The original boundaries, rerun directly through `trimOutput`:

| Probe | Before | Candidate |
| --- | --- | --- |
| Exactly 8099 characters: revision/count header, incidental padding, trailing slow-tier evidence | 8026 retained; slow-tier line lost | 497 retained; slow-tier line whole; incidental cut marked |
| Exactly 475 characters: `Test Files` summary ending in `1 passed (1)` | 412 retained; summary ending lost | All 475 retained |

Additional bounded controls keep central Squeal revision/count/check/checkpoint/tier lines, including a check identity over 400 characters, whole in an output over 8000 characters. Incidental line omissions carry `[… N lines trimmed]`; an incidental long line carries `[… trimmed]`. Pushed Squeal messages still bypass trimming.

### S1 residual: Squeal classification excludes runner summaries

**Proven, nonblocking.** Locations: `evals/lib/judge.mjs:49`, `:54`, `:84`. D9 requires "runner summary lines whole"; the brief permits cuts only to incidental lines.

`transcriptOf` classifies an entire command output as Squeal text whenever its command or output mentions `squeal`. Above 8000 characters, `trimOutput` selects `SQUEAL_EVIDENCE` instead of `SUMMARY`. A genuine runner summary therefore can be dropped entirely, or capped at 400 characters if it falls in the head/tail. This is also reachable without a chained command: Vitest's normal RUN header can name `/tmp/squeal-evals/cell/work`.

Reproduction, using only a synthetic output and a library call:

```js
const filler = Array.from({ length: 200 }, (_, i) =>
  `incidental ${i} ${"x".repeat(60)}`);
const summary = " Test Files  1 passed (1) " +
  "·".repeat(436) + " 1 passed (1)"; // exactly 475 characters
const out = [
  " RUN  v5.0.3 /tmp/squeal-evals/cell/work",
  ...filler.slice(0, 10), summary, ...filler.slice(10),
].join("\n");
const timeline = { items: [
  { kind: "cmd", cmd: "npx vitest run", out, exit: 0 },
], final: "" };
transcriptOf(timeline)[0].includes(summary);
```

```text
output length: 15606; summary starts at character 781
Before: true
Candidate: false (a line-count cut marker replaces it)
```

A 15653-character mixed Vitest/Squeal output for `npx vitest run && squeal status` loses the same summary. Every omission is marked, but this line is evidence, not incidental output. This nearest S1 variant is a regression from retaining an early summary in the old 8000-character prefix. No judge was called to infer a resulting grade.

Worker-sized repair: preserve both summary and Squeal evidence matches in the whole-output branch. Add an offline `transcriptOf` control with a Vitest RUN path containing `squeal`, a central long summary, and output above 8000 characters. No rubric or model change is required.

## Reference transcripts and committed results: unchanged, proven

Generated `calibrationReferences(JUDGED, declarations())` separately from the before and candidate archives, then compared all 58 ordered `[name, cell.transcript]` records byte for byte. Zero changed. Their SHA-256 prefix is `ca86109f6bc75314` for that serialization. The rubric revision is `ecc9d69f64f1` on both sides.

```text
git diff --exit-code 8153e236^ 8153e236 -- evals/results \
  test/evals/judge-references.ts test/evals/reference-sessions.ts \
  evals/lib/rubric.mjs evals/tasks
(no output; exit 0)
```

The only changed files are `evals/lib/judge.mjs` and the added `test/evals/judge-review3.test.ts`. All committed results, both calibration records, and `TREND.md` are byte-identical. This change does not void the committed passing calibration on its reference set.

## Blockers and nits

None.

## What fits and next-wave input

B1, both original S1 boundaries, and calibration/result invariance are settled by offline evidence. The S1 residual above is the only further repair input; this review reopens no judge verdict, rubric decision or shell-parser finding.
