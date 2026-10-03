# Throwaway probes: result-fingerprinting-prior-art

Everything in this folder is throwaway. It exists only to back findings in
`../../result-fingerprinting-prior-art.md`. It is not product code and must not
be imported, built or maintained.

- `hash-cost.mjs`: cost of per-file hashes from the git index vs hashing in Node,
  new-worktree inheritance of index oids, and closure-hash recompute cost.
- `testmon-fsha.py`: checks whether testmon 2.2.0's fallback file hash equals the
  git blob id it is compared against.
- `store-size.mjs`: size of a SQLite result store for 5,000 tests and 50 revisions a day.
- `vitest-related-gaps.sh`: which dependency kinds `vitest related` (5.0.3) misses. Builds
  its fixture in `/tmp`.
- `results.txt`: raw output of the runs quoted in the findings.
