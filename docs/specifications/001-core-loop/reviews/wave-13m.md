# Wave 13m: review of 001-199 at 0.1.89

## Verification output

Candidate: `1768d17e1b43cd28d7d7de136731f6ae8b2642a7`, equal to `HEAD` and the supplied `origin/main` when the review began. Package version 0.1.89. Reviewed range: `762d7e93..1768d17e`, especially `0f44740c` (implementation), `53428076` (pre-release pin correction), and `059eb7c0` (both plugin bundles). The board-only closeout is `1768d17e`. Linux, Node 24.21.0; selected compatibility checks and the blocker probe also ran on Node 22.23.3. All repository gates ran before this report on a clean tracked tree. The reviewer used the required independent Vitest run, not a Squeal result in its place.

```text
$ git rev-parse HEAD origin/main
1768d17e1b43cd28d7d7de136731f6ae8b2642a7
1768d17e1b43cd28d7d7de136731f6ae8b2642a7

$ npm ci
added 56 packages, and audited 57 packages in 11s
found 0 vulnerabilities
(exit 0; npm also warned that optional watcher/esbuild install scripts were not approved)

$ npm run lint
> squeal@0.1.89 lint
> biome check .
Checked 724 files in 874ms. No fixes applied.
(exit 0)

$ npm run typecheck
> squeal@0.1.89 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
> squeal@0.1.89 build
> tsc -p tsconfig.build.json && npm run build:plugin
> squeal@0.1.89 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output, exit 0)
$ git status --short
(no output)

$ npx vitest run  # required independent reviewer gate, Node 24.21.0
FAIL test/runners/node-test/graph-cost.test.ts:97
AssertionError: expected 298.0408859999998 to be less than 291.4657619999998
Test Files  1 failed | 326 passed | 1 skipped (328)
     Tests  1 failed | 2356 passed | 10 skipped (2367)
Duration 399.40s
(exit 1)

$ npx vitest run test/runners/node-test/graph-cost.test.ts --maxWorkers=1
Test Files  1 passed (1)
     Tests  1 passed (1)
Duration 4.77s
(exit 0)

$ /home/agent/.nvm/versions/node/v22.23.3/bin/node node_modules/vitest/vitest.mjs run test/keys/key-format.test.ts test/keys/environment.test.ts test/harness/version.test.ts test/harness/step-down.test.ts --maxWorkers=1
Test Files  4 passed (4)
     Tests  51 passed (51)
Duration 14.71s
(exit 0)

$ node node_modules/vitest/vitest.mjs run --root <external-copy> --config <external-copy>/vitest.config.ts
# External copy differs only in the unguarded barrier, as B1 describes.
Test Files  2 passed (2)
     Tests  33 passed (33)
Duration 2.66s
(exit 0)

$ node --import ./node_modules/tsx/dist/loader.mjs <external-copy>/outcome-probe.mts
# Node 24.21.0 and 22.23.3: equalKeys=true, keyFormat=1,
# correctedBarrierCompleted=0, changedBarrierCompleted=1,
# inheritedOutcome=pass, inheritedValidity=current, origin=inherited.
(exit 0 on both Nodes)

$ node node_modules/vitest/vitest.mjs run --root <external-copy> --config <external-copy>/vitest.config.ts -t 'is bumped whenever'
# Covered runner-comment control:
Test Files  1 failed | 1 skipped (2)
     Tests  1 failed | 32 skipped (33)
AssertionError: the key-relevant sources changed: bump KEY_FORMAT_VERSION ...
(exit 1, expected)
# Adapter-only version bump control: same failure and counts, exit 1, expected.

$ node --disable-warning=ExperimentalWarning /home/agent/.codex/plugins/cache/hearsay/squeal/0.1.86/dist/cli/squeal.mjs run --all --wait
Checkpoint d0050cfc-b80d-44d6-aace-8358d8763b2f started at revision 0: 270 test files
Checkpoint d0050cfc-b80d-44d6-aace-8358d8763b2f completed

Revision: 0
Known failures: 0
Affected checks: 2685 passed, 0 running, 0 queued, 10 skipped
Full-suite checkpoint: completed at revision 0

Worktree: /home/agent/projects/squeal/.ai/cezar/worktrees/b01589c8-e212-465b-9ae4-51aa7c3439b6 (HEAD 1768d17, dirty state not known: no revision recorded yet)
Daemon: running, last heartbeat 3 s ago
Inherited from other worktrees: 449 current results
  449 from 82233772b9682e78 at 17b0c22
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  no revision recorded for this worktree yet
  2026-10-10T00:30:16.510Z, revision 0: no dependencies are installed in this worktree; Squeal lists and runs no tests until an install
(exit 0; Known failures was read, not inferred from the exit code)
```

