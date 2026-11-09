# Wave 5: CI export 0.1.421, second review

## Verification

Candidate: `86aae79c61e7b8e5efb49f62e7976fecc855a6d0`. `git fetch origin cand/0.1.421`, checkout of that SHA, and `git rev-parse HEAD` confirm the requested candidate. `git status --short` was empty before and after the checks and probes, before writing this file. No product code changed. The probe lived outside the project; its ignored fixture directories removed themselves. The probe script was deleted before this commit. Dependencies were already installed; installation was not repeated. No local build or full suite, as requested.

This is bounded by `reviews/wave-5-0.1.421.md`. Inspected the repair, amended D8/D9, `status.md` certification decision, `tasks/wave-5.md` section “018-17 R1”, and the worker's repair notes. The rebase's unrelated main changes are outside this review.

| Command | Actual result at this candidate |
|---|---|
| `pnpm run lint` | Exit 0: `Checked 2923 files in 3s. No fixes applied.` |
| `pnpm run typecheck` | Exit 0: `tsrs --fast --noEmit`, no diagnostics. |
| `pnpm exec vitest run test/ci/inputs.test.ts test/ci/export-evidence.test.ts test/ci/export-snapshot.test.ts test/ci/export-check.test.ts test/ci/export-keys.test.ts test/ci/export.test.ts test/cli/ci-export.test.ts test/runners/vitest/ci-runs.test.ts --maxWorkers=2` | Exit 0: **8 files, 49 tests passed**, 15.89 s. Includes the real comparison and the original B1–B4/S1 reproductions. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 src/core/ci/inputs.ts src/core/ci/export-inputs.ts src/core/ci/export-check.ts src/runners/vitest/ci-record.ts` | Exit 3 after 61.1 s. Revision 9 not fully listed; **208 pending**, 57 reported passes from revision 8 that may not cover revision 9. Worktree known failures 0. Those affected results are **unverified**, not findings. A later notification independently reports S1's `FAIL -> PASS`, inherited from worker commit `a390eecbdb2c`; this is not exact-candidate evidence. |
| `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 test/ci/inputs.test.ts test/ci/export-evidence.test.ts test/ci/export-snapshot.test.ts test/ci/export-check.test.ts test/ci/export-keys.test.ts test/ci/export.test.ts test/cli/ci-export.test.ts test/runners/vitest/ci-runs.test.ts` | Exit 3 after 61.2 s: six reported passes from revision 8; revision 9 still not listed, including the three new test files. No current verdict for the candidate; **unverified**. |
| `pnpm exec tsx /tmp/review-421-r2.mts` | Exit 0. Three real recorder/export assertions prove the continuing B1 below. In each: recorded Vitest passes, record exit 0, part `clean: true`, export exit 0 with one test file and two pass results, independent Vitest at exported content exits 1. |

CI: [42648751405](https://github.com/hearsay-tools/squeal/actions/runs/42648751405), exact candidate. Last observed: Node 24 lint/typecheck/version-sensitive job and all three Node 22 shards **in progress**. Nightly Node 24 and the bundle-version job are conditionally skipped. Exact-candidate full-suite and build/bundle checks remain **unverified**, not findings. The coordinator owns release verification.

## Verdict

**FAIL: one continuing proven blocker (B1). B2, B3, B4 and S1 resolved. No new should-fix findings or nits.**

The repair rejects the original stable `GOOD`/`BAD` mismatch. It still labels passes with content the tests did not use. Neither a hash taken after the command nor clean Git snapshots at the command's endpoints establish the content during the run. All three certification branches accept a deterministic false pass.

This is the export row's second FAIL. Per the review brief, the coordinator takes it to the human before another repair wave.

## B1 — Proven, still blocking: the certification evidence identifies endpoint content, not the run's content

Locations:

- `src/runners/vitest/ci-record.ts:122`: hashes observations in `finish`, after the project's whole command exits (`src/cli/ci.ts:104`).
- `src/core/ci/inputs.ts:196`: treats an equal recorded endpoint hash as sufficient.
- `src/core/ci/inputs.ts:199`: treats a clean shard plus the commit's blob as sufficient for an unrecorded tracked input.
- `src/core/ci/inputs.ts:200`: treats absence at the endpoints and in Git's reported entries as sufficient for an unrecorded absent input.
- `src/core/ci/export.ts:143`: uses these predicates to accept the earlier pass at the later content's key.

Vision: **“An old result never gets to pose as the current truth.”** Repair outcome: **“writes a result only when it can prove the result belongs to that content.”** The accepted status entry says a file changed by the run is left out. The following reproductions disprove that claim. They use the unchanged project-command interface, not malformed parts, forged hashes or a timing race.

### Reproduction setup

Use a fresh committed fixture with `package.json` declaring `type: module`, a Vitest config including `test/*.test.ts` with `maxWorkers: 1`, and `.gitignore` containing `data/` and `node_modules/`. Put a Node command wrapper **outside** the fixture. The wrapper starts real Vitest with inherited environment, waits synchronously for it, applies the cleanup below, and returns Vitest's exit code:

```js
const run = spawnSync(process.execPath, [vitestPath, 'run'], {
  cwd: root, env: process.env, stdio: 'inherit',
});
// Apply the mode's cleanup here, before returning to ci record.
process.exitCode = run.status ?? 1;
```

For each mode, record with `CI=true` through `squeal ci record --out <parts> -- node <wrapper> ...`, export those parts at the same commit/content left by the wrapper, then run plain Vitest there independently. The external probe calls the candidate's source CLI functions; no installed older binary supplies the export.

### A. The recorded hash certifies bytes changed after Vitest

Before the command, create ignored `data/value.txt` containing `GOOD`. The committed test reads it and expects `GOOD`:

```ts
it('input', () => expect(readFileSync(
  new URL('../data/value.txt', import.meta.url), 'utf8',
)).toBe('GOOD'));
```

The wrapper runs Vitest, then writes `BAD` to that file before exiting. Vitest passes. `finish()` records blob `a3e2920015331430cca617a24a1a50bab4ebc97f` (the blob of `BAD`), not the bytes read by the test. The part reports `clean: true` and `untracked: ["data/", "node_modules/"]`.

Export at that resulting content succeeds:

```text
Exported 1 test file, 2 results, to .../post.gz.
key: 677b52b7d5418d9a49d73a9a92f251a959820127d73afa8e40a88d679c8e4184
closure: ["data/value.txt", "test/__snapshots__/a.test.ts.snap", "test/a.test.ts"]
outcomes: ["pass", "pass"]
```

Independent Vitest exits 1: `expected 'BAD' to be 'GOOD'`. An equal hash proves only that the export job has the content seen by the later hash operation.

### B. Clean endpoints do not prove an unrecorded tracked module's content

Commit `src/value.ts` as `export const value="BAD";`. Commit a test importing `../src/value.js` and expecting `value` to equal `GOOD`.

The wrapper writes `export const value="GOOD";` **before** starting Vitest and restores the committed `BAD` text **after** Vitest. The recorded test passes. Both Git status calls see the original committed tree, so `clean` is true. The part's `inputs` contains only the absent snapshot path; Vitest's main-process transform of `src/value.ts` is not attributed to the test's observed reads.

The commit shortcut accepts `src/value.ts`. Export exits 0 with two pass rows at key `05f88e0e666338ed750d23f4bc76d539a7f91e7457d092f339092553110f1e80`, with that source in its closure. Independent Vitest at the restored commit exits 1: `expected 'BAD' to be 'GOOD'`. The command can modify and restore tracked files between clean endpoints.

### C. Endpoint absence does not prove an unrecorded module was absent during the run

Commit a test importing `../src/generated.js` and expecting its exported `value` to equal `GOOD`. The commit holds no generated module. Keep a tracked file in `src/` so the directory exists.

The wrapper creates `src/generated.ts` exporting `GOOD`, runs Vitest successfully, then removes that file before exiting. The part reports `clean: true`, only `node_modules/` as untracked, and only the absent snapshot path in `inputs`. Git never samples the generated module while it exists.

The absence shortcut certifies the export checkout's missing module and its resolution candidates. Export exits 0 with two pass rows at key `3d00340b12308ab81519461aa9f791fbf3df534d775e18a32a2f0cecae9fc64f`. The closure contains absent `src/generated.ts`, `src/generated.js` and the other resolution candidates. Independent Vitest exits 1 before collecting a test: `Cannot find module '../src/generated.js'`. Normal generate/test/cleanup commands can take this path.

### Required fix and decision boundary

Replace endpoint inference with evidence tied to the test's actual reads and module loads, plus a stability rule for inputs that can change during capture. Hashing later, comparing before/after Git status, or doing both cannot certify these cases. A write must invalidate certification even when content is restored. Absence must likewise be established for the run, not inferred from two directory/status samples. Include main-process transforms and command-level generation/cleanup in the evidence boundary.

A worker-sized conservative repair is to stop certifying any input for which that evidence is missing, and retain the file/input omission reasons. Do not remove the input from the key, widen import tolerance or weaken source-key reproduction. If preserving useful exports and the unchanged-command/cost contract requires a different capture design, the human must choose that design before work resumes. The current predicates must not be represented as proof meanwhile.

Keep these three deterministic wrapper fixtures as regressions. Each must produce no false-pass artifact, while the unchanged-content comparison still succeeds under the chosen capture contract. The review does not prescribe a broad recorder rewrite without that decision.

## Resolved findings and what fits

| Prior finding | Candidate evidence | Judgment |
|---|---|---|
| B1, original two-job stable mismatch | Real `export-evidence.test.ts` records ignored `GOOD`; export at `BAD` or absent data drops both reads and writes nothing; equal `GOOD` exports. | Original example fixed; B1 remains through A–C above. |
| B2, snapshot format ignored | Real snapshot test refuses unequal `printBasicPrototype`, names `snapshotOptions.snapshotFormat`, writes no artifact; matching format exports. Other snapshot fields are compared by hashes, with only update mode excluded and separately required to be `none`. | Resolved. |
| B3, missing shard/empty directory | Real two-shard test refuses one part alone, names the absent shard; an explicitly empty directory refuses before runner startup. Unit checks cover unequal shard counts and repeated indices. | Resolved. |
| B4, duplicate daemon check identity | Recorder names shared full names; exporter drops both different-line duplicates and same-name `test.each` files and counts the reason. No invented daemon check ID is exported. File-level omission is an accepted deviation. | Resolved. |
| S1, invalid `allowOnly` hashes | Tolerance test uses real boolean hashes and the safe false-to-true direction. Focused suite passes. | Resolved. |

The real two-shard comparison still passes. The repaired part format is `squeal-ci-part/2`, and old format 1 is refused. Config and variable values are not needed by these repairs. No key input, daemon naming or import re-keying code is changed by the repair. The settled import proof and prior key-format judgment are not reopened. No additional network/cleanup finding arose from this delta.

## Inputs for the human and next wave

- One product decision is needed: how to capture trustworthy run content while keeping D8's unchanged command and cost goals. Neither clean Git endpoints nor post-command hashes meet the stated proof contract. Do not publish this candidate's exports as certified passes.
- Preserve the completed B2/B3/B4/S1 repairs and the safe import proof. No repeat of those architecture reviews is needed unless the selected capture design changes their boundaries.
- Any follow-up must retain three wrapper regressions above, use the real recorder and CLI, and verify both result correctness and useful unchanged-content export. Returning success with zero evidence does not establish certification.
- Exact-release CI/build evidence remains the coordinator's release work. Pending Squeal/CI results do not change the proven B1 verdict. No local full suite or build is requested by this review.
