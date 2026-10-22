# Probe: edit latency in toolkit-dev (011-115)

Throwaway. Kept as the evidence for `../../edit-latency.md`; no test or product code uses it.

The scripts expect the layout they ran in, under `/tmp/el115` (removed after the probe):
`clone/` (a `git clone` of `/home/agent/projects/toolkit-dev` at `7f939fb9`, `npm ci --offline` in the root, `tools/generator`, `docs-site` and `scripts/metrics/ui`, `uv sync --offline` in the root and later in each `plugin-tools/*`, the live `squeal.config.json` copied in), `home/` (scratch `HOME` with `.config/squeal/config.json` = `{"capacity":{"hostSlots":4}}`), `run/` (scratch `XDG_RUNTIME_DIR`), `tmp/` (scratch `TMPDIR`), `store/` (a copy of the live store with its `-wal` and `-shm`).

- `sq.sh`: the installed 0.1.263 `squeal` CLI with the scratch environment.
- `q.mjs`: one SQL query against the store copy, through `node:sqlite`. `closure.mjs`: a stored closure by top directory, with an optional path filter.
- `edit-seq.sh edit|revert`: replays vim's sequence on `cli.py` (swap file created, changed 3 s later, then the write and the swap file's removal 10 s later).
- `poll.sh <out>`: `squeal status --json` every 0.5 s, reduced to revision, refined revision, runner part, phases and `outstanding`.
- `evidence/live-store-extract.txt`: the live revisions, runs, checkpoints, transitions, results and meta rows the findings cite, and the overlapping runs in the squeal and cezar store copies.
- `evidence/e<N>-status-changes.ndjson`: the status changes of each experiment. `evidence/loads-and-sequences.txt`: `uptime` before each experiment and the times `edit-seq.sh` printed.

Experiments (clone, scratch daemon 0.1.263):

- E1 `edit-seq.sh edit`: swap file starts a tier in 0.22 s; the write cancels it; next tier after the 20 s quiet; 70 s run, 13 FAIL; the failure's re-run starts at once.
- E2 daemon stop and start, 48 s idle, `edit-seq.sh revert`: cold runner part 0.74 s; quiet 20 s after the cancel. Polluted by the restart's resumed queue, so not used for the revert question.
- E3 inline: `echo "# squeal-probe" >> cli.py`, `squeal status tools/generator/tests/publish.test.ts` 2 s later (FAIL, current), `git checkout -- cli.py`, the same 2 s later (no known failures, current); `status --json`: nothing queued after either.
- E5 swap file created, removed 3 s later: the tier started 0.25 s after the create and was cancelled; the file was current at once.
- E6 swap file created, changed, removed during the quiet: current, nothing queued.
- E7 inline: a new edit, then a revert 5 s into the failure's re-run: current, nothing queued.
- E8 swap file, `squeal run --all` 1 s later, swap file removed: the file current, nothing queued, the checkpoint still "0 of 1 test file done".
- E9 inline: `sed -i '1i raise SystemExit(3)' cli.py`; `squeal status` on `test_pricing_proposals.py` and `test_pricing_end_to_end.py` said each had a current result and no known failures at revision 18; `.venv/bin/python -m pytest -q plugin-tools/estimate-pricing` failed 3 tests.
- Plain Vitest, `tools/generator`: `npx vitest run tests/publish.test.ts`: 2.25 s of tests before the tool environments existed, 79.22 s after.
