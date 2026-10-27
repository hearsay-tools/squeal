# 017-10.R1: notes

Repair of review `../../reviews/0.1.360.md` B2. `squeal lint --changed`
printed a session's old change as if it were the file's state now.

## What was wrong

`lintChanged` gives each file's last transition (`kind`, `added`,
`removed`, `revision`) and its state now (`outcome`, `stale`,
`findings`). `changedLine` printed the change with 017-09's
`lintEntryLine`, and `nowWords` added words only for pending, unknown
and no state. Three cases printed a wrong result:

1. **Case A (review).** A PASS change, then a config change that makes
   the file fail with no transition (D2): `PASS lint: src/a.js: no
   findings; at revision 2` and nothing else.
2. **Case B (review).** A PASS change whose result is stale now: the
   same bare PASS. `lintEntryLine` ignores `stale` for `fail-to-pass`.
3. **Found here.** A FAIL change, then a config change that judges the
   file again with the same outcome and count but another rule: `FAIL
   lint: src/a.js: 1 finding, +1 no-console (Unexpected console
   statement.); at revision 2`. The file's one finding now is
   `no-unused-vars`. Outcome and count agree, so no field of the entry
   could show it. The parent approved an additive field for it
   (2026-10-27, request 0e6a8a63).

The same gap also made a FAIL change that a config change made pass
print `FAIL lint: ...: 0 findings, +1 ...`, and a RESOLVED change whose
file is linted again print no state now.

## The repair

- `LintChangedEntry.judgedAt` (additive, commit 06c2d5226): the revision
  of the file's judged result now, `now?.judged?.revision ?? null`, set
  in `surface/report.ts`. `--changed --json` gains this one field.
- `src/cli/lint-report.ts`: the result now is the change's own when
  `judgedAt` equals the change's `revision` (and the change is not
  `removed`). Then the line is as before; a stale PASS adds `now stale
  (...)`. Else the change is history:
  - its count is its own: `added.length` for `pass-to-fail` and
    `first-seen-fail` (every finding is added); `findings not stored`
    for `fail-changed`, whose total the transition does not hold;
  - its stale flag is not passed to `lintEntryLine`;
  - the state now follows, with the revision of its result.

| State now | Words after `; at revision N` |
|---|---|
| The change's own result, current | none |
| The change's own PASS, stale | `; now stale (an input changed since it was linted; linting resumes when the agent is idle)` |
| The change's own FAIL, stale | none: the FAIL line already says it (unchanged) |
| Another result, pass or fail | `; now fail: 1 finding, linted at revision 3`, stale adds ` (an input changed ...)` |
| Pending, from the disk check | `; now pending: changed on disk since its lint`, with ` at revision R` when the result is not the change's |
| Pending in the store | `; now pending: changed since, not linted yet`, or `changed since revision R, not linted yet` |
| Unknown | `; now unknown: <reason>` (unchanged) |
| No state | `; now not linted` (unchanged) |

Pending and unknown disk provenance are unchanged when the result is the
change's own (`disk.test.ts` passes unchanged). The shared formatter
(`surface/format.ts`) and 015 formatting are not changed.

## Decisions the spec did not settle

1. **Which result is the change's own.** `judgedAt === revision`. A pass
   judges a file and records its transition at the same revision; a
   config keying or an idle re-lint judges it at a later one with no
   transition. A re-lint with the same fingerprint also reads as
   another result; its words are still true (`now fail: 1 finding,
   linted at revision 3`).
2. **Word forms.** `now <outcome>: <count>, linted at revision R`, as the
   existing `now pending:` and `now unknown:`. `now stale (...)` for the
   change's own stale PASS, with `LINT_STALE` as the details view and
   FAIL lines use it.
