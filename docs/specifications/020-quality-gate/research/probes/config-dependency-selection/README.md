# Probes for row 020-42 (throwaway)

Throwaway evidence for `../../config-dependency-selection.md`. Not product code; delete when the spec no longer needs it.

- `fixture/`: ten Vitest test files and a root `vitest.config.ts` whose imports are each one kind of config dependency (sequencer, reporter, plugin, `define` value, side effect, imported JSON, a JSON file read with `fs`).
- `edits.mjs`: one edit per dependency.
- `probe.mjs`: runs every test file once in-process, as Squeal's adapter starts Vitest, and prints `configFileDependencies`, the hash of Squeal's `canonicalConfig`, the file states, the order and the main-process V8 call counts of named config functions.
- `run-all.sh`: a fresh copy of the fixture per edit, then `probe.mjs`.
- `squeal.sh`: released Squeal 0.1.457 (`/tmp/cds/squeal`) on a git copy of the fixture: the gate (`squeal code --base HEAD`) after a shard-only edit and a control edit, and a daemon before and after the same shard-only edit.
- `guard.sh`: runs a step only while the one-minute load is below 24.
- `out/`: the outputs the report cites.

Every run uses `HOME=/tmp/cds/home` and `TMPDIR=/tmp/cds/tmp`, never the real HOME. `node_modules` is a symlink to the worktree's, made in `/tmp`; nothing installs here.
