# Probes for research 017-26 (where the lint daemon's memory goes)

Throwaway. Not product code, not tests. Everything ran in the scratch `/tmp/lint-memory-b8bcebbe` with its own `HOME`, `TMPDIR`, `XDG_*`, corepack home and pnpm store (`env.sh`). The clones come from dogfood 017-13's bundles (saas at `b36f7150`, Svelte at `356c8766a`), with 017-13's base commits made again (`setup.sh`). Squeal is the worktree's committed 0.1.391 bundle (`plugins/claude-code/dist`), copied. No live daemon's socket or store was opened, and no live process was signalled. Runs were at nice 10. RSS is measured, not CPU: the host's load was 38 to 51 on 24 cores throughout, from other work.

| File | What it does |
|---|---|
| `setup.sh` | Makes the scratch: the two clones, their base commits, Svelte's `untyped` branch (`projectService: false`, the two typed rules off), the installs. |
| `env.sh` | The isolated environment. |
| `worker-wrap.mjs` | The main script of a wrapped lint worker: answers heap questions (and runs a GC in that isolate) on a `MessagePort` from `workerData`, then imports Squeal's real `lint-worker.mjs`, which runs unchanged. |
| `stages.mjs` | Squeal's own lint worker outside the daemon, with a first pass's calls: `open`, `inputs` for every listed file, `refresh`, `lint` in parts of 16 with text and blob. After each stage, a major GC in the worker and one log line: RSS, peak RSS (VmHWM), the worker's live heap before and after the GC, the `smaps` split. `LM_NOGC=1`: no GC. `LM_OLD_MB`: the worker starts with `resourceLimits.maxOldGenerationSizeMb`, as a bound would. |
| `run-stages.sh` | The `stages.mjs` variants in turn. |
| `inside.mjs` | Loaded with `--import` into a daemon only. Replaces `worker_threads.Worker` by a subclass that starts `lint-worker.mjs` through `worker-wrap.mjs`; every other worker starts unchanged. Logs RSS, peak, the daemon isolate's heap and the lint worker's heap every second; on command files, marks, a major GC or a last-resort GC in both isolates. |
| `run-daemon.sh` | One daemon of the copied bundle in a clone: lint on or off, `lint.sqlite` removed first, wait for the first pass to settle, idle with a mark each minute, then the GCs, `squeal lint --json`, `squeal stop`. |
| `smaps.mjs` | `/proc/self/smaps` split: 256 KiB anonymous mappings (V8 pages), glibc `[heap]`, other anonymous, file-backed (011-53's method). |
| `held-replica.mjs` | The live heap of maps shaped as the worker's held bytes and the host's copies, at N paths. |
| `summarize.mjs` | Prints a `stages.jsonl` or an `inside.jsonl` as a table. |
| `logs/` | `stages.jsonl` and `run-stages.out` (the variants), `stages-cap.jsonl` (the heap caps), `daemon-<label>/` (each daemon: `inside.jsonl`, `poll.txt`, `run.txt`; its `squeal lint --json` output was dropped, since it names the private saas repository's files), `held-replica.txt`. |

Clean-up is recorded at the end of `../../lint-memory.md`.
