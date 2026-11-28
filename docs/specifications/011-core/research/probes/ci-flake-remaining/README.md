# Probes: the five intermittent CI rows left after 0.1.664 (wave 132)

**Throwaway.** Evidence for `../../ci-flake-remaining.md`. Nothing here is product code or a test of the suite. The sandbox scripts patch a sandbox's own clone only; they never ran on this host.

## Local probes (this host, Node 26.13.0, one Vitest run each)

Each folder has its own Vitest config, so the suite never collects these files. Run from the repository root:

```sh
timeout 600 pnpm exec vitest run --config docs/specifications/011-core/research/probes/ci-flake-remaining/<folder>/vitest.config.ts
```

Each writes `output.txt` next to it (the committed copy is from the run the findings cite).

- `hook-busy/` (row 011-439): Claude Code's session-start and post-tool-batch while a second connection holds the store's write lock for 3 s, with `SQUEAL_HOOK_DEBUG=1`; then the next call on a free store.
- `store-window/` (row 011-440): the gate's `readStores` while `code.sqlite` exists without its schema version, while another process holds a creating transaction, and once migrated.
- `pi-stall/` (row 011-438): Pi's delivery host with a worker that answers at once, while Pi's main thread is held 0 to 3,000 ms (`Atomics.wait`: a sleep, no CPU load) right after a call.

## Sandbox scripts (`sandbox/`, boat.dev only)

All run as user `user` on a boat.dev default sandbox (4 vCPU, 8 GB) after `setup.sh <commit>` (copied from `../ci-shard-workers/`: Node 22.19.0, pnpm 12.15.0, uv, the repository at `0e5223ca8` from a git bundle).

| Script | Row | What it does |
|---|---|---|
| `proof-run.sh` | 011-440 | The five proof files the row names, once |
| `patch-why.sh` | 011-440 | Two proof tests write the proof command's stderr and report; `src/cli/proof.ts` keeps the run child's output even with `--json` |
| `patch-stores.sh` | 011-440 | `openReadOnly` logs each open (file, wanted and read schema version, error); the run child logs its answer's `kept`/`notKept` counts |
| `why-loop.sh`, `allproof.sh` | 011-440 | N runs of the two patched files, or of all 26 `test/cli/proof*.test.ts` at once; `COLD=1` drops the page cache first |
| `patch-fix.sh` | 011-440 | The candidate repair as a probe: `readStores` counts a code store still being created as missing |
| `patch-shim.sh`, `shim-loop.sh` | 011-436 | `optimizer-start.test.ts`'s git shim logs every call (pid, ppid, arguments, claim, `src/mod.js` bytes); N runs with `fatrace -f W` on every `mod.js` |
| `shard-shim.sh` | 011-436 | The Node 22 CI shard that holds `optimizer-start` (5/6 at `0e5223ca8`), as CI's Test step runs it, with the same logs |
| `patch-gate.sh`, `gate-loop.sh` | 011-438 | Pi's `tool_call` handler logs each ask's duration and answer; N runs of `pi-events.test.ts` "blocked once" |
| `patch-nodetest.sh`, `nodetest-loop.sh` | 011-439 | `integration/node-test.test.ts` runs its hooks with `SQUEAL_HOOK_DEBUG=1` and logs each hook's stderr |
| `patch-writer.sh`, `patch-desk.sh` | 011-439 | `DaemonWriter` logs leases, writes, releases and failed status polls; the daemon's write desk logs grants, refusals, settles and releases |

## Data (`data/<sandbox>/`)

- `bx_jm36fy8g` (3.79 GHz), row 011-440: `alone1-vitest.log` (the five files, first run), `loopA` to `loopC` (pair runs; summaries, notes of the failing run), `allproof-1..3` (baseline), `fixed-1..3` (with `patch-fix.sh`; run 3 was cut short when the sandbox was deleted). Each run keeps `stores.log` (store opens and child answers, temporary paths shortened) and the failing tests' lines.
- `bx_727ehrav` (3.15 GHz), row 011-436: `shimB.summary`, one run's `shim.log` and `fatrace.txt`, `shard5.summary` and the shard runs' logs for `optimizer-start`.
- `bx_4tg4uuwd` (3.79 GHz), rows 011-438 and 011-439: `gate.summary`; `nodetest*.summary` and, per silent run, `hooks.log`, `writer.log`, `desk.log`.

## Sandboxes

`bx_2dq4z3ux` (4.29 GHz, deleted at once), `bx_jm36fy8g`, `bx_727ehrav`, `bx_4tg4uuwd`; 2026-11-27 23:22Z to 2026-11-28 00:06Z; all deleted. Spend: about $0.064.
