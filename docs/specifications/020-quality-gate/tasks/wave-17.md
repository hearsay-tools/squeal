# Wave 17 (the human, 2026-11-13: "#206: Fix it (A)", "#205: Build it", "#207: Build it")

Base: main at 0.1.464. Three rows on disjoint seams run in parallel. Host load is high: targeted tests only (`squeal status --wait 60000 <paths>` or vitest with explicit paths); no full suite; no `pnpm run build` in a worker tree. Write the proposed spec text in `tasks/wave-17-<row>/notes.md`; the coordinator amends the spec. Row 020-47 (the overrun's `usedSeconds` clamp in `progress.ts`) is the coordinator's, at integration: leave `progress.ts` alone.

## 020-48: the gate keeps run-time readers while a daemon serves (#206)

Use /worker. Shape: slice. Read `research/issue-206.md`, `research/no-daemon-reuse.md` (option 2 there is "the serving daemon"), spec D17.3, and row 020-39's commits on `keep.ts` (`git log -- src/core/code/gate/keep-seen.ts`).
- With a serving daemon, `#write` drops every file kept at a grown key (`keep.ts:245`, `#withoutGrown`). The keeper sends the run's observed reads with its `keep` request (`src/core/daemon/keep-request.ts`, `keep-protocol.ts`); the daemon merges them and stores the file at its grown key in its retried path, with the checks its own record applies. An older daemon that does not know the field still answers as today.
- First edit, as a lead: the `keep` request type in `keep-protocol.ts` gains the reads; `keep-request.ts` merges them where its own run records do.
Owns: `src/core/code/gate/keep*.ts`, `src/core/daemon/keep-request.ts`, `src/core/daemon/keep-protocol.ts`, and the keep path in `src/core/daemon/{desk,front-desk,desk-messages,handlers}.ts`; `src/core/run-evidence/**` and `src/core/keys/observed.ts` only if the merge needs them (say why in notes); their tests.
Done when (tests): #206's shape (a test that reads `data/table.json`) reads 2/2 from the stores on the second gate run with a serving daemon, and still with none; a changed `data/table.json` reruns it; first-seen, runtime and merge-hold checks still refuse; an old-protocol daemon answer keeps today's "not kept" line.

## 020-49: the gate says why it reran a file a usable part held (#205)

Use /worker. Shape: slice. Read `research/issue-205.md` (probe and its evidence), spec D7 and D13.2, `src/core/ci/inputs.ts` around 216.
- A selected file present in a usable part but not reused gets a reason in the JSON report: the part, and the first input that differs where one does; record or closure missing; a duplicate owner; any other refusal branch `gate/parts.ts` has. A file a later store lookup served reads apart from one run locally. Stderr gives one bounded summary line per reason with a count (no per-file list past a few names). Certification, provenance, verdicts and exit stay as they are.
- First edit, as a lead: where `gate/parts.ts` refuses a part's file (around 105), return the reason, not only skip it.
Owns: `src/core/code/gate/{parts,parts-environment,runs,report,types}.ts`, `src/core/ci/inputs.ts` (only to return the reason), `src/cli/code-gate.ts`, their tests. Report fields in their own small commit.
Done when (tests): each refusal branch gives its reason in JSON; the input-mismatch case names the part and the input; the stderr summary is bounded; accepted parts unchanged; a later store hit reads apart from a local run.

## 020-50: a Vitest teardown warning says whether the file's result counts (#207)

Use /worker. Shape: slice. Read `../013-vitest-runner/research/issue-207.md` (Q1 to Q5, probes), spec 013 V4/V8 and 020 D7, `src/runners/vitest/run.ts` near 202 and `adapter.ts` near 233, `src/core/code/gate/evidence.ts` near 44.
- When Vitest reports a worker teardown timeout for a file, the gate's stderr adds one line per warned file saying whether its result counts, from the final completion and error evidence: counted (completed), or not counted (not finished, crashed). It never says the result was stored or kept: storage is the keeper's. Verdicts, exit and provenance unchanged.
- First edit, as a lead: capture the warning's file attribution in the Vitest adapter's run evidence, then read it in the gate's stderr.
Owns: `src/runners/vitest/{run,adapter}.ts` for the warning only, `src/core/code/gate/evidence.ts`, their tests. Its stderr line goes into `src/cli/code-gate.ts` in its own small commit (row 020-49 owns that file; the coordinator resolves overlaps).
Done when (tests): the passing-file probe shape prints "counts"; a separate assertion failure stays failed; a worker killed with SIGKILL reads not counted; a normal teardown prints nothing new.
