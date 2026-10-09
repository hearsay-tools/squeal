# 005 Agent adoption: status

Stage: draft (research round; no spec yet)
Started: 2026-10-09

## Decisions so far

- The human, 2026-10-09: "The tool will have no value if agents ignore it." A research round finds why agents still run tests themselves and which lever changes that, before any spec is written.
- Two proposals from the human, both to be weighed and neither decided:
  - an install step (a skill or `squeal init`) that offers to add a line to the repository's `AGENTS.md` or `CLAUDE.md`: this repository uses Squeal, wait for it or run its commands, and run the full suite only as a final gate when the cost is justified;
  - opt-in only, a `PreToolUse` hook that takes over an agent's test command and answers with Squeal's state. The coordinator's first reading, not probed: rewrite through `updatedInput` rather than deny (001 research: a deny does not steer), substitute `squeal run --all --wait` rather than `status --wait` (a full run must not be answered with affected checks only), fail open when Squeal cannot answer, and keep an escape for repository gates.
- Evidence in hand: under the 001 plugin, agents ran tests themselves in 5 of 18 and then 7 of 17 editing sessions (001 `lessons.md`); 004 sq1 and 002 as2 ran the whole suite because the repository's gate asked for pasted output; the only false Squeal result in 002's dogfooding (defect 5) was caught because the agent ran the test itself.

## Research

Brief: `research/README.md`. Topics `adoption-baseline`, `instruction-surfaces`, `hook-levers`; board rows 005-01 to 005-03.

- 2026-10-09, research round done (`adoption-baseline` `2b342d3`, `instruction-surfaces` `88f34a1`, `hook-levers` `e01e691`). In short:
  - with the plugin and no test gate, no agent ran tests in 22 controlled sessions (warm daemon, 3 s suite);
  - a gate demanding `npx vitest run` gave a full run in 5 of 5 sessions; the same gate reworded to `squeal run --all --wait` gave none in 5 of 5;
  - an instruction block added nothing next to the plugin, but worked as the fallback without it;
  - in real sessions in this repository 210 of 226 editing sessions ran tests themselves, 55% of runs checking the agent's own change while Squeal had not reached at least one covered file in 78% of store-checked runs, and gate runs took 39% of test wall time;
  - `run --all --wait` exits 0 with failing tests; Claude Code checks permission rules against a rewritten command, and Codex rewrites only with `allow`;
  - the agent's own runs caught Squeal wrong 5 times.
