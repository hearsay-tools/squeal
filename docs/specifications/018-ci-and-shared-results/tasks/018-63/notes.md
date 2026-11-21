# 018-63 notes: `ci export --parts` takes a part file

Worker 28d46390, 2026-11-21. Wave 21. For the reviewer and whoever folds.

## Where things are

| Part | File |
|---|---|
| `readPartsIn` | `src/core/ci/parts.ts` |
| `ciExportCommand` | `src/cli/ci-export.ts` |
| CLI and helper tests | `test/cli/ci-export.test.ts` |
| Directory-only helper tests (unchanged) | `test/code/gate/parts.test.ts` |

`squeal code --parts` still calls `readPartsIn`. A file path now reads as that part. A missing path still returns `no directory ${path}` (the gate's existing test).

## What changed

`readPartsIn` used `existsSync` then `readdirSync`. A file path threw `ENOTDIR`. It now `statSync`s with `throwIfNoEntry: false`: a file is `readPart` of that path; a directory is the old `squeal-part-*.json` listing; missing or neither is `no directory ${path}`. A file that is not a part returns `readPart`'s one-line reason.

`ci export` maps those strings: empty directory still exit 1 (`wrote nothing`, review of 0.1.421 B3, `test/ci/export-evidence.test.ts`); missing path, non-part file, or other non-directory is one line plus usage and exit 2.

## Decisions the spec did not settle

- **Usage still says `--parts <dir>...`.** Help, parse errors, and `EXPORT_USAGE` stay as they were. A file is accepted at the same flag. Changing the usage string would also change `src/cli/main.ts` and `test/cli/ci-usage.test.ts`, which this row does not own.
- **A named file need not match `squeal-part-*.json`.** The prefix filters only a directory listing. Passing the file itself is enough.
- **Empty directory stays exit 1.** The brief's exit 2 is for a path that is neither a directory nor a part file. An empty directory is still a directory of parts with none in it.
- **Missing path keeps the `no directory` wording.** Existing tests in `test/code/gate/parts.test.ts` and the old CLI test named that string. A new "no path" line would change the gate without this row owning it.

## What the next worker must know

- Gate `--parts names no directory` is still `src/cli/code-gate-args.ts` (018-61 does not own it either). The gate already treated a `readPartsIn` string as setup error exit 2.
- `src/cli/ci.ts` is 018-61. `src/runners/*/ci-runtime/` is others.
- A sibling empty-parts export (`test/ci/export-evidence.test.ts` B3) still expects exit 1; do not fold this as "all `readPartsIn` strings are 2".
