# Throwaway probes: revert-restore-pass (001-182)

**Throwaway.** Nothing here is product code. These files only produce the evidence cited in `../../revert-restore-pass.md`. Delete them freely.

They ran on a scratch copy of the repository at `dfee8c70` (`git archive`, then `npm ci`), outside every worktree, so no Squeal daemon watched the edits.

- `instrument.patch` plus `probe-log.ts.txt` (as `src/probe-log.ts`): with `SQ_PROBE_LOG` set, the daemon appends one JSON line per stamp of `src/mod.ts`, `stale()` check, adapter `invalidate`, run start and end, watcher batch, and tier record (`#fly`).
- `rr-probe.test.ts.txt`: `test/integration/revert-restore.test.ts` with probe logging. Each copy dumps the fixture store's revisions, runs, results and known states, plus its probe log, to `$SQ_PROBE_OUT/<id>/`. Ran as `test/probe/rr-{1..4}.test.ts`.
- `rr-split.test.ts.txt`: the same, but attempts up to `SQ_PROBE_SPLIT` (default 1) hold the reverted bytes 1.5 s, so the watcher splits them. Ran as `test/zsplit/rr-split-{1..4}.test.ts`.
- `midrun-182.test.ts.txt` (as `test/runners/vitest/midrun-182.test.ts`): the deterministic adapter probe of Finding 1. `midRun true` is red until the gap is fixed.
- `rounds.sh <label> <n> <paths>`: n Vitest runs at `--maxWorkers=4`, logging the load per round. `gates.sh <n>`: n full gates, sampling the load every 30 s.
- `analyze2.py <out>`: per-armed-run verdicts and counts. `analyze.py` is its first draft.
- `results/`: per-set summaries, round and load logs, `analyze2` output, gate failure lists, and the probe log and store dump of the first forced-split repetition (fixture path shortened to `<fixture>`).
