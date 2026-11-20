# Row 018-58 notes: `ci export` certifies inputs nothing touched (D33)

## Seams

- `src/core/ci/reuse-endpoints.ts`: the rule. `endpointHash(part, path, tree)` gives the hash at which a format 6 part's endpoint hashes certify an input it holds no read-time evidence of, or `null`. `inputsHere` runs D9 and D33 over a file's inputs and returns the inputs not certified (with why) and those the rule certified.
- `src/core/ci/reuse.ts`: `FileReuse.certify` (new; `evidence` calls it and keeps its type) and `ReuseOptions.atCommit`, the commit's tree, read once per commit. Without `atCommit` the rule does not apply.
- `src/core/ci/export-inputs.ts`: `certifier` passes `atCommit` (018-57's, in `inputs.ts`; `null` when git cannot read the commit) and returns `{ uncertified, endpoints }`.
- `src/core/ci/export.ts`: `CiExportCounts.endpoints`, the exported files with at least one input certified by the rule. `src/cli/ci-export.ts` prints it after the `Exported` line.

## The rule, as built

An input without read-time evidence in its part is certified when all hold:
- the part is `squeal-ci-part/6`, holds `touched`, and holds `stable` or `unstable` (hashed);
- the part's `header.commit` is not `null` and its tree reads;
- the input is not touched: not `"all"`, not in `touched`, no bare tree path in `touched` is it or above it (`""` is the root); a listing `dir/` is also touched by bare `dir`;
- it is not in `unstable`;
- the commit's tree holds it (`atCommit` not `null`, not `ABSENT_LISTING`): present and not ignored at the commit;
- its endpoint hash is `stable[path]` when there, else the commit's; that hash is not `null` or `ABSENT_LISTING`;
- that hash equals the content here (`hereOf`).

An input with read-time evidence is decided by D9 alone, also when it differs. `.git` is never in a tree, so the rule never certifies it.

## Decisions the spec did not settle

- The gate (`squeal code --base --parts`, `src/core/code/gate/parts.ts`) does not pass `atCommit`, so it keeps D9 alone. The coordinator chose this (2026-11-20): the gate is spec 020 code; a one-line change (`atCommit` in its `FileReuse` options) is a later row. Open question 2 stays open.
- A refusal by the rule names `ends`: "its content at both ends of the part's command is not its content here".
- The summary line: "N of them rest on inputs that nothing in their shard's command read, listed or wrote, certified by equal hashes at the command's start and end."

## Replay of cezar run 44808547913 (done-when)

Scratch under the task's `$TMPDIR`, no daemon: the run's 8 shard artifacts (format 4 parts of Squeal 0.1.522); a blobless clone of `hearsay-tools/squawk` at `d5762f11` installed with `pnpm install --frozen-lockfile` (pnpm 12.11.2, Node 26.13.0, `HOME` in scratch, `CI=true`); the candidate bundle built from `54ab5fc91` in a `git archive` copy (`tsx src/harness/claude-code/build.ts`). Host load average about 48 to 51 on 24 vCPUs. Each export took 3:20 to 4:10 and up to 3.7 GB of memory.

The parts carry no endpoint hashes, so `as-format6.mjs` (here) rewrites them as format 6 parts, as row 018-57's `ci record` would have written them if the shard's checkout had equalled the clone at both ends. `stable`: the 5 listings whose names on disk differ from the tree. `touched`: two bounds.

| Parts | Exported | Of 1,749 | By the rule | Left out for inputs |
|---|---|---|---|---|
| Original, format 4 | 1,163 | 66.5% | 0 | 583 (equal to the run's own export log) |
| Format 6, `--touched none` | 1,736 | 99.3% | 573 | 9 |
| Format 6, `--touched observed` | 1,714 | 98.0% (97.999%) | 551 | 31 |

- `--touched none` is the research's finding on a re-recorded shard 3: 0 writes and 0 conflicting reads. Its 9 left-out files each have an absent input (resolution candidates such as `omp-runner.js.json`, 3 snapshot files the commit does not hold) or `.git`: never certified by D33.3.
- `--touched observed` marks as touched every file path a part's files observed or loaded without evidence. That is too broad: modules loaded by a reader outside the hooks (Vite's native resolver) lack evidence without any write (inferred). 22 files more are left out, mostly `packages/web` files whose closures hold such a module (inferred: the research found no write or conflicting read in shard 3) (`api/reports.ts`, `components/diff/diff-view.tsx`, `api/preview-socket.ts`).
- One more file is left out for an absolute path in both format 6 runs: it reaches that check only once its inputs are certified.
- A first `--touched observed` attempt also marked listings as touched and exported only 1,364: the 0.1.522 recorder wrote some listing evidence as `dir//` (e.g. `packages/cezar/scripts/mock-skill-data//`), so listings looked unread. Listings are no longer in that bound. The real recorder marks a listing touched only when its names changed.

The spec's acceptance stays the first real merge-group run after the release (at least 98% of its Vitest files).

## Tests

- `test/ci/reuse-endpoints.test.ts`: the rule on hand-made format 6 parts (each condition, read-time evidence wins, no rule for format 5, unhashed, no commit, or without `atCommit`).
- `test/ci/export-endpoints.test.ts`: `ciExport` of hand-made format 6 parts over a real repository (count, summary line, touched, unstable, content here, format 5 equal to today, same bundle when every input was read). Helpers moved from `export-keys.test.ts` to `export-keys-kit.ts`.
- `test/ci/export-unread.test.ts`: the six fixtures of `research/unread-inputs.md` 1 through `ci record` and `ci export`, with 018-57's recorder.
- `test/ci/export-wrapper.test.ts` (unchanged) still passes: its inputs are either read by Vite or ignored (`data/`).
