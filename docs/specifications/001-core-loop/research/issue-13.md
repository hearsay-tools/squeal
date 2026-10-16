# Issue 13: an invalidation reason hidden by artifact paths

Research for spec 001, 2026-10-16, from `research/issue-13-brief.md`. Subject: hearsay-tools/squeal#13, "Show invalidation reasons before long artifact path lists" (labels `bug`, `friction`, filed 2026-10-16 from cezarion#1137, plugin 0.1.199), and its one comment (cezarion#1133 / PR #1171, 0.1.199). Examined at 4e6354d7 (package 0.1.200). Between tag `squeal--v0.1.199` (9608b93f) and 4e6354d7 the files on this path differ only in `squeal stop` handling (`composite-runner.ts`, `tiers.ts`, `scheduler.ts`, task 001-367), so 0.1.199 behaves as below (*read in source code*). Linux 6.8, 24 CPUs, load 22 to 33, Node 24.21.0, Vitest 5.0.3. Probes: `probes/issue-13/` (throwaway).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the request fit the vision? | Yes. It changes no state and weakens no detection: it makes an `unknown` delivery say why and what next, which is principle 7 ("the agent gets evidence, not a bare verdict") and decision-filter questions 1 to 3. The issue's out-of-scope line keeps principle 2 intact. | inferred from `docs/vision.md` |
| 2 | Is it already a board row? | No. No row bounds the touched-path list in a reason or gives an `UNKNOWN` block a detail command. 001-403 and 001-413 are the nearest, both done, and both set the pattern the issue asks for: a few samples plus a count (`UNKNOWN_SAMPLES_KEPT` = 3), the list behind `--json`/`--notes`. New evidence below: three reason builders put every path ahead of the explanation, the delivery cap then cuts it, and 001-403's status line prints the whole reason per file. | read in `docs/board.md` and source code |
| 3 | Can the hidden reason be reproduced? | Yes, in two layers, through product code. Formatter: from 5 paths of 46 characters the delivered `UNKNOWN` block loses the explanation. Scheduler with a real Vitest run: 600 rewritten `dist/*.d.ts` files that no test imports give a 21,019-character reason; the delivery shows 297 characters of paths and `...`. The live watcher, daemon and hook were not run, and the originating run was not replayed. | verified by experiment |

## Findings

### 1. Vision fit

The issue asks for the reason before the paths, a bounded sample with a total, and a detail command (acceptance criteria 1 to 3). Vision principle 7 lists "concise failure output" and "full logs stay retrievable. They do not land in the agent's context unasked". Today the opposite happens: the actionable part is cut and 300 characters of paths land in the context (finding 3). The issue excludes "weakening detection of files rewritten during a test run", so the 001-159 rule (spec D4, "Touched files") stays. *Inferred from `docs/vision.md` and the issue text.*

### 2. Board and specs

- **001-403** (done, 0.1.196) made status and `run --all --wait` name each `unknown` file with its reason (`src/core/status/unknown-files.ts`). It bounds the files to 20 (`UNKNOWN_FILES_LISTED`) and the sample paths to 3 (`samplesOf`), but prints `reason` whole (`unknownFileText`, line 81). *Read in source code.*
- **001-413** (done, 0.1.198) cut the slow-tier line from 25 globs to a count, the list in `status --json` or `--notes`. Same pattern, another line. *Read in `docs/board.md`.*
- **007-30** bounds its own note: `withholdNote` uses `listPaths(paths, 5)`, "a, b, c, d, e and N more" (`src/core/scheduler/stability.ts:146`, `src/core/scheduler/notes.ts:7`). *Read in source code.*
- Searches of the board for unknown reasons, `why`, summary caps, path lists and samples found no other row. No spec or research file mentions issue 13 except the brief. *Read in `docs/board.md`, `grep -rn` over `docs/`.*

### 3. Where the reason is built and where it is cut

The issue's text, `vitest: vitest adapter: packages/cezar/dist/agent-config/account-identity.d.ts, ...`, is built and cut here (*read in source code, 4e6354d7*):

