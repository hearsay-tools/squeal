# 005 Agent adoption: status

Stage: approved (2026-10-09, by the human; waves on `docs/board.md`, not started until the human's go)
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

- 2026-10-09, the human: write the spec and reword this repository's gate in parallel; setup is a skill shipped with the plugin that interviews the user and runs `squeal init` for them, not a command the user types (spec D3).


## Amendments after approval

- 2026-10-09, decided by the human at approval: the skill is named `setup` (`/squeal:setup`, D3); goal 6's targets as proposed (agent-run Vitest outside a gate at most half of 9.0 per editing session, workers' full-suite Vitest near zero); no wave starts until the human says so.
- 2026-10-09, the human: this host's load (65 to 170 on 24 CPUs) is this project's own work, so 005 waits until the other coordinators finish, to add no noise of its own. Held until 001-169 to 001-174 and 004-46 are done. On resume:
  - D2 and D6 are reconciled with 001-172 (one-file `status --wait` latency on a loaded host) and 001-174 (the skill's red/green workflow and one-file wait), which may make D2 smaller or unnecessary;
  - the `squeal why` console-output gap is 001-173's;
  - the baseline was measured at that load, so `metric.mjs` records the load average per session and the proof runs at calm load, since Squeal "not having reached the file" (78% of store-checked runs) may be mostly load.
- 2026-10-09, the human, after asking whether `init` starts the first run (it does not; the next hook's daemon does): setup offers the warm-up (decided). A user who knows Squeal should set a fresh repository up from the terminal before starting an agent, perhaps as one `squeal setup` (init, the Codex trust step, the warm-up), and how the CLI is distributed and updated is open, possibly outside the plugin. D3 is reopened until research topic `cli-distribution` (005-05) reports; the rest of 005 stays held.
- 2026-10-09, research `cli-distribution` done (`be5de09`). It recommends keeping the plugin as the only full copy of the CLI, with `squeal` on the terminal PATH as a launcher that finds the installed plugin at each call (+85 ms), because a CLI of another version than the plugin's hooks re-keys every result (the version is in the environment hash). Codex upgrades the plugin at every session start and deletes the old directory; Claude Code only by hand or with auto-update, off by default for `hearsay`. Codex trust is once per user and survives upgrades. A warm-up is `start` then `run --all --wait`; its results survive the daemon's idle exit and carry over to new worktrees. One engine, two front ends: a terminal `squeal setup` and the `/squeal:setup` skill. D3's rewrite waits for the human.

## Dogfooding

- 2026-10-09, `97144d9`, decided by the human ("Both": reword this repository's gate now and write the spec beside it): `CLAUDE.md` (and `AGENTS.md`, a symlink to it) and the worker skill take the suite through `squeal run --all --wait`, read `Known failures`, and fall back to `npx vitest run` when Squeal cannot answer or is doubted; reviewers, the coordinator's landing check and CI keep `npx vitest run` as the independent run. Baseline before it, from `research/adoption-baseline.md` 3 (`probes/adoption-baseline/metric.mjs` over this repository's Cezar sessions to 2026-10-09 16:25 local): 10.8 own runs per editing session, 9.0 outside a full-suite gate, 6.7 min of test wall time, gate runs 17% of runs and 39% of test wall time, 32% of sessions pulling Squeal. Sessions started after `97144d9` are the comparison.
