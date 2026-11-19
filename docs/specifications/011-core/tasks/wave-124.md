# 011 wave 124: a named status reads less; a named wait stays outside the CPU ceiling; lowering never stops silently; cached path checks in selection

Rows 011-411, 011-412, 011-410 and 011-414 (W3 and W4 added the same day from the human's second card: "Yes, small row", "cache path checks"). Coordinator 4abb5168, 2026-11-19, from the human's card of the same day: #250 "A: cheaper reads", named waits "Outside, as spec". Two workers in parallel on disjoint seams, one candidate, one review.

Rules for every worker: no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage: grep ALL of `test/` for paths you change and run each such e2e file directly, `timeout 900`. Every direct `vitest` run gets `timeout` and `--maxWorkers=2`. Before you report, read `squeal status --wait 60000 <changed-path>...`. Write `~`, never a `/home/<user>/` path; no company or VM host names. Notes in `tasks/<row>/notes.md` with the proposed spec amendment; the coordinator lands spec and status edits. `src/cli/wait/named.ts`, `named-file-lines.ts` and `named-selection.ts` belong to another coordinator's row 023-26 now: do not edit them; if your change needs them, stop and ask.

## W1: 011-411 a named status reads each test file once (gh-250, option A)

Use /worker. Shape: slice (performance, same output). Outcome: `squeal status [--json] <paths>` and a named wait's final read give byte-identical text and JSON, with less CPU: each test file's closure hash and observed hash are computed once per call, not once per stored CI import, and the verdict and named-files steps reuse the snapshot's state rows instead of reading all states again.

Read: `research/issue-250-profile.md` (recommendations 2 and 4, the phase table), `research/probes/issue-250/README.md`, spec 011 C6, spec 018 D5 and D19 (what the import comparison must keep).

First edit: `src/core/status/snapshot.ts` `importsOf` (about line 278): memoize the per-file closure and observed hashes for the call. Then let `readClasses` (`src/cli/verdict.ts`) and `readNamedFiles` (`src/core/status/standing.ts`) take the snapshot's rows when the caller has them, wired from `src/cli/wait/snapshot.ts`.

Owns: `src/core/status/snapshot.ts`, `src/core/status/standing.ts`, `src/cli/verdict.ts`, `src/cli/wait/snapshot.ts`, their tests. Leave alone: the three 023-26 files above, `src/core/scheduler/**` (W2).

Done when: a test proves identical text and JSON before and after on a store with several imports; a test or probe counts the store reads (statement calls or rows) and shows the per-import closure lookups and the repeated state reads gone. Measure user CPU before and after with the probe on a copy of a large store (README setup, in your task scratch, no daemon on any real store, HOME and XDG_* in scratch; host load stated per run; no artificial load), 5 runs each.

## W2: 011-412 a named wait's batch stays outside the CPU ceiling

Use /worker. Shape: repair. Outcome: a tier of a named wait's batch (spec 011 C15, rows 011-268 and 011-308) is gated as spec 021 D18 says, outside the background ceiling: it takes the pool's slot-based gate that a checkpoint uses, not the backlog's busy-CPU gate. Backlog and baseline tiers keep the ceiling.

Read: spec 021 D18 (Rule line), spec 011 C10 Size and C15, `reviews/0.1.570-r2.md` (the reviewer confirmed the conflict predates 0.1.570), `tasks/011-404/notes.md` (named-wait question).

First edit: `src/core/scheduler/capacity.ts` `poolKind` and its callers in `tier-pass.ts` (about line 219, where `batch` is known) and `tier-pick.ts` (about line 49, the offer): a batch's tier is not `backlog`.

Owns: `src/core/scheduler/{capacity,tier-pass,tier-pick}.ts`, their tests (`test/scheduler/batch-tier.test.ts` included). Leave alone: `src/core/capacity/**` unless the pool kind needs a type there (say so in notes), `src/core/status/**` (W1).

Done when: a test with the host read at 20 busy of 24 CPUs (ceiling 18) grants a named wait's batch its slots, and the same files as a backlog tier are refused; existing batch, checkpoint and backlog tests pass.

## W3: 011-410 process lowering stops only on its abort

Use /worker. Shape: repair. Outcome: `lowerWhile` (`src/core/daemon/low-priority.ts`) ends only when its abort signal fires. Any other error from `carriers` or the walk is logged once per error message and the next look retries; later test processes of the run are still lowered. Read: `tasks/011-409/notes.md`, `reviews/011-409.md` (the reviewer's note on the silent catch). Owns: `src/core/daemon/low-priority*.ts`, `src/core/daemon/escaped*.ts` if the carriers need it, their tests. Leave alone: everything W1, W2, W4 own. Done when: a test with a walk that throws once shows lowering continues and a later child reaches nice 10; a test with the abort shows it ends; the existing low-priority tests pass, run directly at nice 0.

## W4: 011-414 choosing affected tests caches its repeated path checks

Use /worker. Shape: slice (performance, same output). Outcome: the per-file closure loop of a revision's runner part (`refinement.ts` `fetchRunnerPart`, one `runner.closure` per re-resolved file) stops repeating the same path work: `isProjectFile`, `toRelative` and each file's relative import edges are computed once per path and content (by path and content hash), within the runner host, and reused across files of the revision and across revisions. Closures, keys and selections stay byte-identical. Read: `research/broad-change-throughput-2.md` section 2 and recommendation 3 (13 ms a file warm, two thirds in repeated `path.relative` and `isProjectFile` checks in `fileImports`), b99e3c05's note in the same file on caching edges by (path, sha1). First edit: `src/runners/vitest/graph.ts` `fileImports` and the `closure` method in `src/runners/vitest/adapter.ts` (about 540-570). Owns: `src/runners/vitest/{graph,adapter}.ts`, `src/core/fs/worktree-paths.ts` if a memo belongs there, their tests. Leave alone: `src/core/scheduler/**` (W2), `src/core/status/**` (W1). Done when: a test shows identical closures with and without the cache, including an edited file whose edges change; a micro-benchmark or profile of the closure loop on this repository's 2,000 test files shows the per-file time before and after (state load). A key-format case only if a key could differ (say so in notes).