The independent suite is not fully green: its only failure is the timing comparison already recorded on the board's load-sensitive list. It passed in isolation on the same candidate. This is outside 001-199's implementation and is not an additional blocking finding. No test, timeout, expectation or product source was changed to make the gates pass.

## Verdict

**FAIL `1768d17e`: 1 blocker, 2 should-fix items, 0 nits.** B1 is proven on both supported Nodes. S1 is proven; S2 is plausible. The version-only hash change itself works, the one-time re-key is safe, and daemon step-down still uses the release version. The failure is the guard's incomplete coverage of the meaning of stored results: a later release can keep an unsafe cached pass after changing the code that would now withhold it.

## Blockers

### B1. Proven: the source pin misses the core that decides whether and what to store

Location: `test/keys/key-format.test.ts:21` (`KEY_SOURCES`). Its stated responsibility at line 12 is "what a key names or what result is stored under it". The brief requires "A test fails whenever the code that builds keys or results changes without a bump". The list includes runner report builders but excludes `src/core/scheduler/stability.ts:80`, `src/core/scheduler/tiers.ts:294`, and `src/core/scheduler/records.ts:56`. These are not presentation code: they respectively withhold a run after a touch, select the accepted report and storage key, and expand file errors/build the records under that key. Removing the release version makes these omissions a new cross-release cache safety gap.

Outside-repository probe, with no candidate mutation:

1. Copy `src/`, `test/keys/{key-format,environment}.test.ts`, and `test/hash/git-repo.ts` to a temporary tree. Link its `node_modules` to the candidate's installed dependencies and use a minimal external Vitest config selecting those two tests with one worker.
2. In the copied `src/core/scheduler/stability.ts` only, replace `if (touched.length === 0) return report;` with `if (touched.length >= 0) return report;`. This models a predecessor release without the completion barrier. Leave every covered source, format version and pin unchanged.
3. Run the actual copied key tests: **2 files, 33 tests pass**, including the source-pin guard. A covered runner-source comment is the control: it makes the guard fail with the expected bump instruction.
4. Feed both barrier implementations the same completed passing report and `touched = ["src/a.ts"]`. The candidate returns no completed files; the predecessor copy returns one. Compute actual `environmentHash` and `checkKey` for identical inputs, using release versions 0.1.89 and 0.1.90: equal keys, format 1.
5. Store the predecessor's `recordsForFile` output in the real SQLite result repository, then call the real `Ledger.lookup`, `settle` and `commit` with the real state sink as another worktree at that key. Its known state is **pass**, **current**, **inherited**, although the corrected barrier would have withheld that report. This proves promotion to current state, not just hash equality. The probe yields the same result on Node 22 and 24.

```json
{
  "inheritedValidity": "current",
  "origin": "inherited",
  "equalKeys": true,
  "keyFormat": 1,
  "correctedBarrierCompleted": 0,
  "changedBarrierCompleted": 1,
  "inheritedOutcome": "pass"
}
```

This is a deliberate external mutation demonstrating a missing guard, not a claim that the candidate's existing barrier is broken. A future correction to an unguarded result gate does not force old results out of the cache. That breaks the row's guard done-when and vision goal 3's trustworthy current state.

