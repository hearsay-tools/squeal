# Research brief 015-03: coverage and complexity as feedback

Use /researcher. Shape: research. Outcome: what is known about showing coverage, complexity and CRAP to developers and to coding agents, which of it helps and which harms, and which signals behave as transitions Squeal could push rather than state it serves on pull. Follow the rules in `README.md`.

Read first: `docs/vision.md` (principles 1 to 4, "What Squeal is not", the decision filter); 011 C5 (transitions and delivery views) and C6 (status); `../../005-agent-adoption/spec.md` goals (what agents do with Squeal's messages).

Questions:

1. **Peers for developers.** Wallaby and IDE inline coverage, Codecov and Coveralls patch coverage, diff-cover, SonarQube's quality gate on new code, CodeScene code health, PHPUnit's CRAP report: what each shows, on which scope (the project, a file, changed lines), and what triggers a notice.
2. **Evidence for agents.** Papers and reports on coverage or complexity feedback to LLM agents (for example CoverUp, CodaMosa, Meta's TestGen-LLM, SWE-bench agents that run coverage). For each: the claim, the measure and how strong the evidence is.
3. **Harm.** Goodhart effects: tests without assertions written to raise coverage, needless refactors to lower complexity, an agent widening its task. What peers do against them.
4. **Transitions.** Which signals change state on an edit and are actionable at once: a changed function that no test runs, a changed function crossing a CRAP threshold, patch coverage at a checkpoint. Which are state for pull only. Estimate how often each would fire, from this repository's last 100 commits with a cheap proxy (changed functions per commit, their CC); say what the proxy misses.
5. **Policy.** Thresholds, scopes and keys peers let a project set, and their defaults. What keeps such feedback quiet on code the agent did not touch.

Own `agent-feedback.md` and `probes/agent-feedback/`.
