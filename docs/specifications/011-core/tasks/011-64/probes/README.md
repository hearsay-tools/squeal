# 011-64 probes

Throwaway probes for `../design.md`. None is product code. None writes to a real store.

Isolation. Cezar's store was copied once through a `readOnly` connection (`VACUUM INTO`) at 2026-10-21T15:09:24Z, at a one-minute load of 33.7 on 24 CPUs, into `/tmp/t64/cezar-store.sqlite`. Every SQL probe reads that copy with `readOnly: true`. The one probe that runs product code (`replaced-prune.ts`) opens a scratch store under a `mkdtemp` directory below `/tmp/t64`, with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` and `TMPDIR` under `/tmp/t64`. No daemon, no Vitest run, no build and no suite ran. This worktree has no `node_modules`; `replaced-prune.ts` ran with the `tsx` binary of the parent's worktree (`04a258b0`), which imports nothing from that worktree.

Each probe states its usage in its header. The recorded run is `output.txt`, at a one-minute load of 10.6 to 11.5 (the load is printed beside every timing).

| Probe | Question | What it does |
| --- | --- | --- |
| `snapshot.mjs` | all | Copies a store through a read-only connection. |
| `failures-sql.mjs` | 1 | Times today's `listFailures` and `countFailures` and the filtered forms the design proposes, with each plan, median of 7 runs. |
| `check-filter.mjs` | 1 | The `--check` filter with one formatter: failing checks read in SQL, matched by printed name in JS, the list filtered by id in SQL. |
| `frames.mjs` | 2 | Over every stored failure: where `location` points, whether the stored stack text holds a frame in the check's own test file, and whether the text's positions equal `location`'s. |
| `reach.mjs` | 4 | Which of the design's seams each validity entry (`test/keys/validity/entries/`) reaches through static imports. A regex walk, not a bundle: "reached" means "may be emitted"; "not reached" is certain. |
| `replaced-prune.ts` | 3 | A fail, a pass at the same key, then prune one hour and eight days later: what is left of the failure. |

Commands, from the repository root:

```sh
node docs/specifications/011-core/tasks/011-64/probes/snapshot.mjs /home/agent/projects/cezar/.git/squeal/store.sqlite /tmp/t64/cezar-store.sqlite
cd docs/specifications/011-core/tasks/011-64/probes
node failures-sql.mjs; node check-filter.mjs; CHECK=harness-parity node check-filter.mjs; node frames.mjs
cd -; node docs/specifications/011-core/tasks/011-64/probes/reach.mjs
HOME=/tmp/t64/home XDG_RUNTIME_DIR=/tmp/t64/xdg/run XDG_CONFIG_HOME=/tmp/t64/xdg/config \
  XDG_STATE_HOME=/tmp/t64/xdg/state XDG_CACHE_HOME=/tmp/t64/xdg/cache TMPDIR=/tmp/t64 \
  <tsx> docs/specifications/011-core/tasks/011-64/probes/replaced-prune.ts
```

The copy is not committed: it holds cezar's test names and failure texts.