1. The Vitest adapter collects every `touch` the runner hears during a run (`adapter.ts:279`) and, when any was heard, drops every file of the run with `withoutTouched` (`adapter.ts:489`). Its reason is `` `vitest adapter: ${touched.join(", ")} was written during this run and ended as it was; ... (task 001-159)` `` (`src/runners/vitest/moved.ts:82`): every path, then the explanation.
2. The daemon's runner is always the composite (`src/core/daemon/daemon.ts:472`), which prefixes `vitest: ` (`composite-runner.ts:182`).
3. `recordTier` passes `report.failure` as the reason to `markUnknown` (`src/core/scheduler/tiers.ts:530`); the sink stores it whole as the state's `summary` (`src/core/state/derive.ts:141`).
4. `unknownBlocks` groups `unknown` entries by reason and renders `cap(reason, SUMMARY_MAX_CHARS)` (`src/core/delivery/format.ts:193`), 300 characters (`src/core/state/fingerprint.ts:13`). The paths fill it, so the explanation and the task number go.
5. Only a block with a `fail` gets the tail `Full output: squeal why <check>` (`format.ts:268`); an `UNKNOWN` block has no detail command. `squeal why` does print the whole summary (`src/core/status/format-why.ts:109`), so the reason is retrievable, unsignposted. *Inferred: not run.*

The same shape, paths first, is in two more builders: 001-146's `withoutFiles` (`moved.ts:67`, bytes changed after the run loaded them) and 001-168's barrier `withheldForTouch` (`stability.ts:83`). Each can hide its explanation the same way. *Read in source code; `withheldForTouch` verified by the formatter probe.*

### 4. Formatter reproduction

`probes/issue-13/format.probe.ts` calls the product's `withoutTouched`, prefixes `vitest: ` as the composite does, and renders seven `PASS -> UNKNOWN` entries of `card-2-contrast.test.ts` through `formatDelta`. With 660 paths `packages/cezar/dist/agent-config/module-<i>.d.ts` the reason is 33,027 characters, the explanation starts at character 32,913, and the delivered block reads (`results/format.txt`):

```text
UNKNOWN  7 checks (7 tests) in 1 test file
      PASS -> UNKNOWN (7 tests)
      vitest: vitest adapter: packages/cezar/dist/agent-config/module-0.d.ts, [...4 more paths...], packages/cezar/dist/agent-config/...
      packages/web/src/test/card-2-contrast.test.ts
```

From 5 such paths the explanation is gone. Status's unknown-file line for the same reason is 33,085 characters. `withheldForTouch` gives 33,024; `withholdNote` gives 545 for the same 660 paths. *Verified by experiment.*

### 5. Scheduler reproduction with a real run

`probes/issue-13/scheduler.probe.ts` uses the real scheduler, Vitest adapter, store, sink and delivery (`test/scheduler/helpers.ts`). Two tests pass. An edit of `src/mod.ts` re-runs both in one tier. While one test holds the run, the probe rewrites N committed files `dist/agent-config/module-<i>.d.ts` with their own bytes, which no test imports, as a build rewriting committed output does. The harness then hands their batch to the scheduler as the change feed would. No watcher, daemon, composite or hook runs, so the reason lacks the `vitest: ` prefix. Results (`results/scheduler-{600,6,5}.txt`):

| N | reason (chars) | explanation delivered | whole reason delivered |
|---|---|---|---|
| 600 | 21,019 | no | no |
| 6 | 327 | yes, tail `(task 001-159)` cut | no |
| 5 | 294 | yes | yes |

At N = 600, both files go `PASS -> UNKNOWN`: `test/other.test.ts` too, though it never paused, because `withoutTouched` drops every file of the run (spec D4). Status is 42,973 characters, two lines of 21,052 for the two files. The header reads `unknown: 4`, `pending: 0`. Status says "none queued", and no withhold note was written. *Verified by experiment.*