3. **A changed failure's count as history.** `findings not stored`
   (017-09's own words for a missing count): the transition keeps the
   findings added and removed, not the total.
4. **Spec text.** D8 does not word `--changed` lines. The coordinator may
   record this table in the spec or status.

## Tests

| Done-when | Test |
|---|---|
| `judgedAt` is the change's revision, then the config keying's | `test/lint/cli/changed-state.test.ts`, first `describe` |
| Case A, with an unchanged-current control, through `squeal lint`, text and JSON | `changed-state.test.ts` "case A" |
| Case B, stale PASS, `idleIn: () => 60_000` | `changed-state.test.ts` "case B" |
| Same outcome, same count, another rule; a FAIL the config made pass; a genuine edit after the keying is the change's own again | `changed-state.test.ts` "a FAIL change the config judged again ..." |
| An edit between the store read and the disk read | `changed-state.test.ts` "reads an edit between ..." |
| Each words branch, formatter only | `test/lint/cli/report.test.ts` "tells a change whose result is no longer the file's ..." |
| Real ESLint 9 and 10, core rules: case A and the same-count rule case, each with a control; stored findings equal a fresh `eslint -f json` | `test/lint/cli/changed-eslint.test.ts` |
| The four committed CLI bundles print what the source prints, text and JSON | `test/lint/cli/bundled.test.ts` |

`test/lint/wiring/rig.ts`: `wiredRig` takes `idleIn`, and `lintOver`
takes the pass's other options (additive; existing callers unchanged).

Each new test was red before the repair: the fake-provider tests at
Squeal revision 7 (4 failures, each the bare old line), and the real
ESLint tests on Node 22.19 with the previous `lint-report.ts` (4 of 4
failed, both majors).

## For the parent: the bundles

`bundled.test.ts` fails in this tree by design: the committed bundles
are not rebuilt here, and each prints the bare PASS for both cases (8 of
8 failed at Squeal revision 19). After the integration build:

```sh
pnpm run build
PATH=/home/agent/.nvm/versions/node/v22.19.0/bin:$PATH \
pnpm exec vitest run \
  test/lint/cli/bundled.test.ts test/lint/cli/changed-eslint.test.ts \
  test/lint/cli/changed-state.test.ts test/lint/cli/report.test.ts \
  test/lint/cli/disk.test.ts test/lint/cli/lint-command.test.ts \
  --maxWorkers=2
```

and the same `vitest run` on Node 24. A CLI built from this branch with
`bundleOptions` into a scratch folder outside the tree passed the bundle
test on Node 22.19: `Tests 2 passed (2)`. The scratch copy was removed;
no file in `plugins/` changed.

## Checks run (2026-10-27, at 37bc4da5b)

- `pnpm run lint`: "Checked 2413 files in 1267ms. No fixes applied."
- `pnpm run typecheck`: `tsc --noEmit`, exit 0, no diagnostics.
- Node 22.19, `pnpm exec vitest run test/lint/cli/changed-eslint.test.ts
  --maxWorkers=1`: "Tests 4 passed (4)" (ESLint 9 and 10). With the
  previous `lint-report.ts` put back for the run: 4 of 4 failed, each
  the bare old line; the fixed file was restored at once.
- Node 22.19, `pnpm exec vitest run test/lint/cli
  test/lint/surface/report.test.ts test/lint/wiring --maxWorkers=2`,
  before `bundled.test.ts` existed: "Test Files 11 passed (11)", "Tests
  49 passed (49)".
- Squeal, the 13 focused files (`test/lint/cli` but `bundled.test.ts`,
  `test/lint/surface/report.test.ts`, `source.test.ts`, the five
  `test/lint/wiring` tests, `test/evals/lint-lines.test.ts`): "Named
  test files at revision 24: no known failures; 13 test files, each with
  a current result".
- Squeal, the changed sources (`lint-report.ts`, `surface/report.ts`,
  `types/lint-delivery.ts`, `wiring/rig.ts`). At revision 24, before the
  closures were recorded, the selection was broad (769 test files read
  `report.ts`): 678 passed, 1 failed (`bundled.test.ts`), 92 still
  queued behind daemon and scheduler tiers under the host's load. At
  revision 25, by the recorded closures, it is 12 test files: 11 pass,
  1 fails (`bundled.test.ts`).
- Expected failures in this tree, both from bundles not rebuilt here:
  `bundled.test.ts` (8 tests) and the four drift checks
  (`test/harness/plugin.test.ts`, `codex/plugin.test.ts`,
  `opencode/package.test.ts`, `pi/package.test.ts`: "cli/squeal.mjs
  differs from the build").
- Not run: a build in this tree, the full suite, evals (worker rules).
