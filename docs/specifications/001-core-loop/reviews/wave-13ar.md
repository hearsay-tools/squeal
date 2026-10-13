# Wave 13ar: 001-307 ignored reads during a warm-up

Candidate: `163d3e7bcb4a8f6af9164426e50ca02b41223b36`.
Range: `2b0c5532..163d3e7b`. Board row: 001-311.
Brief: `tasks/wave-13.md`, section 001-307. Contracts: 001 D4, D5, D7, D11; 005 D3 and the accepted conditions in 005 `status.md` (2026-10-10).

## Verdict

**FAIL**. 1 proven blocker, 1 proven should-fix, 1 proven nonblocking verification nit. No product code or board changed by this review.

## Verification output

All checks below ran at exact candidate `163d3e7bcb4a8f6af9164426e50ca02b41223b36` with a clean tracked tree. `git status --porcelain` was empty before the gates, after the build, after the full suite and after the isolated retry. The review file was written afterwards. The independent Vitest run is the requested gate, not Squeal's checkpoint.

```text
$ git rev-parse HEAD
163d3e7bcb4a8f6af9164426e50ca02b41223b36
$ git status --porcelain
(no output)

$ npm ci
added 56 packages, and audited 57 packages in 7s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
(exit 0)

$ npm run lint
> squeal@0.1.136 lint
> biome check .

Checked 968 files in 1037ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.136 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.136 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.136 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0; git status --porcelain produced no output)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run --maxWorkers=4
RUN v5.0.3
FAIL test/runners/vitest/load.test.ts > loadVitest > rejects with a factual reason when the project has no Vitest
Error: Test timed out in 5000ms.
at test/runners/vitest/load.test.ts:35:3
Test Files  1 failed | 448 passed | 1 skipped (450)
Tests       1 failed | 3782 passed | 10 skipped (3793)
Start at    13:05:02
Duration    859.84s (tests 97%, import 2%, transform 1%)
(exit 1)

$ env -u CODEX_SESSION_ID GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 npx vitest run test/runners/vitest/load.test.ts --maxWorkers=4
RUN v5.0.3
Test Files  1 passed (1)
Tests       3 passed (3)
Start at    13:19:55
Duration    831ms (transform 64%, tests 24%, import 12%, worker 1%)
(exit 0)
```

The full-suite timeout is verified; its cause being host contention is **plausible**, not proven. Load exceeded 100 during the run and was about 16 at its end. The failed test and `src/runners/vitest/load.ts` are unchanged by this range; the test calls that loader directly. It passes in isolation. This is recorded gate evidence outside the candidate's blast radius, not a wave finding. The full suite did not pass, and the isolated retry does not replace it. Both added files, `test/daemon/run-all-warm-up.test.ts` and `test/scheduler/warm-up.test.ts`, passed in the full run.

The full run also printed two fixture `repair: gitdir incorrect` diagnostics and a global-setup line killing one process from an earlier run. These produced no separate failed test or unhandled-error result. No second full proof was run.


## Blockers

### B1. Proven: a warm-up joins an unobserved tier and completes without its ignored reads

Location: `src/core/scheduler/scheduler.ts:266`, `src/core/scheduler/scheduler.ts:486`, `src/core/scheduler/warm-up.ts:31`.

The row's done-when requires: “a slow node:test and a Vitest file reading a gitignored `dist/` file report it after an `observeIgnored` checkpoint”. Build step 2 requires collecting the ignored paths “during such a checkpoint”.

On a fresh repository, the daemon starts the baseline before setup asks for its warm-up checkpoint. If a slow node:test tier is already running, `requestFullSuite({ observeIgnored: true })` uses the existing `queueFullSuite` join. `WarmUp.start` sets the baseline's id as its active observation checkpoint. The tier's `executeTier` has already received `observeIgnored: false`, however, so it cannot return `reads`. `WarmUp.read` accepts that tier's checkpoint id but iterates an absent `report.reads`. Its result satisfies the joined checkpoint while the metadata contains an empty `files` map. Setup receives a completed checkpoint and loses the evidence it needs to suggest the artifact as an input.

This is also possible with `force: true` when joining an already-running ordinary forced checkpoint. Vitest tiers started without the flag similarly omit `reads`, even when their ordinary observer collected the paths.

**Reproduction on the exact, clean candidate:** a throwaway script created a git repository with `.gitignore` containing `ignored/`, a pre-existing `ignored/build.txt`, and one slow node:test file. Its test read that artifact with `readFileSync(new URL("./ignored/build.txt", import.meta.url))`. The real `createNodeTestAdapter`, store, state sink and scheduler ran it. A wrapper held the baseline's first `run(files, options)` after options were chosen, then the script called `requestFullSuite({ observeIgnored: true })`, released the run and awaited `scheduler.idle()`.

```text
actual joined warm-up:
  checkpoint.end: completed
  checkpoint.testFiles: [{ project: nt, path: read.test.mjs }]
  runner calls: [{ observeIgnored: false, files: [nt:read.test.mjs] }]
  ignoredReads: { checkpoint: <joined request id>, revision: 0, files: {} }
actual flagged control (same scheduler, force: true, observeIgnored: true):
  checkpoint.end: completed
  ignoredReads.files["nt\u0000read.test.mjs"]:
    { paths: ["ignored/build.txt"], more: 0 }
```

