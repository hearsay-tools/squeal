# Wave 4 re-review: manifest chains and CI evidence

FAIL `389e7febb5b0be4dd2cdc436f1cb2879bf2723c5`

**1 proven blocker in the CI-hook repair, 0 should-fix, 0 nits.** Both original missing-manifest restart cases are repaired. The new CI hook can still export a pass for the wrong manifest state. This review covers `wave-4.md` B1/B2 and the repair delta expressly named in the re-review brief. Unchanged areas and the held relative shadow-path half were not re-prosecuted.

HEAD matched the requested candidate, and the tracked tree stayed clean through verification. Lint, typecheck, build and the private-material check passed. Nine named Squeal test files are current/pass. Exact-candidate full-suite CI remains in progress; it is not claimed as passing.

## Blocker

### B1-CI. Proven: the end-of-run manifest scan certifies content that resolution did not use

**Location:** `src/runners/vitest/ci-runtime/vitest-ci.cjs:161` reads manifest content only when `onTestRunEnd` calls `readManifests` at line 186. Vite's earlier native resolution is outside the evidence hooks, as the new helper's comment states.

**Contract:** The requested CI path must retain valid chain results and refuse chain changes. Spec 018 D9 requires the shard's read-time evidence to certify the content used by its result. `docs/styleguide.md`: “Record a fact where it is known; never infer it later from something that does not prove it.” A read after the test proves what is on disk then, not what Vite resolved earlier. This failure is on the newly added repair path, not a request to broaden manifest or shadow-path scope.

**Concrete proof:** Use the same B1 chain, `#chosen` to a linked workspace package whose `exports` selects `a.ts` or `b.ts`. Both modules exist throughout. The committed manifest selects `a.ts`. The test expects the selected value to be `"b"`. It also statically imports and checks both source modules, so all source paths have genuine read evidence under either mapping.

1. Begin `squeal ci record` on the clean committed A tree. Its recorded command is a Node wrapper that asks `sh` to set the workspace manifest to B, then starts real Vitest with `--update=none`.
2. Vite resolves the test's `#chosen` at B. In the test body, `sh` restores the manifest's exact committed A bytes. The test then asserts the already imported value is `"b"`, and passes. The shell write is not a wrapped Node `fs` write; this is the same supported discriminator used by `test/ci/export-wrapper.test.ts`.
3. `onTestRunEnd` scans the manifest after restoration. It records only A as evidence for that manifest. Git reports a clean fixture tree after the recorded command.
4. `squeal ci export` at A exits 0 and exports the test's pass. An independent plain Vitest run at that same A tree fails: `expected 'a' to be 'b'`.

```text
record:       exit 0; wrote 1 part with 2 test files
git status:   empty after the recorded command
export:       exit 0; Exported 2 test files, 4 results
export paths: test/late.test.ts, test/plain.test.ts
plain Vitest: exit 1; test/late.test.ts > value
              expected 'a' to be 'b' // Object.is equality
```

The unrelated plain test remains exported, as the control requires. Both source targets are deliberately loaded, so a missing source-file certificate cannot mask the bad manifest certificate. The false export occurs with no coverage records; `squeal ci record` explicitly reports that its records worker is unavailable in this source-driven probe. Exporting without records is supported and does not relax D9's content rule.

**One-worker repair:** Change only the CI manifest-evidence seam and its regression tests. Do not let the final scan serve as proof of a native resolver read. Capture the manifest state at the resolution boundary, or leave affected files uncertified when that evidence is unavailable. A comparison of command endpoints is insufficient. Preserve same-content chain exports, changed-chain refusal, installed-package exclusion and the bounded folder walk. Add the shell-restoration fixture above to the CI export regression tests, alongside the existing stable chain cases. Its export must omit `test/late.test.ts` while retaining `test/plain.test.ts`. No format raise or relative shadow candidates are required by this finding.

## Previously blocking findings

