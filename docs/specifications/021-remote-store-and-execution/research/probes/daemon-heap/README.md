# Probes for research 021-27 (what fills an idle daemon; does a host grow per run)

Throwaway. Not product code, not tests. Everything ran in scratches `$TMPDIR/dh-<repo>-XXXXXX` with their own `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_CACHE_HOME` and `TMPDIR`, on shallow `git clone`s (never a worktree of a live repository), with a copy of this worktree's committed bundle (0.1.459 at `5cc5624e2`). Live daemons of other worktrees were read only through `/proc/<pid>/status` and `smaps` (`split.py`) and `squeal ps`; none was attached to, connected to or signalled. Both scratches were removed at 21:57Z; no process named them afterwards. Run Python with `-I`.

| File | What it does |
|---|---|
| `setup.sh` | Makes a scratch: clone, bundle copy in `bundle/`, `pnpm install --offline` from the host's store (files copied; `minimum-release-age=0`, as the host's metadata cache lacks the full metadata pnpm 12 checks ages from), pool 4 slots, slow lane off, idle exit 240 min. |
| `env.sh` | The isolated environment; `sq` (the copied CLI, run in the clone), `start_daemon`, `ctl <role> <command>`, `edit_and_wait`. |
| `inside.mjs` | Loaded with `--import` into the daemon and, through its `execArgv`, into its runner hosts. Logs memory and heap statistics every 15 s; on a control file runs a full GC (`gc`), a last-resort GC (`lr`), a heap snapshot (`hs`), or V8's sampling heap profiler with collected objects included (`ap-start`, `ap-stop`, an in-process inspector session, no port). |
| `split.py` | The `/proc` split of a process's resident memory: V8's 256 KiB pages, other anonymous mappings, glibc `[heap]`, mimalloc, files. `--watch` samples a pid and its descendants. |
| `dominators.mjs` | A heap snapshot's dominator tree (retained sizes, weak edges left out), and with `--by-edge` the retained size owned through named properties. |
| `strings.mjs` | How much of a snapshot's string memory is copies of one value; plain objects by property names. |
| `apsum.mjs` | Summary of a `.heapprofile`: allocation by frame and by the deepest frame in the Squeal bundle. |
| `run-edits.sh` | Question 2: edits test files in turn, waits for each verdict, marks and GCs the daemon and the Vitest host. |
| `table.py` | Per edit: memory as it stood and the live heap after the GC. |
| `drive-host.mts` | Question 3, run with `tsx`: a Vitest runner host through Squeal's own proxy; per cycle start, list, one cold edit (`invalidate`, `affected`, `closure`, `run`), two warm edits, close. |

Logs (`logs/`):

- `live-split-1.tsv`: three live cezar daemons and their hosts at 21:06Z (`/proc` only).
- Cezar, run 1 (empty store, settled): `cezar-run1-split.tsv`, `settled-gc.tsv`, `idle-gc-lines.txt`, `cezar-settled-dominators.txt`, `cezar-settled-strings.txt`, `cezar-settled-by-edge.txt`, `cezar-after-snapshot-split.tsv` (the native memory a heap snapshot leaves behind).
- Squeal (empty store): `squeal-settled-*.txt|tsv`, and the 30 edits `squeal-30-edits-host.tsv`, `-daemon.tsv`, `-split.tsv`, `-wall.tsv`.
- Cezar, runs 2 and 3 (one slot; 195 files retried, then an edit of `packages/contract/src/waits.ts` that queued 1,330 files; run 3 restarted on that state with 1,206 queued): `cezar-busy-run2-*.tsv`, `cezar-wide-edit-dominators.txt` (a snapshot 10 s after a second such edit), `cezar-busy-run3-*.tsv`, `cezar-busy-allocations.txt` (2 minutes of allocation sampling).
- `cold-start-cezar-1.jsonl`, `cold-start-squeal-1.jsonl`: `drive-host.mts` on copies of the clones.

Heap snapshots (340 to 380 MB) and the allocation profile were not kept.
