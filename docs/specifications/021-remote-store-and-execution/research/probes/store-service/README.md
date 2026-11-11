# Probes for topic store-service (021-01): throwaway

These scripts are throwaway evidence for `../../store-service.md`. No product code imports them. Delete them when spec 021 closes.

Every script reads a **copy** of a store, never a live one. The copies were made on 2026-11-11 at 12:17Z with `cp store.sqlite store.sqlite-wal $TMPDIR/stores/<project>/` from `~/projects/{squeal,cezar}/.git/squeal/`. Servers ran as throwaway containers on loopback (`--cpus 2 --memory 1g`), and were removed after the run. Node clients (`pg` 8.23.1, `iovalkey` 0.4.0) were installed with `HOME=$TMPDIR/home npm install` in `$TMPDIR/bench`, outside git. Nothing touched GitHub except one read-only `git ls-remote origin 'refs/squeal/*'` in `~/projects/cezar`.

| Script | What it shows |
|---|---|
| `q1-unserved.mjs <store copy> <repo> <days>` | Local results of the last N days by the commit class they were recorded at (clean or dirty, main first-parent or branch); current inherited states by the origin's commit class; for a store with `imports`, each import's lag after its commit, and how many live keys equal an imported key. Output: `out/q1-*.txt`. |
| `make-dataset.mjs <store copy> <out> <import id> <worktree id>` | Benchmark data from cezar's store copy: every imported result (server content), one main commit's export (24,492 results over 1,456 keys: the bulk import), one worktree's current keys (1,921: the batched lookup) and the local results at those keys. |
| `bench.mjs <data> <sqlite\|pg\|valkey\|bazel> [repeats]` | Bulk import and batched lookup against a local SQLite file, PostgreSQL 17.11, Valkey 8.1.11 and bazel-remote (HTTP `/ac/`, `CONC` requests in flight, default 16). |
| `q4-local.mjs <store copy> <worktree id>` | The real store's lookup of one worktree's keys, per key (`ResultRepo.byKey`'s query, without the `last_used_at` update) and batched. |
| `down.mjs <pg\|valkey\|http> <port>` | What each client does with its default options against a paused server and a refused port. |
| `protocols.mjs <bazel port> <turbo port> <token> <data>` | One Squeal file's results through an unchanged bazel-remote (AC validation on) as an `ActionResult`, and through `ducktors/turborepo-remote-cache` 3.0.3 as an artifact: round trip, overwrite, batch query, metadata headers. |
| `timed.sh <command>` | Runs a timing only when the one-minute load is below the CPU count, and prints the load before and after. |
| `docs-facts.md` | Quotes from the official docs and source repositories of every candidate in Q3, with URLs, commits and the retrieval date (2026-11-11). Gathered by a sub-agent of this researcher; spot-checked against `pg`'s and `iovalkey`'s installed sources and the bazel-remote clone. |

Containers used: `postgres:17` (17.11), `valkey/valkey:8.1-alpine` (8.1.11), `buchgr/bazel-remote-cache:latest` (`sha256:a8e1556c…`, built from bazel-remote `6b51e7cb`), `ducktors/turborepo-remote-cache:latest` (3.0.3, `sha256:ca6de737…`).