| Prior finding | Result at this candidate |
| --- | --- |
| B1: `#chosen` into a workspace package omits that package's `exports` manifest | **Repaired for closure/restart keying.** The independent original fixture now contains the target manifest, changes its key on retarget, reports stale on lookup-only restart, and fails after a fresh real walk/run. The CI evidence path remains blocked by B1-CI above. |
| B2: workspace subdirectory import omits its nested `main` manifest | **Repaired.** The independent original fixture now includes the nested manifest, changes its key, reports stale on restart, and fails on a fresh real walk/run. The new integration cases cover present and absent nested manifests, undo reuse, and second-worktree reuse/refusal. |

## Verification

All product checks, external probes and the read-only count ran at `389e7febb5b0be4dd2cdc436f1cb2879bf2723c5` before this findings file was written, with a clean tracked tree. Test fixtures used the existing helpers' ignored scratch repositories. External probe source and scan snapshots were removed before commit. No product file changed. No local full suite or full-suite checkpoint was requested.

The candidate rebases the manifest implementation onto main `7e28ddf88d7757f71155fec4d00fd1b50d410282`. Relevant repair commits are `f3603fd2a` (B1/B2 and re-resolution test), `4bd2dce1d` (CI manifest scan), `f7011b012` (`exports` root-only rule), `a1aac8e6d` (notes), and `389e7febb` (version/bundles). Unrelated main changes are not re-reviewed here.

