# Probes: slow-claims (001-280)

Throwaway. Evidence for `../../slow-claims.md`; nothing here is product code or a test.

- `aggregate.py <results files>`: per-model counts over the judged results files (skill loads, `run --slow`, `current-before-claim`, the slow-tier state in the last Squeal text before the claim). Writes `rows.json` in the current directory. Run from `evals/results/`.
- `stopwait.py <scratch> <plugin dir> settled|immediate <n>`: times a `-p`-shaped session's silent Stop until the slow tier is current. `<scratch>/work` is a git copy of `evals/ledgerline` with `node_modules` and `slow.maxLoadPerCpu` raised; `<scratch>/{home,run,tmp}` are the scratch `HOME`, `XDG_RUNTIME_DIR` and `TMPDIR`. It runs only this repository's Squeal hook bundles and CLI, never an agent harness. Run it from outside `<scratch>`: a Claude Code session whose shell sits inside it registers itself as a consumer through its own Squeal hooks and holds the slow tier.
- `stopwait-run1.jsonl`, `stopwait-run2.jsonl`: the trials as printed, 2026-10-11/12, load 17 to 73 on 24 CPUs. Which trials count is in the findings file.
