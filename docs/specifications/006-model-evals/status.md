# 006 Model evals: status

Stage: draft (2026-10-10; held by the human)
Started: 2026-10-10

## Decisions so far

- 2026-10-10, the human: Squeal was tested for working, not for whether models use it well; evals should watch models in a harness with Squeal installed, down to small models. Research first (005-06, `../005-agent-adoption/research/model-evals.md`): a fixture project, multi-edit tasks known to trigger Squeal, the real plugin and daemon.
- 2026-10-10, the human, after 005-06: the main job is a recurring baseline showing behaviour holding or improving over time; primer variants are welcome as an option, not needed now. The suite gets its own spec (this one), and it runs at every hub release and whenever `/quality` runs.
- 2026-10-10, verified by the 005 coordinator: the host's model proxy serves `claude-sonnet-5-5` but rejects `haiku` and `claude-haiku-5-5`, so 005-06's Haiku 4.5 stand-in was the proxy's routing; the human checks the proxy.
- 2026-10-10, the human: spec 006 is held. The other coordinators finish their work, a quality pass runs over it (board, Later), and then the new specs (005 and 006) follow. No Opus in the baseline: it watches Claude Code `haiku` and `sonnet` and Codex `gpt-6-luna` and `gpt-6.1-sol` (D5, open question 2).
- 2026-10-10, the human: record the effort level of eval runs and keep it consistent over time; no effort variants. 005-06's pilot ran at each model's unrecorded default (the runner passed no effort). D3, D5 and D6 now pin `medium` for every model, record it per cell, and group the trend by it. The running prototype baseline (005-07) was steered to do the same.
- 2026-10-10, first trend point: the prototype baseline 005-07 (`8cf7973d`, `../005-agent-adoption/research/model-evals-baseline.md`), Squeal 0.1.101, effort `medium`, Haiku 5.5, Sonnet 5.5, Luna, Sol. 006-01 imports its results as the first `evals/results/` file. Claude Code's default effort for Haiku 5.5 and Sonnet 5.5 is already `medium`; Codex records none at its default.
