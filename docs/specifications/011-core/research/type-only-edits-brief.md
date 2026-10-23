# Research brief 011-149: edits that change only types or comments

Use /researcher. Shape: research. Outcome: how often an edit leaves the code a test executes unchanged, what a key on the executed code instead of the source text would save, and every way it could hide a real change.

## Why

The human (2026-10-23) chose to explore what `research/edit-load.md` (row 011-143) points at. There, 13.8% of the re-run test time after edits to squeal's widely imported modules sat on edits that changed only types, which no test executes; in squeal every `src/**/*.ts` file is in at least 94 closures. A key over each import's executed code (the JavaScript a runner gets after type stripping) would re-key nothing for such an edit.

## Read first

`research/edit-load.md` (findings 1 and 3); `research/central-edits.md`; `research/key-format-guard.md`; 011 C3 (keys, blob hashing, closures), C12, C14; 013 V3 and V4 (Vitest's transform); 003 (node:test, type stripping).

## Questions

1. **How often.** Over the real edits in copies of the squeal and cezar stores (and toolkit-dev's TypeScript): the share of source edits whose emitted JavaScript is unchanged, or changed only in positions, under the transform each runner applies (Vite 8 / oxc for Vitest, Node 24's type stripping for node:test); their re-run recorded seconds.
2. **What else can differ.** Cases where emitted code is the same yet a test's outcome can change: line numbers in stack traces, snapshots and error locations; `import type` elision and module side effects; enums, namespaces, decorators and parameter properties that emit code; tests that read source text, run `tsc`, or bundle; source maps. For each, an example, and whether those tests must keep raw bytes.
3. **Mechanism.** Where the key hashes source today, which transform to hash per runner, the cost per file and revision, caching by blob hash, and how a test that reads a file keeps its key on the raw bytes.
4. **Key format.** What 011-37's rules say for this change (one re-key at its release) and how the cross-release comparison would cover it.
5. **Measured saving.** Replay the store's edits with keys on the emitted code: files that no longer re-key, CPU-seconds saved, and every FAIL transition of the 72 hours that would have been missed (expected none; explain any).

## Rules

As in `research/edit-load-brief.md`: store copies only, clones under `/tmp` with scratch homes, `PLUGIN_ROOT` and `PLUGIN_DATA` unset, nice 10, at most 4 workers, nothing between 06:45Z and 07:30Z, never `evals/bin/` or `tasks/*/probe/` scripts, clean up at the end, tag every finding. Budget about four hours.

Own `research/type-only-edits.md` and `research/probes/type-only-edits/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 5 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
