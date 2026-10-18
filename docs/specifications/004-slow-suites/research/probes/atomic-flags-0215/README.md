# Probes for row 004-77 (throwaway)

Throwaway, kept only as the record of how `../../atomic-flags-0215.md` counted. They read the kept eval cells under `/tmp/squeal-evals-1001/cells/` and change nothing.

- `primer-length.ts`: renders the Codex primer with one slow file under both `stop.requireSlowSuite` values, for the eval cell's CLI path and a typical `~/.codex` path, and says which wait sentence and CLI naming it reaches. Run from the repository root with this repository's `tsx`.
- `tab.py`: every measure per model for the four scenarios, 0.1.199 against 0.1.215.
- `sum.py <task> <model>`: per cell, truth, claim, Squeal's end verdict and measures.
- `cmds.py`, `cmds2.py <task> <model> 0199|0215`: the Squeal and test commands each session ran, with exits.
- `tr.py <cell> [from] [chars]`, `clock.py <cell> <chars>`: a cell's transcript, or the steps naming the clock test.
