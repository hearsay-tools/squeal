# Probe cpu-ceiling-measured (throwaway)

Throwaway. These files measured `../../cpu-ceiling-measured.md` once, on 2026-11-19 (row 021-19), and are not maintained. Nothing imports them.

## host/: this host, last week (Q1)

Read only. No test, build or load was started; no live store was written; no socket opened, no process signalled.

| File | What it is |
|---|---|
| `extract.mjs` | One line per ended run since a date, as `../cpu-budget/extract.mjs`, plus the revision's creation time. The store's rows are read in one read transaction of a read-only connection; each run's `report.json` is read in place. |
| `q1.py` | Every Q1 figure: sar busy bands, tier kinds, background CPU split and per unit of work (the 011 curve), tier walls, chains with and without the ceiling's holds, backlog finish, edit tiers, CPU per file against its reference, refusal episodes from the daemon logs. Its docstring has the rules. |
| `out/q1-*.json` | The two windows' outputs (aggregates only). |

```sh
S=$TMPDIR/q1; Q=<this folder>/host
for p in cezar squeal toolkit-dev; do
  node $Q/extract.mjs $p ~/projects/$p/.git/squeal/store.sqlite ~/projects/$p/.git/squeal/runs 2026-11-12T00:00:00Z >> $S/runs.jsonl
done
for f in /var/log/sysstat/sa1[2-9]; do LC_ALL=C sadf -d -U $f -- -u | grep -v '^#'; done > $S/sar-u.csv
ls ~/projects/{cezar,squeal,toolkit-dev}/.git/squeal/logs/daemon-*.log* > $S/logs.txt
python3 -I $Q/q1.py $S/runs.jsonl $S/sar-u.csv $S/logs.txt 2026-11-14T20:00:00Z 2026-11-19T08:00:00Z <this worktree's id>
python3 -I $Q/q1.py $S/runs.jsonl $S/sar-u.csv $S/logs.txt 2026-11-12T12:00:00Z 2026-11-13T22:20:00Z <this worktree's id>
```

## vm/: the 12-vCPU lab VM (Q2)

The setup of `../../../../011-core/research/probes/broad-change-throughput/` (row 011-395), reused: Squeal 0.1.563 from `git archive v0.1.563 plugins/claude-code`, squawk at `c11e4edf0` as a git bundle, `corepack pnpm@12.11.2 install --frozen-lockfile`, a private `HOME`, `XDG_CONFIG_HOME`, `XDG_STATE_HOME` and `XDG_RUNTIME_DIR` under `~/work/<task id>/` (no shared pool, no other user config), the daemon in a systemd user scope so the scope's `cpu.stat` counts it and every test process. Copied unchanged from there: `bg.sh`, `start-daemon.sh`, `queue-sample.mjs`, `wait-idle.sh`, `timeline.mjs`, `analyze.mjs`. Changed: `env.sh` (work directory), `edit.sh` (comment text), `sample.sh` (every 2 s, not 5 s, for the peak).

New here:

| File | What it does |
|---|---|
| `sequence.sh <path> <label:share>...` | The whole experiment in one detached process: a warm-up (`squeal run --fast --wait` on a fresh daemon, after the daemon is idle), then each arm in the order given. |
| `arm.sh <label> <share> <path>` | One run: stop the daemon, write `{"capacity":{"backgroundShare":<share>}}` to the private user config, start a fresh daemon in scope `sq-<label>`, wait idle, record load and top processes, edit `<path>` once (`run-edit.sh`), wait idle, write the timeline and refusals, stop the daemon. |
| `refusals.mjs <label>` | The ceiling refusals logged during the arm: count, busy CPUs read, episodes (lines less than 5 s apart). |
| `summarize.mjs <label>...` | One row per arm: total wall, background finish (the last backlog tier's end), CPU-s of the scope and the daemon, mean, p90 and peak busy CPUs, load, refusals. |
| `out/` | Each arm's timeline, refusals, load and sampler series, and the summary. |

Run (on the VM, `bash -lc`, with one ssh session kept open the whole time: the VM user has `Linger=no`, so its user manager and the daemon's scope stop when the last session closes):

```sh
bash ~/work/<id>/probe/bg.sh seq 10800 bash ~/work/<id>/probe/sequence.sh packages/contract/src/ci-wait.ts A1:0.75 F1:1 A2:0.75 F2:1
```

## Traps met

- The first warm-up asked `squeal run --fast` of a daemon still in its start-up work: the request was not taken in time (exit 1), the idle check passed before any run started, and the next step stopped the daemon with the request lost. `sequence.sh` now waits for the daemon to be idle first and uses `--wait`.
- With `backgroundShare` 1.0 the ceiling is 12 CPUs, above the default 11 test slots, so the slots bound (`min(hostSlots, ceiling)`, `cores.ts`); the refusal line then names the slots.
