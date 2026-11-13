# Row 020-49 notes: the gate says why it reran a file a usable part held (#205)

Worker acd0aae8, 2026-11-13. Shape: slice. Base: main at f15692098 (0.1.464).

## What changed

When `squeal code --base --parts` does not take a selected file that a part holds, the JSON report now says why, and stderr gives one bounded line per reason. Certification, provenance, verdicts and exit codes do not change: a refused file runs, or the stores give it, as before.

Example, the issue's shape (an input of `test/refused.test.ts` differs from what its part read):

```json
"from": { "test/accepted.test.ts": "parts", "test/refused.test.ts": "run" },
"refused": {
  "test/refused.test.ts": {
    "part": "/ci/parts/squeal-part-1-of-1.json",
    "reason": "input",
    "input": "test/refused.test.ts",
    "detail": "its part read other content"
  }
}
```

```text
squeal code: Vitest: 1 test file not taken from the parts, 1 ran here: its part does not certify an input as it is here (test/refused.test.ts: test/refused.test.ts)
```

(Repair R1 changed "run here" to "ran here" and added the "did not run" and "started here and did not finish" counts; see the last section.)

## Commits

1. `2d9afade4` feat(020-49): partsEvidence names why it refused each file a part holds. `parts.ts`, `parts-refused.ts` (new), `inputs.ts`; tests `parts-refused.test.ts` (new), `parts.test.ts`, `parts-kit.ts` (new), `inputs.test.ts`.
2. `8c080d103` feat(020-49): the report gives `runs[].refused`. `types.ts`, `report.ts`, `runs.ts`; test `report-refused.test.ts` (new). This is the report-fields commit the brief asks for.
3. `8a522fc1e` feat(020-49): `code-gate-stored.ts` passes the parts' refusals to the report (by agreement, request 42abfd07). The refusal sink and `Evidence.refused` only, 5 lines.
4. `ba1785c37` feat(020-49): stderr gives one bounded line per refusal reason. `parts-refused.ts` (`refusedText`), `code-gate.ts` (`afterVerdict`); tests `report-refused.test.ts`, `test/cli/code-gate-parts-cases.test.ts`.
5. `bd57ba8b3` This notes file.
6. `dabadaf5e` test(020-49): parts-versus-run comparisons leave out `refused`; the environment cases assert the reason. `test/cli/code-gate-parts-kit.ts`, `test/cli/code-gate-parts-environment.test.ts`.

## Proposed spec text (the coordinator amends the spec)

### D7, add to the "Later sections add fields" paragraph

