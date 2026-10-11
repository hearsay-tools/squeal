# 006 wave 2: the first baseline

## 006-04 first baseline, twice on one release commit

Use /worker. Shape: slice; the deliverable is two committed results files and the regenerated trend.

**Outcome:** spec 006's proof. The baseline runs twice on the latest hub release, and the two runs show how far one run's rates move from another's by chance.

**Read:** `../spec.md` D5 to D7 and Testing ("Proof"), `../status.md`, `evals/README.md`, and `../reviews/wave-1.7.md`, whose scope note names one known grading gap (`command -p set -e`).

**Run:**

- From `evals/` at main's HEAD, `node evals/bin/run-baseline.mjs --commit squeal--v0.1.110 --parallel 2`. The release tag predates `evals/`, but the runner builds the plugin from the commit it is given.
- The command runs twice, each as a fresh run with its own run id, never `--resume` across the two. A run cut short by load or a crash continues with `--resume <its run id>`.
- The runner starts a cell only below the host's CPU count in load. Expect waits, since other coordinators share the host. Record the load per cell, as the runner does.
- Models: Claude Code `claude-haiku-5-5` and `claude-sonnet-5-5`, Codex `gpt-6-luna` and `gpt-6.1-sol`, at effort `medium`; never Opus or Fable. A model the provider does not serve is recorded as missing, never replaced.

**Commit:** both `evals/results/<date>-0.1.110.<run>.json` files and the regenerated `evals/results/TREND.md`. Then one short note, `../results/2026-10-first-baseline.md`, with:

- the two runs side by side per model and behaviour, with the largest difference between them;
- every false final claim and forbidden edit, by cell;
- any drop the trend flags (none is expected between two runs of one commit, so a flag means noise or a problem);
- a recommendation on open question 4 (whether 25 points is the right threshold), from the observed spread;
- cost (Claude Code dollars, Codex tokens) and load.

**Owns:** `evals/results/**` and `docs/specifications/006-model-evals/results/**`. A runner bug that blocks the run is fixed in `evals/` in its own commit, named in your report. No other file.

**Done when:** both runs are complete, or their missing cells are named with the reason; the results and `TREND.md` are committed; the note is written. No credential or private URL is committed: the runner scans the results file before writing it, and you check the diff too.