Fix for one worker: extend the guarded semantic boundary through result construction and acceptance, including their runtime helpers, rather than listing just three scheduler files. At minimum include the completion/install barriers, `recordTier`, `recordsForFile`, diagnostic construction and the input-selection helpers in the inventory below. Add mutation regressions that prove a no-bump edit to both a result writer and an acceptance gate fails, plus the corrected-release cache case above. Bump `KEY_FORMAT_VERSION` and append a new pin when this repair changes the guarded set; do not overwrite the released version's pin. Reconcile D3's source list with the actual boundary.

## Should-fix

### S1. Proven: a runner-only adapter bump also requires a global bump

Location: `test/keys/key-format.test.ts:24`, `src/runners/vitest/adapter.ts:50`, and D4's new opening paragraph. D4 says an adapter bump "re-keys this runner's checks and no other's" and permits "an adapter bump alone" for an external change to that runner's results. Both adapter constants live inside the recursively hashed `src/runners` tree.

In the external copy, changing only `VITEST_ADAPTER_VERSION = "2"` to `"3"` makes the pin test exit 1 and demand a global `KEY_FORMAT_VERSION` bump. Following that instruction invalidates node:test results too. The environment hash correctly isolates an adapter change at runtime; the guard prevents using that isolation at release time. This costs unnecessary full-suite runs, without creating a false pass, so it is not blocking.

Fix for one worker: put only the adapter version values in small, explicitly exempted version files, or normalize only those values out of the source pin, retaining full coverage of adapter logic. Test that an adapter-only bump keeps the global pin, moves that runner's keys, and leaves the other runner's keys unchanged. Alternatively amend D4 to say all adapter bumps are global, if the human accepts that cost.

### S2. Plausible: bundled dependencies and build semantics are outside both safeguards

Location: `test/keys/key-format.test.ts:21`, `src/harness/build.ts:88`, `src/runners/node-test/graph/resolver.ts:4`, and `src/runners/node-test/graph/parse.ts:1`.

The pin covers the text importing `enhanced-resolve` and `es-module-lexer`, but neither Squeal's dependency lock nor the build that embeds those implementations. A consumer's installed-dependency hash describes the consumer's install, not dependencies embedded in the separately installed Squeal plugin. `src/harness/build.ts` also decides which reporter/recorder files ship and how sources become runtime code. A dependency upgrade or build change can therefore pass this guard at format 1. An actual published dependency upgrade producing a wrong inherited result was not tested, so this is a plausible follow-up, not a second blocker.

Fix for one worker: include a version-independent fingerprint of the plugin's key-relevant runtime dependency graph and the common build semantics in the guard, excluding only the root release version. Add controls that a version-only manifest change keeps it and a bundled resolver/parser or recorder-copy change moves it. State which build-only changes are safely exempt.

## Nits

None within the reviewed range.

## Inputs to a result that the key does not directly name

The key already names the target project's environment, installed-dependency segment and closure bytes. The following inventory concerns Squeal's own implementation, whose meaning must be covered by format/adapter versions. Guard coverage is verified by reading and evaluating the actual list: **87 files, including all 61 runner files**. The source code itself is not hashed into a consumer's key.