That last part matches the comment's "no current result and none queued". The barrier's run-once-more (007-30) covers only touches of a tier's own inputs. A touch the runner alone hears, of a path no key names, leaves the files `unknown` until an input changes. D4 says so: "only a touch the runner hears during the run withholds for it". So the agent cannot tell from the message whether to wait or re-run (the comment's question). *Verified by experiment; read in `spec.md` D4 and `scheduler.ts:569`.*

### 6. Limits

- The originating cezarion run (`e6babda6…`, 548,688 ms, 31,065-character failure) was not replayed and its store was not read. The live chain (watcher reconcile, touch detection over real `dist/` writes, daemon, Claude Code hook) was not run. Whether cezarion's `dist/` is watched is not established. The issue shows a touch was heard, so it was.
- The harness hands the batch over directly, so this does not test how the watcher batches 600 writes.
- `squeal why` on an `unknown` check and `squeal retry` on an `unknown` file were not run.

## Recommendation for Squeal (for the pending human decision)

Accept issue 13 as one 001 row, display only:

1. Every reason that names paths says the explanation first and bounds the paths with the existing `listPaths` (5 and "N more"). That covers `moved.ts:67`, `moved.ts:82` and `stability.ts:83`. The full list stays in the run's `report.json`, which keeps `failure` whole. Alternatively, `markUnknown` keeps the full list as 001-403's samples do.
2. An `UNKNOWN` block in a delivery gets a detail command as a `FAIL` does: `squeal why <check>` or `squeal status`.
3. Status's unknown-file line is capped like the delivery's, the list behind `--json`.
4. A regression test with enough artifact paths to cross `SUMMARY_MAX_CHARS`. The scheduler probe is that test's shape.

One decision for the human, separate from wording: should a touch heard only by the runner (finding 5) get 007-30's single re-run, or only a message saying the files stay `unknown` until an input changes? The first changes behaviour and needs its own row. The second is wording within this one. The issue does not ask for the first.

## Open questions

- Does `squeal retry --reason environment` accept a file that is `unknown` rather than failing? It would be the next action to name. *Not determined, because it was not run.*
- Is the 300-character cap right for an `unknown` reason once paths are bounded? `listPaths` at 5 paths of 46 characters already uses about 270. *Inferred.*

## Reproduction

From the repository root at 4e6354d7, after `npm ci`:

```sh
P=docs/specifications/001-core-loop/research/probes/issue-13
npx vitest run --config $P/vitest.config.ts $P/format.probe.ts --silent=false --reporter=verbose
ISSUE13_PATHS=600 npx vitest run --config $P/vitest.config.ts $P/scheduler.probe.ts --silent=false --reporter=verbose
```

The format probe ran in 1.3 s with 4 tests passing. Each scheduler run took 5 to 6 s with 1 test passing, at N = 600, 6 and 5. The probe configs include only `*.probe.ts` under this directory, and the repository's `vitest.config.ts` covers only `test/**` and `src/**`, so neither Squeal nor CI runs them.

## Sources

- https://github.com/hearsay-tools/squeal/issues/13 and its comment (read with `gh issue view 13 --comments`, 2026-10-16).
- `src/runners/vitest/moved.ts`, `adapter.ts`; `src/core/daemon/composite-runner.ts`, `daemon.ts`; `src/core/scheduler/tiers.ts`, `stability.ts`, `notes.ts`, `scheduler.ts`, `ledger.ts`, `unknown-files.ts`; `src/core/state/derive.ts`, `fingerprint.ts`; `src/core/delivery/format.ts`; `src/core/status/unknown-files.ts`, `format-why.ts`; `src/core/text.ts`, all at 4e6354d7.
- `docs/specifications/001-core-loop/spec.md` D2 and D4 ("Touched files"); `docs/board.md` rows 001-146, 001-159, 001-168, 001-403, 001-413, 007-30; `docs/vision.md`.
- Probes and outputs: `probes/issue-13/`.
