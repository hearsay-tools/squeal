# Probe: backlog-wall-budget (THROWAWAY)

Throwaway probe for `011-core/research/backlog-wall-budget.md`. Not product code; nothing imports it.

- `make-fixture.mjs`: a fixture repository of heavy, mostly idle test files (16 Vitest files
  sleeping 60 to 150 s, 8 node:test files sleeping 60 to 150 s) and one quick test file per runner.
- `drive.mjs`: one arm. A scratch daemon (scratch `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`,
  `XDG_STATE_HOME`, store in the fixture's own `.git/squeal`), a baseline, then
  `run --all --force --wait` with the durations known, optionally an edit of both quick sources
  mid-tier (then `run --all --wait` again, since an edit ends the forced wait with exit 3);
  dumps the store's `runs`.
- `prototype.patch`: the prototype rule, applied to a scratch clone of `fb6d3164` only, behind
  `SQUEAL_PROTO_WALL=1`; with it unset the same build is today's rule.
- `model.mjs`, `sweep.mjs`: the selection rules replayed offline on fixed durations (no runner).
- `cezar-replay.mjs`: the same on cezar's 2026-10-19 checkpoint (`results/cezar-701f50.json`,
  durations only, read from cezar's store through a read-only connection).
- `summarize.mjs`: the arms' tiers, times and loads from `results/*.json`.
- `results/`: the arms' raw output; `marks.log`, each arm's pool mark and node:test process count
  every 5 s, lines kept where they changed.

Run (from a scratch directory, never the real pool or a real session):

    git clone <this repo> /tmp/bwb/squeal && git -C /tmp/bwb/squeal checkout fb6d3164
    (cd /tmp/bwb/squeal && npm ci && git apply <this dir>/prototype.patch && npm run build)
    cp -a /tmp/bwb/squeal/plugins/claude-code /tmp/bwb/plugin
    node make-fixture.mjs /tmp/bwb/fx-a /tmp/bwb/install   # install: a dir with vitest 5.0.3 installed
    node drive.mjs /tmp/bwb/plugin/dist/cli/squeal.mjs /tmp/bwb/fx-a /tmp/bwb/s-a 0 100 results/today-edit.json
    node summarize.mjs