> Added 2026-11-13 (row 020-49, #205): `runs[].refused`, by path, each selected file a part holds that the parts did not give (D13.2): its `part`, the part file as read; its `reason`; `input`, the path that refused it, for `input`, `unread` and `source`; and `detail`, when the reason alone does not say it all. `from` says whether the stores then gave the file or this command ran it. Absent when the parts gave every file they hold, so a report with no refusal is as before. A report whose every file ran here has `refused` and no `from`.

### D13.2, add after "Each test file in the report says where its evidence came from."

> A selected file that a part holds and that the parts do not give has its reason in the report (D7, `runs[].refused`; row 020-49, #205). The reasons, in the order the gate checks them:
> - `duplicate`: more than one part holds it. `part` is the first by name; `detail` names the others.
> - `unusable`: its part gives no evidence (another format, coverage versions or collector, no coverage provider, no read evidence, `coverage.children` on at the base). `detail` is the part's reason.
> - `environment`: its part ran its project in another environment than the gate's runner. `detail` is the difference.
> - `closure`: the runner gives no closure of it here.
> - `input`: the part does not certify an input of its closure or of what it read. `input` is the first such path by name. `detail` says how it differs (`its part read other content`, `its part holds no evidence of it`, `its content here is not known`) and how many more inputs do.
> - `record`: it passed, and the part holds no coverage record of it. `detail` is the part's `noRecord`, when it has one.
> - `unread`: its record could not read a changed path, the first by name.
> - `source`: its record holds other bytes of a source, the first by name.
>
> After the verdict, stderr gives one line per runner and per-file reason (`duplicate`, `closure`, `input`, `record`, `unread`, `source`): how many files it refused, how many of those ran here and how many the stores gave, and up to three of them, each with its `input`; the others are counted. `unusable` and `environment` add no line: the gate tells them once per part as it reads the parts. Nothing about certification changes.

### `commands.md` (three copies: `plugins/{claude-code,codex-runtime,pi}/skills/squeal/references/commands.md`), not owned by this row

At line 124 (after "stderr counts what did not run, …"), add:

> When the parts hold a selected test file and do not give it, stderr says why after the verdict, one line per reason, for example `Vitest: 2 test files not taken from the parts, 2 run here: its part does not certify an input as it is here (test/add.test.ts: test/add.test.ts, test/reads.test.ts: data/input.txt)`. It names at most three files per line and counts the rest.

At line 168, in the `runs` list after the `from` item, add:

> `refused` when the parts held a selected file and did not give it (each such file with its `part`, its `reason`: `duplicate`, `unusable`, `environment`, `closure`, `input`, `record`, `unread` or `source`, the `input` that refused it where one did, and a `detail`),

## Decisions the spec did not settle, and my choice

1. **Field shape.** `runs[].refused` keyed by path, the same as `from`. Each entry: `part`, `reason`, optional `input`, optional `detail`. A store hit after a refusal is told by the existing `from` (`store` versus `run`); I added no third field. Reason: one fact, one place.
2. **`part` is the part file as `readPartsIn` gives it:** an absolute path when `--parts` names a directory. The parts-wide notes already use this name. The report stays the same for the same inputs, because `--parts` is an input.
3. **Part-wide reasons are in the JSON too** (`unusable`, `environment`). The brief says "any other refusal branch `gate/parts.ts` has". These files are not in a usable part, but a reader of the JSON alone then knows why every file ran. They add no stderr summary line, because stderr already tells them once per part.
4. **"The first input that differs"** is the first by path among the uncertified inputs, so the report is the same on each run. `detail` gives how it differs and how many more inputs differ. `inputs.ts` gains `uncertifiedWhy` (the brief allows `inputs.ts` "only to return the reason"); `uncertified` now maps it, with the same result.
5. **`record` detail** is the part's `noRecord` value (`filtered`, `unmapped`, …) when present. It is the recorder's own word for why it made no record.
6. **Stderr placement:** after the report, before the kept-logs line, like the kept-logs line. A summary before the runs would need the stored lookup's composition in `code-gate-stored.ts`, which this row does not own. The text report (`code-gate-text.ts`) is unchanged; the reasons are on stderr and in the JSON.
7. **Bound:** three names per line, then `, and N more`. One line per reason per runner. With the eight reasons, at most six lines per runner, and only Vitest reads parts.
8. **`code-gate.ts`:** I moved the after-verdict stderr (refusals, then kept logs) into `afterVerdict`, so `gate` stays under complexity 20 (Squeal flagged 21 with an inline loop). An unconditional `io.stderr("")` would have broken `code-gate-log.test.ts`, which checks that the kept-logs line comes right after the report.
9. **Small behaviour changes in `partsEvidence`** (no change to what it takes):
   - It reads the runner's environment only when a selected file has exactly one usable part. Before, it read it whenever any part was usable, even when no selected file was in one. A runner that cannot give its environment no longer fails a gate whose selected files no usable part holds.
   - It checks a record's sources in path order, so the first differing source by name is the one named. Whether the file is taken does not change.

## Type changes (all additive)

- `src/core/ci/inputs.ts`: new `Uncertified` type and `uncertifiedWhy()`.
- `src/core/code/gate/parts-refused.ts` (new): `PartRefusalReason`, `GatePartRefusal`, `PartRefusal`, `refusedText()`.
- `PartsOptions.refused?: (refusal: PartRefusal) => void`.
- `Evidence.refused?: readonly PartRefusal[]`.
- `GateRunReport.refused?: Readonly<Record<RelativePath, GatePartRefusal>>`.

## Done-when mapped to tests

| Done-when | Test |
| --- | --- |
| Each refusal branch gives its reason in JSON | `test/code/gate/parts-refused.test.ts`: one case each for `duplicate`, `unusable` (no read evidence, another collector, `coverage.children`), `environment`, `closure`, `input` (differs, not recorded, count of more), `record` (with `noRecord`), `unread`, `source`; no refusal for a file no part holds or a node:test file. `test/code/gate/report-refused.test.ts`: refusals reach `runs[].refused` by path. `test/cli/code-gate-parts-cases.test.ts`: real parts, `input`, `duplicate` and `unusable` in the JSON report. |
| The input-mismatch case names the part and the input | `parts-refused.test.ts` "runs a file whose runtime read changed here, and names the read", "names the first input by path, why, and how many more differ"; `code-gate-parts-cases.test.ts` "runs a file whose input changed" (an edited test file and an edited runtime read, with the part's file path) |
| The stderr summary is bounded | `report-refused.test.ts` "gives one line per reason, … at most three names" (5 files → 3 names and `and 2 more`), "is empty when the parts refused nothing, or only part-wide"; CLI cases check the exact line |
| Accepted parts unchanged | `parts.test.ts` "is taken with its record, …" now also expects no refusal; `parts-refused.test.ts` collected-by `squeal`/`v8` expects no refusal; `report-refused.test.ts` "is the same report as before when the parts refused nothing" and "leaves out … the key when none is left" |
| A later store hit reads apart from a local run | `code-gate-parts-cases.test.ts` "runs a file two parts hold, and takes the rest; then the stores give it": the second gate reads `test/add.test.ts` with `from: store`, still `refused: duplicate`, and stderr says `1 read from the stores`; `report-refused.test.ts` "gives each refusal by path, beside where the file's evidence came from" and "gives a file the stores gave alone as read from the stores" |
| Certification, provenance, verdicts and exit unchanged | Every pre-existing `parts.test.ts` and `code-gate-parts-cases.test.ts` expectation on `evidence`, `from`, `ran`, `code` and `verdict` is kept as it was |

The done-when line most likely to be false was "a later store hit reads apart from a local run", because it depends on the gate keeping the refused file at its key and the stores then serving it under `--parts`. The CLI case runs that path end to end.

## Checks run

- `pnpm run lint` (biome check .): exit 0, 3,327 files, no fixes.
- `pnpm run typecheck` (tsrs --fast --noEmit): exit 0.
- `squeal status --wait 60000` on the new and changed test files, each at its revision: `test/code/gate/parts.test.ts`, `parts-refused.test.ts`, `test/ci/inputs.test.ts` pass (revision 15); `report-refused.test.ts`, `report-children.test.ts` pass (revision 18); `test/version-sensitive.test.ts` failed at revision 18 because `report-refused.test.ts` named a variable `nodeTest`, which that rule reads as a node:test caller; renamed, it passes at revision 19; `test/cli/code-gate-parts-cases.test.ts` passes (revision 26).
- `pnpm exec vitest run test/cli/code-gate-parts-cases.test.ts`, run directly to confirm the new end-to-end cases ran: 7 passed in 6.93 s, load 10.33 on 24 CPUs.
- `squeal code` on the changed source files: every function at or under complexity 20 (`gate` 19 after `afterVerdict`, `partsEvidence`'s lookup 17, `taken` 12). CRAP unknown while the affected tests are queued.
- Expected failures: the four bundle tests above fail from revision 27 on. This is bundle drift: the source changed and the wave forbids `pnpm run build` in a worker tree. The coordinator's rebuild at integration clears them.
- `test/cli/code-gate-parts-environment.test.ts`: two cases failed at revision 28. They compare a gate with parts to one without, through `sameApartFromSource`, which left out `from` but not the new `refused`. The helper now leaves out `refused` too, and both cases assert the `environment` reason. They pass at revision 29.
- Affected-test verdict: `squeal status --wait 60000 $(git diff --name-only f15692098..HEAD -- src test)` at revision 30 (commit `dabadaf5e`): 372 test files selected, each with a current result. 368 pass. 4 tests fail, all bundle drift (`cli/squeal.mjs differs from the build`): `test/harness/plugin.test.ts`, `test/harness/codex/packaging/runtime.test.ts`, `test/harness/opencode/package.test.ts`, `test/harness/pi/package.test.ts`. 9 test files elsewhere in the worktree are unknown (never run here; the baseline is lookup-only); none is in this selection.

## Checks not run

- No full suite and no `pnpm run build` (wave header: high host load; no build in a worker tree). `plugins/claude-code/dist` and the other bundles are not rebuilt; CI and the bundle tests fail on that drift until the coordinator rebuilds at integration.
- The issue's probe (`research/probes/issue-205/probe.mjs`) was not rerun: it calls the installed 0.1.460 CLI, not this tree. The CLI case "runs a file whose input changed" covers the same shape with this tree's code.
- No test of the `unknown` input detail through `partsEvidence` (it needs a path whose hash fails here). `test/ci/inputs.test.ts` "says why each input is not certified" covers it in `uncertifiedWhy`.

## For the coordinator and the next worker

- **Overlaps.** `src/cli/code-gate-stored.ts`: this row added 5 lines (the sink and `evidence = { ...evidence, refused }` after `collectEvidence`); row 020-48 may wire the keeper there. `src/cli/code-gate.ts`: row 020-50 adds a stderr line. `afterVerdict` is now where after-verdict stderr lines go.
- **Docs.** `commands.md` (three copies) needs the text above. The spec needs the D7 and D13.2 text above.
- **Text report.** `code-gate-text.ts` does not show refusals. If the human wants them in the text report too, that is a separate small change there.
- **Original 148 files of #205.** This row does not find their cause. With this release, a rerun of that gate names the reason for each file.

## Repair R1 (review `reviews/0.1.465.md` B1, `tasks/wave-17.5.md`)

### The defect

The stderr summary counted every refused file that the stores did not give as "run here". A refused file in `notStarted` or `overBudget` never ran, but the line said it did. The review reproduced it with `--timeout 1` and a Vitest config that spends the budget at start: exit 3, `notStarted: ["test/refused.test.ts"]`, and the line `1 test file not taken from the parts, 1 run here: …`. The verdict and the JSON were right; the stderr line was false.

### The fix

`refusedText` (`src/core/code/gate/parts-refused.ts`) now classifies each refused file from the final run report (`GateRunReport`), in this order:

| Class | Rule | Words on the line |
| --- | --- | --- |
| read from the stores | `from[path]` is `store` | `N read from the stores` |
| ran here | in `completed` | `N ran here` |
| did not run | in `notStarted` or `overBudget`, or in no run list (for example a node:test file its `prepare` kept from running) | `N did not run` |
| started and did not finish | in `notFinished` and not in `notStarted` | `N started here and did not finish` |

The line lists the non-zero counts in the order ran here, started here and did not finish, did not run, read from the stores. One line per reason and the three-name limit stay. "run here" now reads "ran here" for a completed file. `src/cli/code-gate.ts` needed no change: it already passes `report.runs`, the final run report.

Example, the review's case:

```text
squeal code: Vitest: 1 test file not taken from the parts, 1 did not run: its part does not certify an input as it is here (test/grade.test.ts: test/grade.test.ts)
```

### Proposed D13.2 wording change (candidate `cand/0.1.465` spec, D13.2 item 2, last paragraph)

Replace:

> After the verdict, stderr gives one line per runner and per-file reason (`duplicate`, `closure`, `input`, `record`, `unread`, `source`): how many files it refused, how many of those ran here and how many the stores gave, and up to three of them, each with its `input`; the others are counted.

with:

> After the verdict, stderr gives one line per runner and per-file reason (`duplicate`, `closure`, `input`, `record`, `unread`, `source`): how many files it refused; of those, from the final run report, how many ran here (completed), started here and did not finish, did not run (never started, the early stop kept them from running, or no run took them), and were read from the stores, each count only when it is not zero; and up to three of them, each with its `input`; the others are counted. A file that did not run is never counted as run (review 0.1.465 B1).

### Proposed D7 clarification (same amendment, row 020-49 sentence)

Replace "`from` says whether the stores then gave the file or this command ran it." with "`from` says whether the stores then gave the file or it went to a run here; `completed`, `notFinished`, `notStarted` and `overBudget` say whether it ran." The `run` value of `from` is unchanged; this only stops the spec text from claiming a run.

### `commands.md` (three copies), line 126 on the candidate

Replace the example `` `Vitest: 2 test files not taken from the parts, 2 run here: …` `` with `` `Vitest: 2 test files not taken from the parts, 2 ran here: its part does not certify an input as it is here (test/add.test.ts: test/add.test.ts, test/reads.test.ts: data/input.txt)` `` (the line `code-gate-parts-cases.test.ts` now expects) and add after it: "The counts come from the run report: a file the budget never reached says `did not run`, and one stopped before it finished says `started here and did not finish`."

### Repair commits

- `3e3c625fe` fix(020-49): the refusal summary says a file did not run when the gate never started it. `src/core/code/gate/parts-refused.ts`; tests `test/code/gate/report-refused.test.ts`, `test/cli/code-gate-parts-unstarted.test.ts` (new), and the "ran here" wording in `test/cli/code-gate-parts-cases.test.ts`.
- This notes addition.

### Done-when mapped to tests

| Done-when (R1) | Test |
| --- | --- |
| A summary regression with unstarted and over-budget refusals | `report-refused.test.ts` "counts a file that never started or that the gate stopped before as not run (review 0.1.465 B1)": six refused files: one completed, one started and stopped, one `notStarted`, one `overBudget`, one from the stores, one in no run list, giving `1 ran here, 1 started here and did not finish, 3 did not run, 1 read from the stores` and the three-name bound. Also "never says a file ran when none started". |
| A CLI regression for the review's spent-before-run case | `test/cli/code-gate-parts-unstarted.test.ts`: real `ci record` with a config that waits 1.5 s at load, one input hash zeroed in the part, `--timeout 1`. It asserts exit 3, verdict `incomplete`, `completed: [test/add.test.ts]` (from the parts), `notStarted: [test/grade.test.ts]`, the `input` refusal with the part and input, the `1 did not run` line, and no "ran here". Run against the old `parts-refused.ts`, it fails with the review's false line (`1 run here`). |
| The later-store-hit case and every exit and verdict assertion unchanged | `code-gate-parts-cases.test.ts` "runs a file two parts hold, and takes the rest; then the stores give it": unchanged apart from "run here" becoming "ran here" in the first gate's expected line; the second gate still expects `1 read from the stores`. No exit, verdict, `from` or `refused` assertion changed anywhere. |
| A started file that did not finish still counts as having run | It reads `started here and did not finish`, its own count, separate from "did not run" (the summary regression's `test/b.test.ts`). |

### Repair checks

- `pnpm run lint`, `pnpm run typecheck`, and Squeal's affected verdict: see the final report to the parent.
- `pnpm exec vitest run test/cli/code-gate-parts-unstarted.test.ts`: 1 passed in 9.84 s, load 3.70 on 24 CPUs. With `parts-refused.ts` from `d6ec89d20` put back for one run, it fails on the expected line and prints `1 run here`; the fix was then restored.
- `squeal status --wait 60000 test/code/gate/report-refused.test.ts`: pass at revision 33.
- Not run: the full suite and `pnpm run build` (wave rule). The bundles still drift until the coordinator rebuilds.
- `git fetch origin` failed twice with HTTP 502 from GitHub; the repair brief and review were read from the local `origin/main` ref at `2ab1588ff` (2026-11-13 11:01 +0100), which already holds both.

