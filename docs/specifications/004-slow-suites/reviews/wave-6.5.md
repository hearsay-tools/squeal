# 004 wave 6.5 review

## Verification

Candidate: `c764599e`, version 0.1.91. Range: `003248a8^..c764599e` (004-57, D8 amendment and both plugin bundles). Initial HEAD was `ec906520`, one documentation-only commit beyond the candidate. All checks and probes below ran after checking out the exact candidate, on a clean tracked tree. The final report is committed on the assigned branch, retaining its task instructions. There is no remaining executable mismatch.

The independent reviewer gate uses direct Vitest, as the reviewer skill and repository instructions require. Squeal's checkpoint is recorded separately. No product, test, policy, board or status changes were made.

Node `v24.21.0`:

```text
$ npm ci
added 56 packages, and audited 57 packages in 2s
18 packages are looking for funding
found 0 vulnerabilities
exit 0

$ npm run lint
> squeal@0.1.91 lint
> biome check .
Checked 732 files in 188ms. No fixes applied.
exit 0

$ npm run typecheck
> squeal@0.1.91 typecheck
> tsc --noEmit
exit 0

$ npm run build
> squeal@0.1.91 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.91 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0

$ git status --short
(no output)
```

Installation warned about optional watcher/esbuild install scripts not covered by `allowScripts`; installation and the build succeeded. The build reproduced the committed Claude Code and Codex plugins without drift.

```text
$ npx vitest run
Test Files  2 failed | 327 passed | 1 skipped (330)
     Tests  2 failed | 2364 passed | 10 skipped (2376)
  Duration  394.26s
exit 1
```

The independent full gate is **not green**. Its failures are `test/harness/stop.test.ts:176` (1,900.72 ms against a 1,875 ms limit) and `test/watcher/linked-dirs.test.ts:64` (the first startup batch held only `lib`, not `lib/a.ts`). These tests and their underlying Stop/watcher code are outside this range; the Stop fixture declares no slow tier. Both changed status regression files passed. Load rose from 34 to over 100 during the run. Attribution to 004-57 is **unverified**, not blocking. The isolated rerun below does not erase these initial failures.

The repository-required Squeal checkpoint completed on the same clean candidate. It uses the installed 0.1.86 daemon to validate the candidate's tests and bundles, and is not the independent reviewer gate.

```text
$ timeout 600 node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.86/dist/cli/squeal.mjs run --all --wait
Checkpoint b2f92021-6b92-4b90-90cb-d9edf0778105 started at revision 1: 200 test files
Checkpoint b2f92021-6b92-4b90-90cb-d9edf0778105 completed
Revision: 1
Known failures: 2
  FAIL test/daemon/step-down.test.ts:150
       expected [ 'unavailable' ] to deeply equal [ 'alive' ]
  FAIL test/integration/node-test.test.ts:274
       expected [ 'packages/a/test/one.test.ts' ] to deeply equal
       [ 'packages/a/test/one.test.ts', …(1) ]
Affected checks: 2694 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 1
HEAD c764599, clean at revision 1
exit 0
```

The checkpoint reuses current results, hence 200 files requested from 330 listed. Its exit 0 does **not** mean a clean suite: its `Known failures: 2` line is the verdict to retain. Those two test files passed in the independent full Node 24 run. Their daemon step-down/confirmation-rerun behavior and tests are outside the slice; attribution to 004-57 is **unverified**, not blocking. Squeal also reported two initial observed-growth failures (the held-baseline poll and `database is not open`), then reported both recovering under identical inputs with its flaky note. No product or test fixes were attempted, and no extra reruns were requested to hide these checkpoint failures.

```text
$ npx vitest run test/harness/stop.test.ts test/watcher/linked-dirs.test.ts test/status/slow-tier.test.ts test/status/slow-tier-truth.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  4 passed (4)
     Tests  56 passed (56)
  Duration  38.22s
exit 0

$ PATH=/home/agent/.nvm/versions/node/v22.23.3/bin:$PATH npx vitest run test/status/slow-tier.test.ts test/status/slow-tier-truth.test.ts --maxWorkers=1 --no-file-parallelism
Test Files  2 passed (2)
     Tests  44 passed (44)
  Duration  21.61s
exit 0
```

Both independently failing Node 24 files pass in isolation. Node 22's status run prints experimental proxy/SQLite warnings but has no failures. No further full-suite run was made to overwrite the initial failing evidence.

The discriminating proof imports the freshly built product `dist`, opens a real private SQLite store under `/tmp`, and exercises `readSlowTier`, including recorded artifact declarations and revision/content comparison. Its slow node:test-shaped file reads only `packages/widget/dist/**`. It seeds combined closures independently of the candidate's tests. No probe uses this repository's store, starts a daemon, accesses the prohibited other repository or burns CPU.

```text
$ node --disable-warning=ExperimentalWarning /tmp/<private>/probe.mjs
PASS private real-store dist-only proof
exit 0

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node --disable-warning=ExperimentalWarning /tmp/<private>/probe.mjs
PASS private real-store dist-only proof
exit 0

Private compiled negative control, Node 24:
restore the predecessor's global fast-input rejection in artifactSources
AssertionError: dist-only e2e, source imported by unit and declared by another
false !== true
exit 1 (expected)
```

Node 22 also emitted its experimental `UNDICI-EHPA` warning; it did not fail this probe. The positive proof covers fast and slow independent imports, another file's broad source declaration, fixtures/docs declared by their only owner, recorded artifact paths, test files, slow directories, policy, foreign project rows, overlapping input rules, same-path project identities and source reverts with fixture/doc edits still present. It also verifies both accepted boundary cases: a declaration-only source is excluded, and a runtime-loaded fixture/doc named by an owner without an applicable own declaration is admitted. The compiled negative control changes only a private copy, not the tracked candidate.

