# Probes for topic `result-import` (throwaway)

Throwaway scripts for `../../result-import.md`. Not product code, not tests. Delete them freely.

- `make-fixture.sh <dir>`: builds a seven-file Vitest 5.0.3 fixture (pnpm, acorn) as a bare git origin under `<dir>`.
- `run-clone.sh <origin> <clone> [git clone flags...]`: clones, installs offline, `squeal start`, `squeal run --all --wait`, `squeal stop`, copies the store and writes `<clone>.keys.json`.
- `run-variant.sh <origin> <clone> '<shell change>'`: the same, with one change applied after the install.
- `other-user.sh <origin> <out>`: the same as the throwaway user `squeal-e2e`, with copies of this user's Node, pnpm and Squeal under `/tmp/squeal-ri-probe`; removes what it made.
- `serialized-config.mjs <clone>`: prints Vitest's `serializedConfig`; run it with and without `CI=true` and diff.
- `dump-keys.mjs <store copy>`: keys, closures, results and meta of a copied store, read-only.
- `compare.mjs <a.keys.json> <b.keys.json>`: which keys match.
- `export-size.mjs <store copy> <worktree id>`: sizes an export of one worktree's current keys.
- `import-time.mjs <store copy> <worktree id> <out dir>`: times applying that export into an empty store.

Every script writes only under `$TMPDIR` (and `other-user.sh` under `/tmp/squeal-ri-probe` and that user's HOME, both removed). Every daemon it starts is stopped with `squeal stop`. Never point them at a live store: copy it first.
