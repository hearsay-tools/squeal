# Probes for topic `remote-runner` (row 019-04)

Throwaway. These scripts measured one question once, on 2026-11-03. They are evidence for `../../remote-runner.md`, not tools. Do not build on them.

- `sync.sh <repo> <work-dir> <n>`: clones `<repo>` into `<work-dir>/src`, then replays the last `<n>` first-parent commits as revisions. Per revision it measures rsync with the delta algorithm (`--no-whole-file`, as over SSH; full scan, and with `--files-from` naming the changed file) and a pushed git ref of the working tree (a commit of a temporary index, chained to the previous one; pack bytes, push, fetch and checkout times on the other side). Both ends are on this host. No network and no round trip is in any time. `EDIT_FILE` names the file the one-line edit appends to.
- `make-fixture.sh <dir>`: a 81-file repository (40 modules, 40 tests, a `package.json`) with 12 commits of one to three edited files.
- `store-revisions.mjs <store> <checkout> [days]`: opens a Squeal store read-only. Paths per watch revision, whole-file bytes of those paths (current sizes in `<checkout>`), and wall time of edit runs (no checkpoint).

Outputs: `sync-squeal.txt` (this repository at `e571d02fb`, 20 commits), `sync-fixture.txt` (fixture, 12 commits), `store-revisions-squeal.txt` (this repository's store, 30 days).

Everything else lived under `$TMPDIR/remote-runner` (clones, the synced copy with its offline install, fetched docs pages, the text-extraction helpers) and was removed.
