# Project setup guidance for agents — future research

Captured at the human's request, 2026-10-27. Board row 015-90. **Not dispatched.** The human chose explicit helper exclusions and asked to preserve this idea before going to bed. No skill creation, setup change or new default is approved here.

Outcome: evidence for a skill that helps agents configure Squeal correctly in their projects, possibly as part of setup.

Use /researcher when the human later authorizes this row. Read spec 015 D1/D6/D8/D9, lessons Round 2 C5, spec 005 D3, the installed project copies of `skills/setup/SKILL.md` and `skills/squeal/SKILL.md`, and the setup plan's sources. The existing setup skill is the starting point; do not assume a second skill is needed.

Questions:

1. What configuration guidance already exists in setup, the operational skill and their references? What is missing or duplicated? Compare extending setup with a separate focused skill.
2. Which project facts can an agent obtain from runner configuration and Squeal's read-only setup plan? Which need the project's owner to decide? Test-file patterns alone cannot identify helper directories: `test/**/*.test.ts` misses helpers, while widening `src/**/*.test.ts` to `src/**` hides product code.
3. What small workflow explains runner discovery, separate and colocated tests, helpers and fixtures, coverage opt-in and unmeasured threads/processes, complexity/CRAP, lint when configured, explicit exclusions, resource cost, and verification? Keep the workflow limited to facts that help a project make its choices.
4. What can the agent propose, and what needs the project's approval before a config or instruction file changes? Preserve explicit exclusions and show a reviewable diff. Do not propose silent changes to defaults or gates.
5. Can one agent follow the draft on two scratch projects (separate test tree and colocated tests) without excluding product code, inventing coverage, or claiming unrun checks passed? What does it cost in steps and tokens?

Sources and cheap experiments only. Tag every finding. Own `research/project-setup-guidance.md` and `research/probes/project-setup-guidance/**`; no product, setup skill or policy edits. Findings compare options, show a sample proposed configuration and verification, name remaining product choices and recommend the smallest scope. The human decides that scope later. This row does not block the approved coverage-noise fixes.
