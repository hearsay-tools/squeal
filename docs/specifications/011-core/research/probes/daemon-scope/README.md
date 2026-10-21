# Probes for research 011-52 (daemon scope)

Throwaway. Not product code, not tests. Every script reads the live host only through `/proc` and stores opened `mode=ro`. None of them opens a socket or signals or renices a process. Run Python with `-I`.

| File | What it does | Output |
|---|---|---|
| `daemons.py [--smaps]` | One row per live Squeal daemon: version, root, store, age, CPU, private memory, swap, smaps split (JS heap as 256 KiB mappings, mimalloc, glibc), threads, descendants' memory, and from its store: test files, revisions, consumers, slow tier, open runs | `snapshot-1.json` (09:28:40Z, load 26.7) |
| `sample.py <step> <count>` | Every daemon's private memory, swap and CPU ticks every `step` seconds, with the one-minute load | `samples-1.tsv` (20 s × 60, 09:29Z to 09:49Z, load 21.8 to 46.8) |
| `usage.py <common-dir>...` | Per repository since 2026-10-13: activity spans, worktrees live and active at once, quiet time, shared commits, shared keys | `usage.txt` |
| `estimate.py <snapshot> [fixed] [floor]` | Arithmetic over a snapshot: what designs (a) to (d) remove | `estimate.txt` (fixed 90 MiB; floors 45 and 26 MiB) |
| `run-two-roots.sh` + `two-roots.mjs` | Scratch under `/tmp/ds-scope-*` with its own `HOME`, `XDG_*` and `TMPDIR`; installs vitest@4.1.10 there; two copies of a two-file project (4 test files). Runs bare Node, one Vitest instance, and two instances (root B with the cwd at A, then at B) in one process, and prints private memory and `process.memoryUsage()` after GC. The scratch is removed on exit | `two-roots.txt` (load 23.9) |
| `docs-quotes.md` | Quotes from the official docs fetched with curl for question 6 | |

No Squeal daemon of my own was started. The two-roots probe starts no daemon and leaves nothing behind (`ls -d /tmp/ds-scope-*` finds nothing).
