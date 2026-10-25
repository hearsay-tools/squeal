# Probe: does the validity driver run `assemble` in its child? (row 015-58)

Throwaway. Read-only on every Squeal store. `out/` is not committed.

- `store-read.mjs`: reads the coordinator worktree's states, loaders, records
  and transitions from `<common-dir>/squeal/{store,code}.sqlite` with
  `node:sqlite` `readOnly: true`. Output: `store-read.out.txt`.
- `child-run.sh`: bundles `test/keys/validity/driver.ts` as one plain esbuild
  bundle with a source map, writes the corpus's `assemble` cases to JSON, runs
  the bundle in one `node` child with `NODE_V8_COVERAGE` and a scratch `HOME`
  under `/tmp`, and maps the child's V8 functions back to `assemble.ts`
  (`map-child.mjs`).
  Output: `child-run.out.txt`.
