# 006 wave 1

## 006-01 the suite in `evals/`

Use /worker. Shape: slice.

**Outcome:** `node evals/bin/run-baseline.mjs` runs spec 006's baseline against the checkout's Squeal, writes `evals/results/<date>-<version>.json` and regenerates `evals/results/TREND.md`.

**Read:** `../spec.md` D1 to D6 and D8; `../../005-agent-adoption/research/model-evals.md` sections 3 to 5 and 7; `../../005-agent-adoption/research/model-evals-baseline.md` ("Runner fixes", "Effort, cost, load"); `../../005-agent-adoption/research/probes/model-evals/README.md`.

**Seam:** copy the probe's `fixture/`, `tasks/`, `variants/` and `bin/` to `evals/ledgerline/`, `evals/tasks/`, `evals/variants/` and `evals/bin/`, never its `logs/`. First edit: `run-cell.mjs`'s paths. Then, each its own commit:

- the grader's quirks: Codex's `bash -lc` wrapper, refused commands, chained commands;
- the three knobs of D2, as task properties;
- `run-cell.mjs` waits for the daemon's pid to exit after `squeal stop`;
- `--effort` stays (default `medium`); the allow-list gains `Bash(node:*)` (open question 3);
- `run-baseline.mjs`: D5's matrix (no Opus), 2 to 4 cells at once, a cell starts only below `nproc` load;
- D6's results file, `TREND.md` with the 25-point flag, and `--variant` (D8);
- 005-07's 36 `medium` cells imported as the first results file.

**Owns:** `evals/**`, `test/evals/**`, `!evals/ledgerline` in `biome.json`, and one line in the probe's README pointing at `evals/`. Leave `src/`, `plugins/`, the board and every other doc alone. The fixture stays outside Vitest's `include` and `tsconfig`, as it is now. No bundle change, so no version raise or build commit.

**Done when:**

- `test/evals/` unit-tests the grader on small recorded transcripts from both harnesses (each D4 behaviour and quirk), plus the `TESTS:` parser, the trend writer and its flag, and the patcher's minimum match count.
- The repository gate is green.
- One smoke cell per harness runs end to end below load 24, or is reported pending if the load never allows it. It leaves no credential in its scratch and no daemon or process behind.
- No credential or private URL is committed (public repository; the provider is read at run time).

## 006-03 review of 006-01

Use /reviewer. Range `c26cbb78^..69f7eb0f` (006-01's eight commits on main). Spec: `../spec.md` D1 to D6 and D8, with `../status.md`.

Where the blast radius is, in order:

1. **Isolation and credentials.** A cell must never write the real `~/.claude` or `~/.codex`. It must leave no credential in its scratch or in `out/`, and never commit one: the repository is public, and a provider URL leaked from a probe once. The runner reads the provider at run time, so check every path where it is copied.
2. **Grading honesty.** Can a refused, chained, heredoc'd or `bash -lc`-wrapped command be counted wrongly as a test run, an edit or a wait? Can the `TESTS:` parser, the forbidden-edit rule or "Squeal had already answered" grade a session better than its transcript shows?
3. **The knobs.** Does T4 leave truly no daemon validating, and does `SQUEAL_CLI` pointing at no file leak anywhere beyond the cell? Does T2's flake really fail Squeal's first re-run, and does T3's outside edit produce a result from an older revision?
4. **Trend.** Can the 25-point flag compare runs across conditions fingerprints, and does the fingerprint leave out what it should (Squeal, harness and model versions)? Does the 005-07 import reproduce its published table?
5. **Cleanup.** Does the runner wait for the daemon's pid and leave no process, and does the load gate hold?

Probe cells are allowed: at most 2 subject sessions, below load 24, in scratch homes. Findings go to `../reviews/wave-1.md`, committed.