The wrapper changed timing only; it passed the scheduler's actual options unchanged to the real adapter. A separate direct runner probe also showed `end: completed`, the artifact in flagged `reads`, and identical ordinary/flagged module closures. No probe changed the tracked tree.

**One-worker fix:** make an observation request join only work that can actually provide observation evidence. Ensure every requested file in an already-started unflagged tier receives a flagged run before the warm-up checkpoint completes; retain ordinary checkpoint reuse. Queue that observation work explicitly or wait for the unflagged work to finish and start an observation checkpoint. Merely switching the metadata checkpoint id or setting `force` does not fix the forced-join case.

**Done when:** hold a baseline node:test tier after options selection, issue a flagged non-forced request, release it, and assert that a completed warm-up reports its artifact. Repeat when a flagged forced request arrives during an ordinary forced checkpoint, and for an in-flight Vitest tier. Check the keys and closures stay unchanged, ordinary checkpoints still reuse results, and the metadata names the returned request id. The new `warm-up.test.ts` currently waits for baseline idle and always forces its flagged requests, so it cannot detect this defect.

## Should-fix

### S1. Proven: the D4 amendment has no entry in the amendment log

Location: `docs/specifications/001-core-loop/spec.md:82`, `docs/specifications/001-core-loop/status.md:124` (the existing runtime-observation amendment).

The candidate adds an “Amended 2026-10-13 (task 001-307)” paragraph to D4 but changes no `status.md` entry. The amendment log still describes ignored paths as a recorder blind spot without recording the warm-up exception. The status log does not name this dated exception or its consumer contract. This does not block the row's implemented D4 edit.

Fix: the coordinator adds a dated 001-307 amendment linking D4, the unkeyed metadata and the read-only consumer contract. The reviewer leaves the status and board untouched.

## Nits

### N1. Proven, resolved for verification: initial HEAD did not match the candidate

The task worktree started at `88138fd41d95730b71dcfa0665ae6ce3bfa9206a`, not `163d3e7b`. `git diff --stat 163d3e7b..88138fd4` showed only `docs/board.md` (3 insertions, 1 deletion). Before the recorded gates, the reviewer switched to a new review branch at the exact candidate and repeated `npm ci`. No evidence from the initial HEAD is used as candidate verification. No product fix is needed.

## What fits

- Honesty: the data carries its checkpoint id and request revision. It is separate from results, status counts and key provenance. No optimistic test verdict was introduced. B1 loses suggestions rather than fabricating a passing test result.
- Protocol seam: `observeIgnored` validates as a boolean; true reaches the handler, front desk thread, desk, daemon, scheduler, tier runner and both adapters through typed `FullSuiteRequest` and `RunOptions`. False/absent retains ordinary requests. The composite preserves `RunReport.reads`.
- Fresh flagged runs: the added integration tests compare every file's key and closure and every check's result with the baseline; cover slow Vitest forks and threads and a slow node:test file; retain a project preload outside the file closure; verify ordinary requests write no row; check the sorted 50-path cap and exact overflow count; and verify an ignored-file edit produces no run and leaves results current.
- Filtering and persistence: the existing recorder excludes external paths and node_modules; `WarmUp.read` filters by the tier's requested files and current git-ignore classification. A git classification failure omits the suggestions without failing or changing the tier's test report. One registered `WORKTREE_META_ROWS.ignoredReads` row per worktree replaces the prior flagged checkpoint and uses the existing cleanup registry. A later ordinary request leaves that record alone.
- Node startup order: the shared fs recorder is added before the module recorder in `NODE_OPTIONS`, only for flagged runs, after calculating the ordinary preload set. Recorder lookup and output use the existing shipped recorder. Module closures and preload attribution are unchanged in the direct control and added integration test.
- D4 names the unkeyed warm-up exception. The key-format guard was re-pinned under unreleased format 9; both plugin versions are 0.1.136 and the build reproduces both committed distributions.

## Inputs for the next wave

- Dispatch B1 as one scheduler/checkpoint repair. The warm-up metadata writer belongs in the existing tier store transaction; keep git classification outside the scheduler lock. Do not add ignored paths to `observed`, closure growth, hashes, revisions or result keys to solve missing suggestions.
- Preserve the public seam: socket request `{ type: "run-all", observeIgnored: true }`; scheduler `requestFullSuite({ force?, observeIgnored? })`; runner `RunOptions.observeIgnored`; `RunReport.reads`; consumer `readIgnoredReads(store, worktreeId)` exported from `src/core/status/index.ts`.
- Consumer order: request the observation checkpoint, wait for its result, then read metadata whose `checkpoint` equals the returned id. Treat absent, partial or mismatched records as incomplete suggestions. Each file is keyed by `<project>\u0000<path>`, stores at most 50 sorted paths, and includes `more` for the rest.
- 005 still owns CLI wiring: this range deliberately leaves `src/cli/warmup.ts`'s request/suggestion seams untouched. The 005-14 follow-up must carry the flag and consume the row; it is not a blocker against 001-307's assigned scope.
- Observation with `observe.runtimeInputs: false` remains a limitation: the Vitest adapter has no recorder and emits no `reads`; node:test flagged runs still install their recorder. The consumer must not present an empty Vitest suggestion list as proof of no ignored dependencies. Any policy override needs a separate decision that preserves keys; the current D4 policy clause says an off observer observes nothing.