| Semantic input | Candidate protection | Assessment |
| --- | --- | --- |
| Key encoding, environment encoding, package scans/segments, globs, closure and reverse indices | `src/core/keys/**`, except the pin, and `src/core/hash/**` | Covered. |
| Vitest loading, config normalization, transform invalidation, optimizer policy, source/config stamps, graphs, environment packages, identities, reporter and report construction | All `src/runners/vitest/**` | Covered, including new files. |
| node:test loader chain, tsconfig/resolver rules, parse/graph code, environments, process argv/options, events/identity, recorder and reporter | All `src/runners/node-test/**` | Covered source; its bundled resolver/parser implementations need S2. |
| Runtime-input injection and read/spawn/load observation, including CommonJS assets | All `src/runners/observe/**`; `RECORDER_VERSION` also participates in the Vitest adapter version | Covered source; copying those assets is outside the pin. |
| Merging reports/observations from runners | `src/core/daemon/composite-runner.ts` | Covered. |
| Runner creation, policy-to-runner wiring, separate slow instance, invalidation forwarding, child environment/cleanup and daemon scratch/cwd | `src/core/daemon/{daemon,runner,node-test-runners,slow-instance,escaped,scratch}.ts` | Outside pin. Slow-instance touch forwarding is an acceptance seam; wiring and process settings can change what executes. No additional failing release was probed. |
| Declared/observed inputs and environment growth | Listed scheduler `keying.ts`, `observed.ts`, `environment-growth.ts` | Covered entry points, not all their runtime dependencies. |
| Key input filtering and tracking: path comparison/conversion, git ignore/link rules, revision reconciliation, per-project lockfile selection, observed link targets, slow artifact selection | `core/fs/**`, relevant `core/watcher/**` and `core/revision/**`, scheduler `lockfiles.ts`, `link-target.ts`, `slow.ts`, and `core/slow/{classify,inherit}.ts` | Outside pin. The explicit claim that `slow/inherit.ts` is lookup-only is incorrect: `WorktreeKeys.#artifactRule` calls it to decide which ignored declared files enter keys. |
| Post-run validity: disk/touch/install barriers, growth rejection, acceptance and storage-key selection | Scheduler `stability.ts`, `install-stamp.ts`, `tiers.ts`, their orchestration in `scheduler.ts` | Outside pin; B1 proves the completion-barrier case. |
| Result construction and interpretation: file-error expansion, failure summary/fingerprint, persistence codec and outcome handling | Scheduler `records.ts`, `store-results.ts`, state `fingerprint.ts` and its text helper, store result/codec code | Outside pin. These can change the meaning of stored fields; schema migrations need their own compatibility discipline too. |
| Policy parsing and effective defaults/runtime policy helpers | Listed daemon `policy{,-slow,-node-test}.ts`; defaults in `core/types/policy.ts` and runtime lane helpers in `core/types/runner.ts` | Parsers covered; defaults/helpers outside pin. Audit the semantic values, rather than counting type-only declarations as behavior. |
| Plugin bundling/copying and embedded third-party runtime implementations | `src/harness/build.ts`, dependency lock and relevant dependency code | Outside pin; S2. |
| Release version, commit, worktree, revision, logging/delivery/status formatting | Release version deliberately removed; provenance retained; D10 still reads the release version | Correct exclusions where they affect provenance/presentation only. Pure UI/delivery edits should not force a format bump. |

Load, clocks, randomness, network, native/non-Node reads, ignored/out-of-worktree runtime reads and unallowlisted environment are the already stated incomplete-closure boundaries, not new findings against this row. A guard cannot make those deterministic.

## What fits

- Environment hashing substitutes the integer format version in the exact slot that previously held the release string. JSON distinguishes the new number from every old version string, so the initial switch invalidates old results once.
- The release version still travels through `CoreEnvironmentInputs`, daemon identity/status, bundled `__SQUEAL_VERSION__`, hook comparison and step-down. The changed environment function alone stops hashing it. Selected Node 22 version and hook step-down checks pass; the full suite supplies the Node 24 evidence recorded above.
- The actual guard catches covered content, additions and renames, normalizes CRLF, and skips only its pin within the covered key directory. The runner-comment negative control fails with the useful bump message.
- Both shipped plugin builds match committed output at the candidate. No product, board or spec file was changed during this review.

## Inputs for the next wave

Dispatch one guard-boundary repair for B1, with the external completion-barrier sequence as its regression. Include the transitive semantic helpers in its ownership and preserve the separation between presentation-only changes and result meaning. Its release must advance the global format once and keep historical pins intact; if format 1 has never shipped, the coordinator can explicitly decide whether an unreleased pin correction is safe, as it did for `53428076`. Fold S1's adapter-only exception and S2's build/dependency policy into the brief or explicitly defer them with the human's cost decision. Keep release-based daemon step-down and target-environment hashing unchanged. B1 blocks approval of the promised cross-release cache guarantee; no existing transform/recorder/reporter implementation needs re-prosecution beyond this boundary.

All external probes and temporary verification logs were removed after their evidence was transcribed. Only this findings file is committed.
