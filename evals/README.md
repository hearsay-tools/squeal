# Model evals

Spec 006 (`docs/specifications/006-model-evals/spec.md`): a recurring baseline that shows whether models use Squeal well, run at every hub release and with every `/quality` scan, at calm load. Never in CI or in this repository's Vitest suite. Built from 005-06's prototype (`docs/specifications/005-agent-adoption/research/probes/model-evals/`, whose logs stay there).

```sh
node evals/bin/run-baseline.mjs                    # the baseline on HEAD: 48 sessions, about 45 min at 2 at once
node evals/bin/run-baseline.mjs --variant p1       # shipped texts and a variant side by side, a run of its own
node evals/bin/run-cell.mjs t1-thousands p0 claude claude-haiku-5-5 1   # one cell
node evals/bin/trend.mjs                           # regenerate results/TREND.md
node evals/bin/compare.mjs results/<file>.json variant
```

Cells run in `$SQ_EVALS_ROOT` (default `<tmpdir>/squeal-evals`) with scratch `HOME`, `TMPDIR` and `CODEX_HOME`; the real `~/.claude` and `~/.codex` are never written, and the host's model provider is read from the environment and `~/.codex/config.toml` at run time. A cell starts only while the one-minute load average is below the CPU count. The coordinator commits the results file and the regenerated `TREND.md`.

- `ledgerline/`: the fixture. Outside Vitest's `include`, Biome and `tsconfig`; its tests run only in a cell.
- `tasks/`: the prompts, `_ending.txt` (the `TESTS:` line every prompt ends with) and `tasks.json`, each task's knob (D2).
- `variants/`: `p0` is the shipped plugin; the others patch, remove, append instructions or merge policy (D8).
- `baseline.json`: the matrix (D5). Changing a task, a knob, the fixture or the effort starts a new trend line.
- `bin/`: `run-cell.mjs`, `run-baseline.mjs`, `grade.mjs`, `trend.mjs`, `compare.mjs`, and `import-005-07.mjs`, which made the first results file.
- `lib/`: the grader, the runner's parts and the trend writer, tested in `test/evals/` on recorded transcripts.
- `results/`: one file per run, `<date>-<version>.json`, and `TREND.md`.
