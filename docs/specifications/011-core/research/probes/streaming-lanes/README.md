# Probe: streaming-lanes (THROWAWAY)

Throwaway probe for `011-core/research/streaming-lanes.md`. Not product code; nothing imports it.

- `prototype.patch`: applied to a scratch clone of `53932ce8` only, selected by `SQUEAL_PROTO`
  (and `SQUEAL_PROTO_CANCEL=drain|kill`, `SQUEAL_PROTO_BESIDE=1`; a per-run process mark for
  slots and beside tiers in `escaped.ts`):
  `today` (unset behaves the same), `w1` (W1's rule on node:test lanes: one round of
  `runner.tierSize`, then `sum/W + (1 − 1/W) × longest` within 120 s; `min(files, tierSize)`
  permits), `stream` (a node:test or pytest lane holds `runner.tierSize` one-file tiers in
  flight, each a slot that the next queued file takes when it frees), `stream-over` (the same,
  and an edit's file starts beside them while fewer than `tierSize` edit slots run).
- `make-fixture.mjs`: a node:test-only fixture: `heavy`, 16 files idling 20 to 90 s; `light`,
  300 files of about 50 ms of CPU each; one quick file an edit reaches.
- `drive.mjs`: one arm. A scratch daemon (scratch `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME`,
  `XDG_STATE_HOME`; the store in the fixture's own `.git/squeal`), a baseline, then
  `run --all --force --wait` with durations known, optionally an edit of `node/quick.mjs`;
  dumps the store's `runs` and the one-minute load.
- `run-arms.sh`: the arms one after another, each held until the one-minute load is below 8.
- `model.mjs`, `cezar.mjs`, `alternate.mjs`: the rules replayed offline on fixed durations;
  cezar's checkpoint is R1's `../backlog-wall-budget/results/cezar-701f50.json`.
- `vitest-instances.mjs`: Vitest 5.0.3 on a scratch fixture: two runs on one instance, per-file
  results inside a run, two instances side by side, two instances alternating.
- `vitest-memory.mjs`: what a second instance of a real project (a scratch clone of Squeal) costs.
- `run-variants.sh`: the second set of arms (W1 with an edit's cancel drained or killed, or the
  edit's tier beside the backlog tier), after `run-arms.sh`.
- `options.mjs`: question 4 offline: an edit's wait and loss per option.
- `summarize.mjs`: the arms' backlog, edit delays, load and tiers from `results/`.
- `results/`: raw output of each. `heavy-stream-lane-mark.json` is the first slot arm, before the
  per-run process mark: the post-run sweep killed the other slots' tests.

Run (from a scratch directory, never the real pool or a real session):

    git clone <this repo> /tmp/r2sl/squeal && git -C /tmp/r2sl/squeal checkout 53932ce8
    (cd /tmp/r2sl/squeal && npm ci && git apply <this dir>/prototype.patch && npm run build)
    ./run-arms.sh /tmp/r2sl/squeal/plugins/claude-code/dist/cli/squeal.mjs <this dir>
    node cezar.mjs; node alternate.mjs
    node vitest-instances.mjs /tmp/r2sl/vfx results/vitest-instances.json   # vfx: vitest@5.0.3 installed
    node --expose-gc vitest-memory.mjs /tmp/r2sl/squeal results/vitest-memory.json <unit test files>