| Command or evidence | Actual result |
| --- | --- |
| `git fetch origin`; `git checkout --detach 389e7febb5b0be4dd2cdc436f1cb2879bf2723c5`; `git rev-parse HEAD` | Exit 0; exact requested candidate |
| Dependency setup | Retained the installed dependencies supplied at launch; did not repeat setup, as instructed. |
| `pnpm run lint` | Exit 0: `Checked 3612 files in 1279ms. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit` |
| `pnpm run build` | Exit 0: TypeScript build and Claude Code, Codex, Pi and OpenCode bundle builds; `git status --short` stayed empty |
| `pnpm run check:private`, before findings | Exit 0: `private: 6361 added lines in 56 files over 7e28ddf88d7757f71155fec4d00fd1b50d410282, ok`. Warning: `SQUEAL_PRIVATE_DENYLIST` is empty, so that optional denylist rule was skipped. The structural private-material rules ran. |
| `git diff --check e658d307a HEAD` | Exit 0, no output |
| Squeal affected-source wait below | Exit 3 after 61.1 s: 646 selected files, 36 current/pass, 610 pending. Broader affected results are **unverified**; no known failure was reported. The checkout itself queued affected work; no full-suite request was made. |
| Squeal nine named files below | Exit 0: `Named test files at revision 5: no known failures; 9 test files, each with a current result, after 26.2 s.` Whole tree: 658/1918 not current (4 running, 654 queued). Content-key reuse is included; this is not a fresh full-suite claim. |
| Original B1/B2 external probes | Both **passed** in the three-test external run. The CI case stopped at a fixture cleanliness assertion because Vitest made untracked `node_modules/.vite/`; that was a probe setup error. Total: 2 passed, 1 failed, 6.26 s. |
| Focused CI follow-up after ignoring only `node_modules/.vite/` | Exit 1: 1 failed, 2 skipped, 5.41 s. The failed assertion is that the export must omit `test/late.test.ts`; it instead exports its pass. This is B1-CI, independently checked against plain Vitest's failure at A. |
| Read-only re-key count | Exit 0: Squeal 1,935 present stored test-file paths, 44 candidate additions solely through declared fixture `test/fixtures/node-test/edge/test/forms.test.ts`, hence **0 walked additions**; squawk 1,902 paths, **109** candidate additions. No format or adapter-version raise. |
| Exact-candidate CI, checked 2026-11-17 10:41 Europe/Warsaw | [Run 44056544295](https://github.com/hearsay-tools/squeal/actions/runs/44056544295): Node 24 lint/typecheck/version-sensitive/build job passed; six Node 22/26 shards still in progress. Full-suite CI **unverified**. Private-material run `44056544284` passed. |

Commands used for affected results and the discriminating probe:

```sh
SQUEAL=~/.codex/plugins/data/squeal-hearsay/bin/squeal
"$SQUEAL" status --wait 60000 \
  src/runners/vitest/resolution-inputs.ts src/runners/vitest/ci-runtime/vitest-ci.cjs \
  test/runners/vitest/resolution-inputs.test.ts test/runners/vitest/reresolution.test.ts \
  test/ci/resolution-import.test.ts test/integration/resolution-inputs.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts test/version-sensitive.test.ts

"$SQUEAL" status --wait 60000 \
  test/integration/resolution-chains.test.ts \
  test/runners/vitest/resolution-inputs.test.ts test/runners/vitest/reresolution.test.ts \
  test/ci/resolution-import.test.ts test/integration/resolution-inputs.test.ts \
  test/keys/key-format.test.ts test/runners/boundaries.test.ts \
  test/version-sensitive.test.ts test/ci/export-wrapper.test.ts

# Each direct probe ran through hsq job start:
timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs
timeout 600 pnpm exec vitest run --config <scratch>/vitest.config.mjs -t 'CI late scan'
pnpm exec tsx <scratch>/rekey.mjs
```

The re-key script reads SQLite in `mode=ro`. It scans existing closure paths, supplies each source's latest stored direct-import targets from `test_file_imports`, and invokes the candidate's `moduleResolutionInputs` once per unique source. It counts closure lists missing any returned manifest. As in the worker's method, this is an upper bound that also parses declared inputs, not a fresh daemon key census. An initial measurement launch preceded completion of its scratch-script writer and exited with `ERR_MODULE_NOT_FOUND`; the reported count is the completed run after the script existed.

## Should-fix and nits

None outside the blocker.

## What fits

- The B1 repair retains exact/pattern `#` specifiers, follows bare `imports` targets and includes their project manifests. The B2 repair records the subpath folder manifest and the target's nearest manifest chain for packages without `exports`.
- The `exports` correction adds only the package's root manifest for its exported subpaths. The own-package lookup retains its nearest-manifest chain. This avoids the large re-key noted in the worker's intermediate measurement and preserves the independently checked 109-file count in squawk.
- `reresolution.test.ts` deliberately marks six manifest cases as keyed. It now checks closure membership and reverse-index selection for them, while retaining the original unkeyed relative-directory cases, resolver invalidation, changed target and real-run assertions. The test passes; the old CI failure was a stale expectation, not a product regression.
- The chain integration tests cover retarget, a newly added nested manifest, undo without a run, same-content worktree inheritance and changed-worktree refusal. The CI tests cover stable exports for all chains and refusal after committed B1/B2/absent-manifest changes. These all pass. They do not cover a manifest changing during the recorded run before the final evidence scan.
- The CI scan is bounded to project-module folders and their parents, deduplicates folders, and excludes paths under `node_modules` and outside the root. Its problem is when the evidence is taken, not the installed-dependency boundary.
- Key-format, version-sensitive and runner-boundary checks pass. Existing core commit lookup, checkout, scheduler, status and delivery interfaces were not changed by this repair.

## Inputs for the next repair

Own `src/runners/vitest/ci-runtime/vitest-ci.cjs` and the corresponding CI evidence/export regression. Retain the repaired adapter closure rules and the current parser/target argument order. Use the shell-restoration case to distinguish read-time evidence from endpoint content; both imported source targets must stay loaded in the fixture. The result must be uncertified unless the recorded manifest state is the one resolution used. Keep the existing stable-chain CI controls and installed-package exclusion. Use affected Squeal results and `timeout 600` for direct probes; no full suite. Rebuild bundles and verify `check:private` before the next candidate review. Exact-release full-suite CI remains the coordinator's release requirement.