An independent repository survey opens the candidate's real Vitest adapter, obtains fresh closures for all 330 listed files, merges each file's own declarations over tracked paths, and stores them in a private store. It transforms imports but runs no tests. Both plugins' entry points are also bundled with `write: false` and a metafile to identify actual build inputs.

```text
Fresh adapter closure survey; no test execution and no shared-store access
listed files=330
src/: before=0 after=297 total tracked=330
test/fixtures/: before=18 after=0 total tracked=279
docs/: before=0 after=0 total tracked=1157
Actual bundle inputs: 308 src paths; missed by D8=20
exit 0
```

These are fresh static-closure counts over tracked files, not the implementation worker's warm-store survey. Observed runtime reads, missing resolution candidates and stale stored closures can make those populations differ. The survey does not claim to reproduce the worker's 331/359 count or its 69 fixture/2 doc population.

## Verdict

**PASS at `c764599e` (0.1.91).** Zero blockers, zero new should-fix findings, zero nits. The original cross-file exclusion in `reviews/wave-6.md` S1 is closed within the amended D8 definition. This is the first review of 004-57, bounded by S1 and the new delta. Earlier settled findings and other lanes are outside the range.

PASS is the bounded review verdict. The initial independent full-suite gate failed, and Squeal completed with two known failures. Passing isolated reruns do not make either original gate green.

## Blockers

None.

## Should-fix notes

None added. The coverage limits below follow the accepted amendment and are not implementation deviations or newly blocking findings.

## Nits

None.

## What fits, and the limits of the claim

- **S1 closed, proven on Node 22 and 24:** `src/core/state/slow-sources.ts:90` filters stored rows by the listed `(project, path)` identity. At `:94`, it compiles only that row's own applicable declarations, then subtracts them from that row's own closure. At `:95`, the remaining paths join a union. A declaration belonging to another file cannot remove a path already contributed by an independent undeclared owner. The dist-only proof has a unit import plus a loader's broad declaration, and then a slow import plus that fast declaration. Both turn the clause on behind an unchanged artifact. Restoring the old global rejection makes the first case fail.
- **Fixtures/docs controls, proven:** the private store's fixture and doc named only by their declaring file leave the clause off; changing both and reverting the independent source clears it. On the fresh repository graph, no tracked `test/fixtures/**` or `docs/**` path is admitted. This is a rule about closure ownership, not path names: a fixture or doc actually loaded by an undeclared owner counts under amended D8. The proof confirms that boundary rather than claiming an unconditional fixture/doc exclusion. It is not a new deviation.
- **Content/provenance and other exclusions, proven:** the change leaves `sourcesChanged` intact (`slow-sources.ts:31`): it compares each path's first old and last new hash after the current slow result's revision, excludes the policy and recorded artifact globs, and clears the clause after a source revert. The existing test-file/slow-directory exclusion at `:75` still applies. No keys, inheritance rules, result validity, slow scheduling, public type or store schema changed. Status/header callers still construct the source predicate within their existing snapshot.
- **Not every build source is covered, proven and conforming to D8:** the fresh graph admits 297 tracked source paths; esbuild consumes 308 source paths and 20 of those are not admitted. The missed inputs are `src/cli/index.ts`, `src/core/daemon/front-desk.ts`, both harness `main.ts` files, all seven Claude Code hook entries and all nine Codex hook entries. These are selected by broad declarations but no fresh independently undeclared test closure names them. They are executable build inputs, not merely type-only paths. Five additional copied runtime sources (`src/runners/node-test/runtime/{recorder.cjs,reporter.mjs}` and `src/runners/observe/{fs.cjs,recorder.cjs,spawn.cjs}`, copied by `src/harness/build.ts:135` and `:148`) are also excluded by the fresh graph. A change to these paths behind an unchanged artifact can leave the clause off. A dist-only layout with no independently undeclared source closure has the same limit. D8 explicitly defines sources through qualifying stored closures, and the new regression explicitly preserves a source named only by declaring owners (`test/status/slow-tier-truth.test.ts:252`). The earlier review already settled paths no qualifying closure names as outside that policy. This review does not reopen that decision or turn the advisory clause into a build dependency graph.
- **Scope and test quality, proven:** the added regression models combined closures for an overlapping broad declaration and exercises the emitted line, with both fast and slow importing owners and the fixture-only control. Existing 004-55 and content/revert cases remain unchanged. The rebuilt bundles and versioned manifests agree at 0.1.91. No new runtime dependency or interface change.

## Inputs for the next wave

1. No repair wave is required by this review. The coordinator owns acceptance, release, board and status changes.
2. The answers to the brief's two questions are bounded: another file's declaration cannot erase an independently undeclared owner's path; the clause does **not** cover every actual build input. Fixtures/docs stay off when every naming owner declares them, or no qualifying closure names them. Preserve those qualifications in any release claim.
3. Broader coverage would first require a policy/design amendment giving build-only paths independent source evidence. Recording resolved imports apart would distinguish a file's own imported-and-declared paths, but would not itself discover unimported build entry points. That is outside 004-57's chosen rule and needs coordinator ownership, not a status-only repair here.
4. Preserve the verification caveats above. Passing isolated reruns or a Squeal checkpoint do not erase an initially failed independent full gate. The full Node 22 suite and macOS are unverified by this review.

The review commit changes only this findings file. All private probe stores, scripts, compiled controls and survey scratch were removed before committing.
